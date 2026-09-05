import { ScheduleAt } from 'spacetimedb';
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
});

const obstacle = table({ name: 'obstacle', public: true }, {
  obstacle_id: t.u64().primaryKey().autoInc(),
  match_id: t.u64().index('btree'),
  x: t.f32(),
  distance: t.f32(),
  active: t.bool(),
  spawned_at_tick: t.u64(),
});

const collision_event = table({ name: 'collision_event', public: true, event: true }, {
  player_id: t.u64(),
  obstacle_id: t.u64(),
  strikes_remaining: t.u8(),
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

const spacetimedb = schema({
  match,
  player_profile,
  player_contact,
  player_vitals,
  player_position,
  obstacle,
  collision_event,
  game_tick_schedule,
});
export default spacetimedb;

const VALID_VEHICLES = new Set(['auto', 'scooty', 'thar']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOT_NAMES = ['Rex', 'Kaka', 'Bijli', 'Maya'];
const BOT_VEHICLES = ['thar', 'auto', 'scooty', 'auto'];
const MAX_PLAYERS = 30;
const VEHICLE_DYNAMICS: Record<string, { topSpeed: number; acceleration: number; coastDeceleration: number }> = {
  auto: { topSpeed: 17.5, acceleration: 3.4, coastDeceleration: 0.9 },
  scooty: { topSpeed: 20, acceleration: 3.8, coastDeceleration: 0.75 },
  thar: { topSpeed: 24, acceleration: 4.2, coastDeceleration: 1.05 },
};
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
  if (!VALID_VEHICLES.has(vehicle_type)) throw new SenderError('Choose auto, scooty, or Thar.');

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

  for (let index = humans.length; index < selectedMatch.max_slots; index += 1) {
    const profile = ctx.db.player_profile.insert({
      player_id: 0n, match_id, identity: undefined,
      name: `${BOT_NAMES[index % BOT_NAMES.length]} ${index + 1}`,
      vehicle_type: BOT_VEHICLES[index % BOT_VEHICLES.length],
      is_bot: true, joined_at: ctx.timestamp,
    });
    ctx.db.player_vitals.insert({ player_id: profile.player_id, match_id, strikes_remaining: 3, score: 0, eliminated: false, rank: undefined });
  }

  const racers = [...ctx.db.player_profile.match_id.filter(match_id)];
  const startingLanes = [-3.2, 0, 3.2];
  racers.forEach((racer, index) => {
    const gridSpot = {
      x: startingLanes[index % startingLanes.length],
      distance: -Math.floor(index / startingLanes.length) * 5.2,
    };
    ctx.db.player_position.insert({
      player_id: racer.player_id, match_id,
      // Everyone begins together in a visible grid. Bots accelerate from rest
      // on the first ticks instead of appearing halfway up the road.
      x: gridSpot.x, distance: gridSpot.distance,
      speed: 0,
      steering: 0, throttle: racer.is_bot ? 0.72 : 0,
      boost: false, input_seq: 0,
    });
  });

  ctx.db.match.match_id.update({ ...selectedMatch, state: 'active', started_at: ctx.timestamp });
  ctx.db.game_tick_schedule.insert({
    scheduled_id: 0n,
    scheduled_at: ScheduleAt.interval(50_000n),
    match_id,
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

export const setDrivingInput = spacetimedb.reducer({
  player_id: t.u64(), steering: t.f32(), throttle: t.f32(), boost: t.bool(), input_seq: t.u32(),
}, (ctx, { player_id, steering, throttle, boost, input_seq }) => {
  const profile = ctx.db.player_profile.player_id.find(player_id);
  const position = ctx.db.player_position.player_id.find(player_id);
  if (!profile?.identity?.equals(ctx.sender) || !position) throw new SenderError('You cannot control this racer.');
  if (steering < -1 || steering > 1 || throttle < 0 || throttle > 1) throw new SenderError('Invalid driving input.');
  if (input_seq <= position.input_seq) return;
  ctx.db.player_position.player_id.update({ ...position, steering, throttle, boost, input_seq });
});

export const gameTick = spacetimedb.reducer({ timer: game_tick_schedule.rowType }, (ctx, { timer }) => {
  const selectedMatch = ctx.db.match.match_id.find(timer.match_id);
  if (!selectedMatch || selectedMatch.state !== 'active') return;
  const nextTick = selectedMatch.tick_count + 1n;
  const profiles = [...ctx.db.player_profile.match_id.filter(timer.match_id)];

  for (const profile of profiles) {
    const vitals = ctx.db.player_vitals.player_id.find(profile.player_id);
    const position = ctx.db.player_position.player_id.find(profile.player_id);
    if (!vitals || !position || vitals.eliminated) continue;
    let steering = position.steering;
    if (profile.is_bot) {
      if (Math.abs(position.x) > 3.9) steering = position.x > 0 ? -1 : 1;
      else if (nextTick % 30n === 0n) steering = ctx.random.integerInRange(-1, 1);
      else if (nextTick % 30n === 8n) steering = 0;
    }
    const dynamics = VEHICLE_DYNAMICS[profile.vehicle_type] ?? VEHICLE_DYNAMICS.auto;
    const topSpeed = dynamics.topSpeed * (position.boost ? 1.12 : 1);
    const engineAcceleration = dynamics.acceleration * position.throttle * Math.max(0.15, 1 - position.speed / topSpeed);
    const acceleration = position.throttle > 0
      ? engineAcceleration
      : -dynamics.coastDeceleration;
    const speed = Math.max(0, Math.min(topSpeed, position.speed + acceleration * 0.05));
    const lateralSpeed = Math.min(4.2, speed * 0.18);
    const x = Math.max(-4.65, Math.min(4.65, position.x + steering * lateralSpeed * 0.05));
    const distance = position.distance + speed * 0.05;
    ctx.db.player_position.player_id.update({ ...position, x, speed, steering, distance });
    ctx.db.player_vitals.player_id.update({ ...vitals, score: Math.max(vitals.score, Math.floor(distance)) });
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
      const separated = {
        ...rear,
        distance: front.distance - 4.6,
        speed: Math.min(rear.speed, Math.max(0, front.speed - 0.5)),
      };
      ctx.db.player_position.player_id.update(separated);
      activePositions[rearIndex] = separated;
    }
  }

  // Increase traffic with the field size while always preserving an open lane.
  const obstacleInterval = profiles.length >= 20 ? 24n : profiles.length >= 10 ? 32n : 52n;
  if (nextTick % obstacleInterval === 0n) {
    const lead = Math.max(0, ...[...ctx.db.player_position.match_id.filter(timer.match_id)].map(row => row.distance));
    const spawnDistance = lead + 100;
    const lanes = [-3.2, 0, 3.2];
    const laneOffset = ctx.random.integerInRange(0, lanes.length - 1);
    const activeObstacles = [...ctx.db.obstacle.match_id.filter(timer.match_id)].filter(row => row.active);
    const blockedLaneCount = lanes.filter(x => activeObstacles.some(
      row => Math.abs(row.x - x) < 1.9 && Math.abs(row.distance - spawnDistance) < 20
    )).length;
    const openLanes = lanes
      .map((_, index) => lanes[(index + laneOffset) % lanes.length])
      .filter(x => !activeObstacles.some(row => Math.abs(row.x - x) < 1.9 && Math.abs(row.distance - spawnDistance) < 20));
    const desiredSpawnCount = profiles.length >= 10 ? 2 : 1;
    const spawnCount = Math.min(desiredSpawnCount, openLanes.length, Math.max(0, 2 - blockedLaneCount));
    for (let index = 0; index < spawnCount; index += 1) {
      ctx.db.obstacle.insert({
        obstacle_id: 0n, match_id: timer.match_id,
        x: openLanes[index], distance: spawnDistance,
        active: true, spawned_at_tick: nextTick,
      });
    }
  }

  const obstacles = [...ctx.db.obstacle.match_id.filter(timer.match_id)];
  for (const currentObstacle of obstacles) {
    if (!currentObstacle.active) continue;
    const moved = { ...currentObstacle, distance: currentObstacle.distance - 0.5 };
    ctx.db.obstacle.obstacle_id.update(moved);
    for (const position of ctx.db.player_position.match_id.filter(timer.match_id)) {
      const vitals = ctx.db.player_vitals.player_id.find(position.player_id);
      if (!vitals || vitals.eliminated || Math.abs(position.x - moved.x) > 1.35) continue;
      // The longest traffic mesh is a bus, so resolve the collision before the
      // models can visually pass through one another.
      if (Math.abs(position.distance - moved.distance) > 4.1) continue;
      const strikes = Math.max(0, vitals.strikes_remaining - 1);
      const eliminated = strikes === 0;
      const racersAlive = [...ctx.db.player_vitals.match_id.filter(timer.match_id)].filter(row => !row.eliminated).length;
      ctx.db.player_vitals.player_id.update({
        ...vitals,
        strikes_remaining: strikes,
        eliminated,
        rank: eliminated ? racersAlive : vitals.rank,
      });
      ctx.db.obstacle.obstacle_id.update({ ...moved, active: false });
      ctx.db.collision_event.insert({ player_id: position.player_id, obstacle_id: moved.obstacle_id, strikes_remaining: strikes, created_at: ctx.timestamp });
      break;
    }
  }

  const leadNow = Math.max(0, ...[...ctx.db.player_position.match_id.filter(timer.match_id)].map(row => row.distance));
  for (const oldObstacle of [...ctx.db.obstacle.match_id.filter(timer.match_id)]) {
    if (!oldObstacle.active || oldObstacle.distance < leadNow - 40) {
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
