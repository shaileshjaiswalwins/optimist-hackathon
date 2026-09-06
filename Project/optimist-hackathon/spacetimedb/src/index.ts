import { ScheduleAt, Timestamp } from 'spacetimedb';
import { SenderError, schema, table, t } from 'spacetimedb/server';

const match = table({ name: 'match', public: true }, {
  match_id: t.u64().primaryKey().autoInc(),
  state: t.string(),
  max_slots: t.u8(),
  tick_count: t.u64(),
  created_at: t.timestamp(),
  started_at: t.option(t.timestamp()),
  finished_at: t.option(t.timestamp()),
  winner_player_id: t.option(t.u64()),
});

const player_profile = table({ name: 'player_profile', public: true }, {
  player_id: t.u64().primaryKey().autoInc(),
  match_id: t.u64().index('btree'),
  identity: t.option(t.identity()),
  name: t.string(),
  vehicle_type: t.string(),
  is_bot: t.bool(),
  joined_at: t.timestamp(),
});

// Private by design: contact details never enter public subscriptions.
const player_contact = table({ name: 'player_contact' }, {
  player_id: t.u64().primaryKey(),
  email: t.string(),
  consent_given: t.bool(),
  consented_at: t.timestamp(),
});

const player_vitals = table({ name: 'player_vitals', public: true }, {
  player_id: t.u64().primaryKey(),
  match_id: t.u64().index('btree'),
  strikes_remaining: t.u8(),
  score: t.u32(),
  eliminated: t.bool(),
  rank: t.option(t.u8()),
});

const player_position = table({ name: 'player_position', public: true }, {
  player_id: t.u64().primaryKey(),
  match_id: t.u64().index('btree'),
  x: t.f32(),
  distance: t.f32(),
  speed: t.f32(),
  steering: t.f32(),
  throttle: t.f32(),
  boost: t.bool(),
  input_seq: t.u32(),
  last_attack_tick: t.u64().default(0n),
  // Appended with a default so existing Maincloud rows migrate in place.
  start_distance: t.f32().default(0),
});

const match_start_gate = table({ name: 'match_start_gate', public: true }, {
  match_id: t.u64().primaryKey(),
  preparation_deadline: t.timestamp(),
  countdown_started_at: t.option(t.timestamp()),
  race_starts_at: t.option(t.timestamp()),
});

const player_ready = table({ name: 'player_ready', public: true }, {
  player_id: t.u64().primaryKey(),
  match_id: t.u64().index('btree'),
  ready: t.bool(),
  eligible: t.bool(),
  ready_at: t.option(t.timestamp()),
});

const client_session = table({ name: 'client_session' }, {
  connection_id: t.connectionId().primaryKey(),
  identity: t.identity(),
  connected_at: t.timestamp(),
});

// One-shot notifications so clients can pop up "you got kicked" style toasts
// without polling collision_event, which is shared with obstacle hits.
const attack_event = table({ name: 'attack_event', public: true, event: true }, {
  attacker_player_id: t.u64(),
  target_player_id: t.u64(),
  attack_kind: t.string(),
  strikes_remaining: t.u8(),
  created_at: t.timestamp(),
});

const obstacle = table({ name: 'obstacle', public: true }, {
  obstacle_id: t.u64().primaryKey().autoInc(),
  match_id: t.u64().index('btree'),
  x: t.f32(),
  distance: t.f32(),
  active: t.bool(),
  spawned_at_tick: t.u64(),
  kind: t.string().default('traffic'),
});

const collision_event = table({ name: 'collision_event', public: true, event: true }, {
  player_id: t.u64(),
  obstacle_id: t.u64(),
  strikes_remaining: t.u8(),
  kind: t.string(),
  created_at: t.timestamp(),
});

const game_tick_schedule = table({
  name: 'game_tick_schedule',
  scheduled: (): any => gameTick,
}, {
  scheduled_id: t.u64().primaryKey().autoInc(),
  scheduled_at: t.scheduleAt(),
  match_id: t.u64(),
});

const match_phase_schedule = table({
  name: 'match_phase_schedule',
  scheduled: (): any => advanceMatchPhase,
}, {
  scheduled_id: t.u64().primaryKey().autoInc(),
  scheduled_at: t.scheduleAt(),
  match_id: t.u64(),
  phase: t.string(),
});

const spacetimedb = schema({
  match,
  player_profile,
  player_contact,
  player_vitals,
  player_position,
  match_start_gate,
  player_ready,
  client_session,
  obstacle,
  collision_event,
  attack_event,
  game_tick_schedule,
  match_phase_schedule,
});
export default spacetimedb;

