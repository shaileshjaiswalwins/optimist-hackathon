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

export const init = spacetimedb.init(ctx => {
  ctx.db.match.insert({
    match_id: 0n,
    state: 'waiting',
    max_slots: 4,
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
      name: BOT_NAMES[index % BOT_NAMES.length],
      vehicle_type: BOT_VEHICLES[index % BOT_VEHICLES.length],
      is_bot: true, joined_at: ctx.timestamp,
    });
    ctx.db.player_vitals.insert({ player_id: profile.player_id, match_id, strikes_remaining: 3, score: 0, eliminated: false, rank: undefined });
  }

  const racers = [...ctx.db.player_profile.match_id.filter(match_id)];
  racers.forEach((racer, index) => {
    ctx.db.player_position.insert({
      player_id: racer.player_id, match_id,
      x: ((index % 3) - 1) * 3.2, distance: index * -3,
      speed: racer.is_bot ? 17 + (index % 3) : 12,
      steering: 0, throttle: racer.is_bot ? 0.72 : 0,
      boost: false, input_seq: 0,
    });
  });

  ctx.db.match.match_id.update({ ...selectedMatch, state: 'active', started_at: ctx.timestamp });
  ctx.db.game_tick_schedule.insert({
    scheduled_id: 0n,
    scheduled_at: ScheduleAt.interval(100_000n),
    match_id,
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
    if (profile.is_bot && nextTick % BigInt(11 + Number(profile.player_id % 5n)) === 0n) {
      steering = ctx.random.integerInRange(-1, 1);
    }
    const targetSpeed = 8 + position.throttle * 16 + (position.boost ? 7 : 0);
    const speed = position.speed + (targetSpeed - position.speed) * 0.14;
    const x = Math.max(-4.65, Math.min(4.65, position.x + steering * (3.2 + speed * 0.12) * 0.1));
    const distance = position.distance + speed * 0.1;
    ctx.db.player_position.player_id.update({ ...position, x, speed, steering, distance });
    ctx.db.player_vitals.player_id.update({ ...vitals, score: Math.max(vitals.score, Math.floor(distance)) });
  }

  if (nextTick % 16n === 0n) {
    const lead = Math.max(0, ...[...ctx.db.player_position.match_id.filter(timer.match_id)].map(row => row.distance));
    ctx.db.obstacle.insert({
      obstacle_id: 0n, match_id: timer.match_id,
      x: ctx.random.integerInRange(-1, 1) * 3.2, distance: lead + 72,
      active: true, spawned_at_tick: nextTick,
    });
  }

  const obstacles = [...ctx.db.obstacle.match_id.filter(timer.match_id)];
  for (const currentObstacle of obstacles) {
    if (!currentObstacle.active) continue;
    const moved = { ...currentObstacle, distance: currentObstacle.distance - 1.6 };
    ctx.db.obstacle.obstacle_id.update(moved);
    for (const position of ctx.db.player_position.match_id.filter(timer.match_id)) {
      const vitals = ctx.db.player_vitals.player_id.find(position.player_id);
      if (!vitals || vitals.eliminated || Math.abs(position.x - moved.x) > 1.35) continue;
      if (Math.abs(position.distance - moved.distance) > 2.8) continue;
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

  const alive = [...ctx.db.player_vitals.match_id.filter(timer.match_id)].filter(row => !row.eliminated);
  if (alive.length <= 1) {
    if (alive[0]) {
      const winnerVitals = ctx.db.player_vitals.player_id.find(alive[0].player_id);
      if (winnerVitals) ctx.db.player_vitals.player_id.update({ ...winnerVitals, rank: 1 });
    }
    ctx.db.match.match_id.update({
      ...selectedMatch, tick_count: nextTick, state: 'finished',
      finished_at: ctx.timestamp, winner_player_id: alive[0]?.player_id,
    });
    ctx.db.game_tick_schedule.scheduled_id.delete(timer.scheduled_id);
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
    return;
  }
  ctx.db.match.match_id.update({ ...selectedMatch, tick_count: nextTick });
});