const VALID_VEHICLES = new Set(['auto', 'scooty', 'thar']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOT_NAMES = ['Rex', 'Kaka', 'Bijli', 'Maya'];
const BOT_VEHICLES = ['thar', 'auto', 'scooty', 'auto'];
const MAX_PLAYERS = 30;
// A solo player should never wait for other humans. Bots top the field up to
// this size and back off entirely once enough humans have joined.
const MIN_FIELD_SIZE = 4;
const MAX_BOTS = MIN_FIELD_SIZE - 1;

// Single source of truth for vehicle feel. The client's local Rapier tuning
// (src/vehiclePhysics.ts) mirrors these numbers per vehicle so prediction
// doesn't fight the authoritative server result. Keep both in sync by hand.
type AttackKind = 'kick' | 'ram';
const VEHICLE_DYNAMICS: Record<string, {
  topSpeed: number; acceleration: number; coastDeceleration: number;
  attack: AttackKind; attackRange: number; attackCooldownTicks: number;
}> = {
  auto: { topSpeed: 17.5, acceleration: 3.4, coastDeceleration: 0.9, attack: 'kick', attackRange: 2.2, attackCooldownTicks: 30 },
  scooty: { topSpeed: 20, acceleration: 3.8, coastDeceleration: 0.75, attack: 'kick', attackRange: 2.2, attackCooldownTicks: 30 },
  thar: { topSpeed: 24, acceleration: 4.2, coastDeceleration: 1.05, attack: 'ram', attackRange: 3.5, attackCooldownTicks: 50 },
};
const LANE_WIDTH = 3.2;
const MIN_LANES = 3;
const MAX_LANES = 7;

// The road widens as the field grows so extra racers always have room:
// one additional lane for every five racers, capped so it stays drivable.
function laneCountFor(fieldSize: number): number {
  return Math.min(MAX_LANES, MIN_LANES + Math.floor(fieldSize / 5));
}

function laneCenters(laneCount: number): number[] {
  const centers: number[] = [];
  const span = (laneCount - 1) / 2;
  for (let index = 0; index < laneCount; index += 1) centers.push((index - span) * LANE_WIDTH);
  return centers;
}

const MAX_LIVES = 3;
const PREPARATION_MICROS = 12_000_000n;
const COUNTDOWN_MICROS = 4_000_000n;
const HAZARD_KINDS = new Set(['traffic', 'police', 'pedestrian']);
const VEHICLE_RETIRE_TICKS = 20n;
const TRAFFIC_SPAWN_AHEAD = 130;
const MIN_TRAFFIC_SPACING = 30;

function isHazard(kind: string): boolean {
  return HAZARD_KINDS.has(kind);
}

// Pedestrians walk back and forth across the full asphalt without extra state.
function pedestrianX(obstacleId: bigint, spawnedAtTick: bigint, tick: bigint, roadHalfWidth: number): number {
  const elapsed = Number(tick - spawnedAtTick);
  const span = roadHalfWidth * 2;
  const speed = 0.14;
  const oneWayTicks = Math.max(1, span / speed);
  const cycle = oneWayTicks * 2;
  const phase = elapsed % cycle;
  const progress = phase < oneWayTicks ? phase / oneWayTicks : 1 - (phase - oneWayTicks) / oneWayTicks;
  const goingRight = Number(obstacleId % 2n) === 0;
  const t = goingRight ? progress : 1 - progress;
  return -roadHalfWidth + t * span;
}

// A round must always resolve at a live event. At 20 ticks per second this is
// two and a half minutes, giving players ample time to race while preventing
// an abandoned browser tab from keeping a match active forever.
const MAX_MATCH_TICKS = 3_000n;

export const init = spacetimedb.init(ctx => {
  ctx.db.match.insert({
    match_id: 0n,
    state: 'waiting',
    max_slots: MAX_PLAYERS,
    tick_count: 0n,
    created_at: ctx.timestamp,
    started_at: undefined,
    finished_at: undefined,
    winner_player_id: undefined,
  });
});

// Safe recovery hook for deployments created before continuous lobbies were
// introduced. Repeated calls are harmless because only one waiting match is
// created when none exists.
export const ensureWaitingMatch = spacetimedb.reducer(ctx => {
  const waitingMatch = [...ctx.db.match.iter()].find(existing => existing.state === 'waiting');
  if (waitingMatch) {
    if (waitingMatch.max_slots !== MAX_PLAYERS) {
      ctx.db.match.match_id.update({ ...waitingMatch, max_slots: MAX_PLAYERS });
    }
    return;
  }
  ctx.db.match.insert({
    match_id: 0n,
    state: 'waiting',
    max_slots: MAX_PLAYERS,
    tick_count: 0n,
    created_at: ctx.timestamp,
    started_at: undefined,
    finished_at: undefined,
    winner_player_id: undefined,
  });
});

export const joinMatch = spacetimedb.reducer({
  match_id: t.u64(), name: t.string(), email: t.string(),
  consent_given: t.bool(), vehicle_type: t.string(),
}, (ctx, { match_id, name, email, consent_given, vehicle_type }) => {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (cleanName.length < 2 || cleanName.length > 30) throw new SenderError('Name must be between 2 and 30 characters.');
  if (!EMAIL_PATTERN.test(cleanEmail)) throw new SenderError('Enter a valid email address.');
  if (!consent_given) throw new SenderError('Consent is required to join this event.');
  if (!VALID_VEHICLES.has(vehicle_type)) throw new SenderError('Choose Auto, Activa 2G, or Thar.');

  const selectedMatch = ctx.db.match.match_id.find(match_id);
  if (!selectedMatch || selectedMatch.state !== 'waiting') throw new SenderError('This match is no longer accepting players.');
  const participants = [...ctx.db.player_profile.match_id.filter(match_id)];
  if (participants.some(player => player.identity?.equals(ctx.sender))) throw new SenderError('You have already joined this match.');
  if (participants.length >= selectedMatch.max_slots) throw new SenderError('This match is full.');

  const profile = ctx.db.player_profile.insert({
    player_id: 0n, match_id, identity: ctx.sender, name: cleanName,
    vehicle_type, is_bot: false, joined_at: ctx.timestamp,
  });
  ctx.db.player_contact.insert({ player_id: profile.player_id, email: cleanEmail, consent_given, consented_at: ctx.timestamp });
  ctx.db.player_vitals.insert({ player_id: profile.player_id, match_id, strikes_remaining: 3, score: 0, eliminated: false, rank: undefined });
});

export const startMatch = spacetimedb.reducer({ match_id: t.u64() }, (ctx, { match_id }) => {
  const selectedMatch = ctx.db.match.match_id.find(match_id);
  if (!selectedMatch || selectedMatch.state !== 'waiting') throw new SenderError('Match cannot be started.');
  const humans = [...ctx.db.player_profile.match_id.filter(match_id)];
  if (!humans.some(player => player.identity?.equals(ctx.sender))) throw new SenderError('Join the match before starting it.');

  // Bots only top the field up to MIN_FIELD_SIZE. A lobby that already has
  // enough humans races human-only; a solo player still gets a full grid.
  const botsNeeded = Math.min(MAX_BOTS, Math.max(0, MIN_FIELD_SIZE - humans.length));
  for (let index = 0; index < botsNeeded; index += 1) {
    const profile = ctx.db.player_profile.insert({
      player_id: 0n, match_id, identity: undefined,
      name: `${BOT_NAMES[index % BOT_NAMES.length]} ${index + 1}`,
      vehicle_type: BOT_VEHICLES[index % BOT_VEHICLES.length],
      is_bot: true, joined_at: ctx.timestamp,
    });
    ctx.db.player_vitals.insert({ player_id: profile.player_id, match_id, strikes_remaining: 3, score: 0, eliminated: false, rank: undefined });
  }

  const racers = [...ctx.db.player_profile.match_id.filter(match_id)];
  const startingLanes = laneCenters(laneCountFor(racers.length));
  racers.forEach((racer, index) => {
    const gridSpot = {
      x: startingLanes[index % startingLanes.length],
      distance: -Math.floor(index / startingLanes.length) * 5.2,
    };
    ctx.db.player_position.insert({
      player_id: racer.player_id, match_id,
      x: gridSpot.x, distance: gridSpot.distance,
      speed: 0,
      steering: 0, throttle: 0,
      boost: false, input_seq: 0, last_attack_tick: 0n,
      start_distance: gridSpot.distance,
    });
    ctx.db.player_ready.insert({
      player_id: racer.player_id,
      match_id,
      ready: racer.is_bot,
      eligible: true,
      ready_at: racer.is_bot ? ctx.timestamp : undefined,
    });
  });

  const preparationDeadline = ctx.timestamp.microsSinceUnixEpoch + PREPARATION_MICROS;
  ctx.db.match_start_gate.insert({
    match_id,
    preparation_deadline: new Timestamp(preparationDeadline),
    countdown_started_at: undefined,
    race_starts_at: undefined,
  });
  ctx.db.match.match_id.update({ ...selectedMatch, state: 'preparing', started_at: undefined });
  ctx.db.match_phase_schedule.insert({
    scheduled_id: 0n,
    scheduled_at: ScheduleAt.time(preparationDeadline),
    match_id,
    phase: 'preparation_timeout',
  });
  // Keep the event joinable while this race is in progress. Each lobby starts
  // its own independent match and immediately creates the next lobby.
  ctx.db.match.insert({
    match_id: 0n,
    state: 'waiting',
    max_slots: selectedMatch.max_slots,
    tick_count: 0n,
    created_at: ctx.timestamp,
    started_at: undefined,
    finished_at: undefined,
    winner_player_id: undefined,
  });
});

function beginCountdown(ctx: any, selectedMatch: any, timedOut: boolean) {
  if (selectedMatch.state !== 'preparing') return;
  const readiness = [...ctx.db.player_ready.match_id.filter(selectedMatch.match_id)];
  const profiles = [...ctx.db.player_profile.match_id.filter(selectedMatch.match_id)];
  const humans = profiles.filter((profile: any) => !profile.is_bot);
  const sessions = [...ctx.db.client_session.iter()];
  const connectedHumans = humans.filter((profile: any) =>
    profile.identity && sessions.some((session: any) => session.identity.equals(profile.identity))
  );
  const allHumansReady = connectedHumans.every((profile: any) =>
    readiness.find((row: any) => row.player_id === profile.player_id)?.ready);
  if (!timedOut && !allHumansReady) return;

  for (const profile of humans) {
    const row = ctx.db.player_ready.player_id.find(profile.player_id);
    if (!row || row.ready) continue;
    const connected = connectedHumans.some((candidate: any) => candidate.player_id === profile.player_id);
    if (timedOut || !connected) {
      ctx.db.player_ready.player_id.update({ ...row, eligible: false });
      const vitals = ctx.db.player_vitals.player_id.find(profile.player_id);
      if (vitals) ctx.db.player_vitals.player_id.update({ ...vitals, eliminated: true });
    }
  }

  const gate = ctx.db.match_start_gate.match_id.find(selectedMatch.match_id);
  if (!gate) throw new SenderError('Match start gate is missing.');
  const raceStartsAtMicros = ctx.timestamp.microsSinceUnixEpoch + COUNTDOWN_MICROS;
  ctx.db.match_start_gate.match_id.update({
    ...gate,
    countdown_started_at: ctx.timestamp,
    race_starts_at: new Timestamp(raceStartsAtMicros),
  });
  ctx.db.match.match_id.update({ ...selectedMatch, state: 'countdown' });
  ctx.db.match_phase_schedule.insert({
    scheduled_id: 0n,
    scheduled_at: ScheduleAt.time(raceStartsAtMicros),
    match_id: selectedMatch.match_id,
    phase: 'race_start',
  });
}

export const markPlayerReady = spacetimedb.reducer({ player_id: t.u64() }, (ctx, { player_id }) => {
  const profile = ctx.db.player_profile.player_id.find(player_id);
  if (!profile?.identity?.equals(ctx.sender)) throw new SenderError('You cannot ready this racer.');
  const selectedMatch = ctx.db.match.match_id.find(profile.match_id);
  if (!selectedMatch || selectedMatch.state !== 'preparing') return;
  const readiness = ctx.db.player_ready.player_id.find(player_id);
  if (!readiness || !readiness.eligible || readiness.ready) return;
  ctx.db.player_ready.player_id.update({ ...readiness, ready: true, ready_at: ctx.timestamp });
  beginCountdown(ctx, selectedMatch, false);
});

export const advanceMatchPhase = spacetimedb.reducer(
  { timer: match_phase_schedule.rowType },
  (ctx, { timer }) => {
    const selectedMatch = ctx.db.match.match_id.find(timer.match_id);
    if (!selectedMatch) return;
    if (timer.phase === 'preparation_timeout') {
      beginCountdown(ctx, selectedMatch, true);
      return;
    }
    if (timer.phase !== 'race_start' || selectedMatch.state !== 'countdown') return;
    const gate = ctx.db.match_start_gate.match_id.find(timer.match_id);
    if (!gate?.race_starts_at || ctx.timestamp.microsSinceUnixEpoch < gate.race_starts_at.microsSinceUnixEpoch) return;
    for (const profile of ctx.db.player_profile.match_id.filter(timer.match_id)) {
      const position = ctx.db.player_position.player_id.find(profile.player_id);
      const readiness = ctx.db.player_ready.player_id.find(profile.player_id);
      if (!position || !readiness?.eligible) continue;
      ctx.db.player_position.player_id.update({
        ...position,
        steering: 0,
        throttle: profile.is_bot ? 0.72 : 0,
        boost: false,
      });
    }
    ctx.db.match.match_id.update({ ...selectedMatch, state: 'active', started_at: gate.race_starts_at });
    ctx.db.game_tick_schedule.insert({
      scheduled_id: 0n,
      scheduled_at: ScheduleAt.interval(50_000n),
      match_id: timer.match_id,
    });
  }
);

export const setDrivingInput = spacetimedb.reducer({
  player_id: t.u64(), steering: t.f32(), throttle: t.f32(), boost: t.bool(), input_seq: t.u32(),
}, (ctx, { player_id, steering, throttle, boost, input_seq }) => {
  const profile = ctx.db.player_profile.player_id.find(player_id);
  const position = ctx.db.player_position.player_id.find(player_id);
  if (!profile?.identity?.equals(ctx.sender) || !position) throw new SenderError('You cannot control this racer.');
  const selectedMatch = ctx.db.match.match_id.find(profile.match_id);
  const gate = ctx.db.match_start_gate.match_id.find(profile.match_id);
  if (!selectedMatch || selectedMatch.state !== 'active'
    || (gate?.race_starts_at && ctx.timestamp.microsSinceUnixEpoch < gate.race_starts_at.microsSinceUnixEpoch)) {
    throw new SenderError('The race has not started.');
  }
  const readiness = ctx.db.player_ready.player_id.find(player_id);
  if (readiness && !readiness.eligible) throw new SenderError('This racer is spectating.');
  if (steering < -1 || steering > 1 || throttle < 0 || throttle > 1) throw new SenderError('Invalid driving input.');
  if (input_seq <= position.input_seq) return;
  ctx.db.player_position.player_id.update({ ...position, steering, throttle, boost, input_seq });
});

export const useAttack = spacetimedb.reducer({ player_id: t.u64() }, (ctx, { player_id }) => {
  const profile = ctx.db.player_profile.player_id.find(player_id);
  const position = ctx.db.player_position.player_id.find(player_id);
  const vitals = ctx.db.player_vitals.player_id.find(player_id);
  if (!profile?.identity?.equals(ctx.sender) || !position || !vitals) throw new SenderError('You cannot control this racer.');
  if (vitals.eliminated) throw new SenderError('Eliminated racers cannot attack.');

  const selectedMatch = ctx.db.match.match_id.find(profile.match_id);
  const gate = ctx.db.match_start_gate.match_id.find(profile.match_id);
  if (!selectedMatch || selectedMatch.state !== 'active'
    || (gate?.race_starts_at && ctx.timestamp.microsSinceUnixEpoch < gate.race_starts_at.microsSinceUnixEpoch)) {
    throw new SenderError('The race has not started.');
  }
  const readiness = ctx.db.player_ready.player_id.find(player_id);
  if (readiness && !readiness.eligible) throw new SenderError('This racer is spectating.');
  const dynamics = VEHICLE_DYNAMICS[profile.vehicle_type] ?? VEHICLE_DYNAMICS.auto;
  if (selectedMatch.tick_count - position.last_attack_tick < BigInt(dynamics.attackCooldownTicks)) {
    throw new SenderError('Attack is still on cooldown.');
  }

  // Nearest live racer beside or just ahead of the attacker. Lane centres are
  // 3.2m apart, so the old 1.9m lateral gate accidentally excluded every
  // neighboring lane even though attacks are meant to reach road racers.
  const target = [...ctx.db.player_position.match_id.filter(profile.match_id)]
    .filter(candidate => candidate.player_id !== player_id)
    .filter(candidate => !ctx.db.player_vitals.player_id.find(candidate.player_id)?.eliminated)
    .filter(candidate => Math.abs(candidate.x - position.x) <= LANE_WIDTH + 0.65)
    .filter(candidate => Math.abs(candidate.distance - position.distance) <= dynamics.attackRange)
    .sort((a, b) => {
      const aX = a.x - position.x;
      const aZ = a.distance - position.distance;
      const bX = b.x - position.x;
      const bZ = b.distance - position.distance;
      return aX * aX + aZ * aZ - (bX * bX + bZ * bZ);
    })[0];
  if (!target) throw new SenderError('No racer in range.');

  const targetVitals = ctx.db.player_vitals.player_id.find(target.player_id)!;
  const strikes = Math.max(0, targetVitals.strikes_remaining - 1);
  const eliminated = strikes === 0;
  const racersAlive = [...ctx.db.player_vitals.match_id.filter(profile.match_id)].filter(row => !row.eliminated).length;
  ctx.db.player_vitals.player_id.update({
    ...targetVitals, strikes_remaining: strikes, eliminated,
    rank: eliminated ? racersAlive : targetVitals.rank,
  });
  const fieldSize = [...ctx.db.player_profile.match_id.filter(profile.match_id)].length;
  const attackRoadHalfWidth = (laneCountFor(fieldSize) - 1) / 2 * LANE_WIDTH + 1.45;
  const lateralDirection = Math.sign(target.x - position.x) || (target.x >= 0 ? 1 : -1);
  const knockDistance = dynamics.attack === 'ram' ? 1.55 : 0.9;
  ctx.db.player_position.player_id.update({
    ...target,
    x: Math.max(-attackRoadHalfWidth, Math.min(attackRoadHalfWidth, target.x + lateralDirection * knockDistance)),
    speed: target.speed * (dynamics.attack === 'ram' ? 0.72 : 0.88),
  });
  ctx.db.player_position.player_id.update({ ...position, last_attack_tick: selectedMatch.tick_count });
  ctx.db.attack_event.insert({
    attacker_player_id: player_id, target_player_id: target.player_id,
    attack_kind: dynamics.attack, strikes_remaining: strikes, created_at: ctx.timestamp,
  });
});

export const gameTick = spacetimedb.reducer({ timer: game_tick_schedule.rowType }, (ctx, { timer }) => {
  const selectedMatch = ctx.db.match.match_id.find(timer.match_id);
  if (!selectedMatch || selectedMatch.state !== 'active') return;
  const gate = ctx.db.match_start_gate.match_id.find(timer.match_id);
  if (gate?.race_starts_at && ctx.timestamp.microsSinceUnixEpoch < gate.race_starts_at.microsSinceUnixEpoch) return;
  const nextTick = selectedMatch.tick_count + 1n;
  const profiles = [...ctx.db.player_profile.match_id.filter(timer.match_id)];
  const lanes = laneCenters(laneCountFor(profiles.length));
  const roadHalfWidth = (lanes.length - 1) / 2 * LANE_WIDTH + 1.45;
  const activeObstaclesNow = [...ctx.db.obstacle.match_id.filter(timer.match_id)].filter(row => row.active);
  // Bots get sharper over the first ~40s of a round (from "notices traffic
  // late" to "reads the road well ahead") but are capped short of perfect
  // play, and always keep a chance to misjudge, so they stay beatable.
  const botSkill = Math.min(0.82, 0.2 + Number(nextTick) / 800);

  for (const profile of profiles) {
    const vitals = ctx.db.player_vitals.player_id.find(profile.player_id);
    const position = ctx.db.player_position.player_id.find(profile.player_id);
    if (!vitals || !position || vitals.eliminated) continue;
    let steering = position.steering;
    if (profile.is_bot) {
      const lookahead = 10 + botSkill * 12;
      const hazardsNow = activeObstaclesNow.filter(row => isHazard(row.kind));
      const hazardAhead = hazardsNow.find(row =>
        Math.abs(row.x - position.x) < 1.9
        && row.distance > position.distance
        && row.distance - position.distance < lookahead);
      if (Math.abs(position.x) > roadHalfWidth - 0.75) {
        steering = position.x > 0 ? -1 : 1;
      } else if (hazardAhead && ctx.random.integerInRange(0, 99) < botSkill * 100) {
        // Swerve toward the nearest lane that is clear across the same window.
        const clearLane = lanes
          .filter(x => !hazardsNow.some(row => Math.abs(row.x - x) < 1.9 && row.distance > position.distance && row.distance - position.distance < lookahead))
          .sort((a, b) => Math.abs(a - position.x) - Math.abs(b - position.x))[0];
        steering = clearLane === undefined ? (position.x > 0 ? -1 : 1) : Math.sign(clearLane - position.x) || 0;
      } else if (nextTick % 30n === 0n) {
        steering = ctx.random.integerInRange(-1, 1);
      } else if (nextTick % 30n === 8n) {
        steering = 0;
      }
    }
    const dynamics = VEHICLE_DYNAMICS[profile.vehicle_type] ?? VEHICLE_DYNAMICS.auto;
    const topSpeed = dynamics.topSpeed * (position.boost ? 1.12 : 1);
    const engineAcceleration = dynamics.acceleration * position.throttle * Math.max(0.15, 1 - position.speed / topSpeed);
    const acceleration = position.throttle > 0
      ? engineAcceleration
      : -dynamics.coastDeceleration;
    const speed = Math.max(0, Math.min(topSpeed, position.speed + acceleration * 0.05));
    const lateralSpeed = Math.min(4.2, speed * 0.18);
    const x = Math.max(-roadHalfWidth, Math.min(roadHalfWidth, position.x + steering * lateralSpeed * 0.05));
    const distance = position.distance + speed * 0.05;
    ctx.db.player_position.player_id.update({ ...position, x, speed, steering, distance });
    ctx.db.player_vitals.player_id.update({
      ...vitals,
      score: Math.max(vitals.score, Math.floor(distance - position.start_distance)),
    });
  }

  // Keep racers from visually and physically occupying the same road space.
  // The trailing racer is held behind the leading racer when their widths overlap.
  const activePositions = [...ctx.db.player_position.match_id.filter(timer.match_id)]
    .filter(position => !ctx.db.player_vitals.player_id.find(position.player_id)?.eliminated)
    .sort((a, b) => b.distance - a.distance);
  for (let frontIndex = 0; frontIndex < activePositions.length; frontIndex += 1) {
    const front = ctx.db.player_position.player_id.find(activePositions[frontIndex].player_id);
    if (!front) continue;
    for (let rearIndex = frontIndex + 1; rearIndex < activePositions.length; rearIndex += 1) {
      const rear = ctx.db.player_position.player_id.find(activePositions[rearIndex].player_id);
      if (!rear) continue;
      const gap = front.distance - rear.distance;
      if (gap >= 4.6) continue;
      if (Math.abs(front.x - rear.x) >= 1.9) continue;
      // Only prevent the trailing car from tunnelling through the leader.
      // Do NOT also crush its stored speed: a faster rear car must keep
      // building real speed while boxed in, so the instant it changes lane
      // (or the leader does) it actually pulls ahead instead of forever
      // being capped a hair below whichever bot it happened to sit behind.
      const separated = { ...rear, distance: front.distance - 4.6 };
      ctx.db.player_position.player_id.update(separated);
      activePositions[rearIndex] = separated;
    }
  }

  // Increase traffic with the field size while always preserving an open lane.
  const obstacleInterval = profiles.length >= 20 ? 24n : profiles.length >= 10 ? 32n : 52n;
  if (nextTick % obstacleInterval === 0n) {
    const lead = Math.max(0, ...[...ctx.db.player_position.match_id.filter(timer.match_id)].map(row => row.distance));
    // Spawn beyond the chase camera's useful range so traffic enters through
    // the fog instead of popping into the middle distance.
    const spawnDistance = lead + TRAFFIC_SPAWN_AHEAD;
    const laneOffset = ctx.random.integerInRange(0, lanes.length - 1);
    const blockingNow = activeObstaclesNow.filter(row => row.kind === 'traffic' || row.kind === 'police');
    const blockedLaneCount = lanes.filter(x => blockingNow.some(
      row => Math.abs(row.x - x) < 1.9 && Math.abs(row.distance - spawnDistance) < MIN_TRAFFIC_SPACING
    )).length;
    const openLanes = lanes
      .map((_, index) => lanes[(index + laneOffset) % lanes.length])
      .filter(x => !blockingNow.some(row =>
        Math.abs(row.x - x) < 1.9 && Math.abs(row.distance - spawnDistance) < MIN_TRAFFIC_SPACING));
    const desiredSpawnCount = profiles.length >= 10 ? 2 : 1;
    const spawnCount = Math.min(desiredSpawnCount, openLanes.length, Math.max(0, lanes.length - 1 - blockedLaneCount));
    for (let index = 0; index < spawnCount; index += 1) {
      ctx.db.obstacle.insert({
        obstacle_id: 0n, match_id: timer.match_id,
        // Stagger multi-car packs so adjacent meshes never form one abrupt,
        // perfectly flat wall. spawnCount remains capped below lane count.
        x: openLanes[index], distance: spawnDistance + index * 9,
        active: true, spawned_at_tick: nextTick,
        kind: ctx.random.integerInRange(0, 4) === 0 ? 'police' : 'traffic',
      });
    }
    // Heart pickups sit in the leftover lane of the same oncoming row so they
    // read as collectibles between the cars, not as a separate later pack.
    const gapLane = openLanes[spawnCount];
    if (gapLane !== undefined && ctx.random.integerInRange(0, 2) !== 0) {
      ctx.db.obstacle.insert({
        obstacle_id: 0n, match_id: timer.match_id,
        x: gapLane, distance: spawnDistance,
        active: true, spawned_at_tick: nextTick,
        kind: 'powerup',
      });
    }
  }

  if (nextTick % 70n === 0n) {
    const lead = Math.max(0, ...[...ctx.db.player_position.match_id.filter(timer.match_id)].map(row => row.distance));
    ctx.db.obstacle.insert({
      obstacle_id: 0n, match_id: timer.match_id,
      x: ctx.random.integerInRange(0, 1) === 0 ? -roadHalfWidth : roadHalfWidth,
      distance: lead + 72,
      active: true, spawned_at_tick: nextTick,
      kind: 'pedestrian',
    });
  }

  const obstacles = [...ctx.db.obstacle.match_id.filter(timer.match_id)];
  for (const currentObstacle of obstacles) {
    if (!currentObstacle.active) continue;
    const nextDistance = currentObstacle.kind === 'pedestrian'
      ? currentObstacle.distance - 0.18
      : currentObstacle.distance - 0.55;
    const nextX = currentObstacle.kind === 'pedestrian'
      ? pedestrianX(currentObstacle.obstacle_id, currentObstacle.spawned_at_tick, nextTick, roadHalfWidth)
      : currentObstacle.x;
    const moved = { ...currentObstacle, x: nextX, distance: nextDistance };
    ctx.db.obstacle.obstacle_id.update(moved);
    const hitX = currentObstacle.kind === 'pedestrian' ? 0.72 : currentObstacle.kind === 'powerup' ? 1.05 : 1.35;
    const hitZ = currentObstacle.kind === 'pedestrian' ? 1.15 : currentObstacle.kind === 'powerup' ? 1.35 : 4.1;
    for (const position of ctx.db.player_position.match_id.filter(timer.match_id)) {
      const vitals = ctx.db.player_vitals.player_id.find(position.player_id);
      if (!vitals || vitals.eliminated || Math.abs(position.x - moved.x) > hitX) continue;
      // The longest traffic mesh is a bus, so resolve the collision before the
      // models can visually pass through one another.
      if (Math.abs(position.distance - moved.distance) > hitZ) continue;
      const pickup = currentObstacle.kind === 'powerup';
      const strikes = pickup
        ? Math.min(MAX_LIVES, vitals.strikes_remaining + 1)
        : Math.max(0, vitals.strikes_remaining - 1);
      const eliminated = !pickup && strikes === 0;
      const racersAlive = [...ctx.db.player_vitals.match_id.filter(timer.match_id)].filter(row => !row.eliminated).length;
      ctx.db.player_vitals.player_id.update({
        ...vitals,
        strikes_remaining: strikes,
        eliminated,
        rank: eliminated ? racersAlive : vitals.rank,
      });
      ctx.db.obstacle.obstacle_id.update({
        ...moved,
        active: false,
        // Reuse the existing tick field as the start of the short retirement
        // window. This keeps the migration schema-compatible.
        spawned_at_tick: nextTick,
      });
      ctx.db.collision_event.insert({
        player_id: position.player_id,
        obstacle_id: moved.obstacle_id,
        strikes_remaining: strikes,
        kind: currentObstacle.kind,
        created_at: ctx.timestamp,
      });
      break;
    }
  }

  const livePositions = [...ctx.db.player_position.match_id.filter(timer.match_id)]
    .filter(row => !ctx.db.player_vitals.player_id.find(row.player_id)?.eliminated);
  const trailingDistance = livePositions.length
    ? Math.min(...livePositions.map(row => row.distance))
    : Math.max(0, ...[...ctx.db.player_position.match_id.filter(timer.match_id)].map(row => row.distance));
  for (const oldObstacle of [...ctx.db.obstacle.match_id.filter(timer.match_id)]) {
    const vehicleHazard = oldObstacle.kind === 'traffic' || oldObstacle.kind === 'police';
    const retirementComplete = !oldObstacle.active
      && (!vehicleHazard || nextTick - oldObstacle.spawned_at_tick >= VEHICLE_RETIRE_TICKS);
    // Cleanup follows the last live racer, not the leader. Using leadNow here
    // deleted hazards that were still visibly approaching trailing players.
    if (retirementComplete || (oldObstacle.active && oldObstacle.distance < trailingDistance - 45)) {
      ctx.db.obstacle.obstacle_id.delete(oldObstacle.obstacle_id);
    }
  }

  const allVitals = [...ctx.db.player_vitals.match_id.filter(timer.match_id)];
  const alive = allVitals.filter(row => !row.eliminated);
  const timedOut = nextTick >= MAX_MATCH_TICKS;
  if (alive.length <= 1 || timedOut) {
    // A normal round ends with the sole surviving racer. If time runs out,
    // award the round to the highest distance score so every round has a
    // deterministic result rather than leaving an event lobby stuck active.
    const winner = alive.length === 1
      ? alive[0]
      : [...allVitals].sort((a, b) => b.score - a.score || Number(a.player_id - b.player_id))[0];
    if (winner) {
      const winnerVitals = ctx.db.player_vitals.player_id.find(winner.player_id);
      if (winnerVitals) ctx.db.player_vitals.player_id.update({ ...winnerVitals, rank: 1 });
    }
    ctx.db.match.match_id.update({
      ...selectedMatch, tick_count: nextTick, state: 'finished',
      finished_at: ctx.timestamp, winner_player_id: winner?.player_id,
    });
    ctx.db.game_tick_schedule.scheduled_id.delete(timer.scheduled_id);
    return;
  }
  ctx.db.match.match_id.update({ ...selectedMatch, tick_count: nextTick });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  if (ctx.connectionId) ctx.db.client_session.connection_id.delete(ctx.connectionId);
  const stillConnected = [...ctx.db.client_session.iter()].some(session => session.identity.equals(ctx.sender));
  if (stillConnected) return;
  const preparingMatches = new Set<bigint>();
  for (const profile of ctx.db.player_profile.iter()) {
    if (!profile.identity?.equals(ctx.sender)) continue;
    const selectedMatch = ctx.db.match.match_id.find(profile.match_id);
    if (!selectedMatch || selectedMatch.state === 'waiting' || selectedMatch.state === 'finished') continue;
    if (selectedMatch.state === 'preparing') preparingMatches.add(selectedMatch.match_id);
    const position = ctx.db.player_position.player_id.find(profile.player_id);
    if (position) {
      ctx.db.player_position.player_id.update({
        ...position,
        steering: 0,
        throttle: 0,
        boost: false,
      });
    }
  }
  for (const matchId of preparingMatches) {
    const selectedMatch = ctx.db.match.match_id.find(matchId);
    if (selectedMatch) beginCountdown(ctx, selectedMatch, false);
  }
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  if (!ctx.connectionId) return;
  ctx.db.client_session.insert({
    connection_id: ctx.connectionId,
    identity: ctx.sender,
    connected_at: ctx.timestamp,
  });
});
