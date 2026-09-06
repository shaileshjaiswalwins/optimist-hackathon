# Jaldi Ghar Pahuncho — Game Design & Build Spec

## 0. Quick Context

Jaldi Ghar Pahuncho ("Reach Home Fast") is a multiplayer browser driving game built for a live event: players scan a QR code on their phone, join a match, and race to dodge traffic on an endless street before getting eliminated. It is built for a coding agent to pick up cold and keep building — this document is the single source of truth for scope, data model, client flow, bot behavior, and build order. Repo: `https://github.com/shaileshjaiswalwins/optimist-hackathon`. SpacetimeDB database name: `jaldigharpahuncho`. Stack: Three.js + Rapier (WASM) physics on the client, React + Vite + TypeScript for the UI, SpacetimeDB as the realtime authoritative backend, shadcn/ui for UI components, shadcnloaders.com for loading spinners, and Smallest AI for short event-triggered TTS voice lines.

---

## 1. Game Overview & Plot

**Title:** Jaldi Ghar Pahuncho ("Reach Home Fast")

**One-line pitch:** A multiplayer browser driving game. Players race an endless Indian street, dodging traffic and hazards, racing to get home before a deadline.

**Plot framing:** Each player is rushing home for a personal deadline. The game screen shows one reason, chosen at random per match (for example: a wedding muhurat, a school exam bell, a train departure). The framing line "Ghar Jaldi Pahuncho" appears on screen. This is flavor text only. It does not change gameplay rules.

**Core fantasy:** Weave through chaotic traffic, survive hits, outlast other players (and bots), and be the last one standing.

**Setting:** An endless straight road. The camera sits behind and above the player's vehicle (third-person chase camera). The road never ends — it is procedurally extended as the player advances. There is no lap or finish line in the MVP; survival and elimination decide the winner.

**Tone:** Comic and lighthearted, not violent. Collisions are "dhakkas" (bumps), not crashes with gore. The police response ("ehhh, ruko!") is played for laughs, not menace.

**Players:**
- Real players join by scanning a QR code on their own phone.
- Each match holds up to 4 total participants (real players + AI bots, see Section 6/bots spec for detail).
- If fewer than 4 real players join, AI-driven bots with distinct personas fill the remaining slots so the match never looks empty.

---

## 2. MVP Scope (What's IN vs OUT)

The MVP must be the **smallest version of this game that is genuinely fun to play end-to-end**: join on phone, pick a vehicle, drive, dodge one real hazard, take hits, get eliminated or win, see a leaderboard. Everything else is deferred.

### 2.1 MVP-CRITICAL (must ship)

**Join flow**
- QR code scan opens the join page on the player's phone.
- Player enters email, with a visible consent statement (what the email is used for, that it is stored).
- Player enters a display name.
- Player picks one vehicle: auto, scooty, or Mahindra Thar.
- Player is placed into the current/next match.

**Core gameplay loop**
- Endless straight road, procedurally extended.
- Third-person chase camera following the player's vehicle.
- Basic drive controls suited to a phone screen (steer left/right, accelerate; exact input scheme — touch buttons vs tilt vs swipe lane-change — to be decided in the controls-spec section, but some working phone control scheme is MVP-required).
- Three.js rendering + Rapier (WASM) physics for vehicle movement and collision detection.
- SpacetimeDB holds realtime authoritative match state (player positions, health, obstacles, match status) so all clients and the leaderboard screen stay in sync.

**Obstacles — minimum one type**
- At least ONE obstacle type must be implemented and working: pick the simplest to build first (recommendation: vehicles coming in the wrong direction — `wrong_way`, since it reuses vehicle assets/physics already built for players). The other obstacle flavors (stray animals, pedestrians raising a hand, road-blocking crowd/AIJP protest) are v2 variety — see 2.2.
- Obstacles spawn continuously as the player advances, at a fixed or lightly-randomized rate. Full difficulty-scaling curves are v2 (see below); MVP may ship with a flat or a single simple ramp-up.

**Strikes / health / elimination**
- Each player starts with a fixed number of strikes (e.g. 3).
- Each collision with an obstacle or another vehicle consumes one strike.
- On a hit: a police car appears with a cop leaning out shouting "ehhh, ruko!" — this comic-relief beat is MVP-critical, it is the core feedback moment for a hit.
- One short Smallest AI TTS voice line plays on hit (see Voice AI below for exact scope).
- At 0 strikes, the player is eliminated and removed from active play (spectator or match-end screen — simplest possible handling is fine).

**Win condition**
- Match ends when only one player (human or bot) remains.
- That remaining player/bot is declared the winner. Simple win screen is sufficient.

**Leaderboard**
- A live projector/big-screen view showing: all players and bots, their current strikes remaining, and who is currently in the lead (e.g. furthest along the road, or last-standing order).
- Must update in realtime via SpacetimeDB as strikes/positions/eliminations change.
- Visual polish of this screen is not required for MVP — data correctness and realtime updates are.

**Bots (fill-to-4)**
- If fewer than 4 real players have joined when the match starts, AI bots fill remaining slots up to 4 total.
- Bots must have at least a minimal distinct persona feel (e.g. reckless Thar bro drives aggressively, cautious auto uncle drives defensively) — this is MVP-critical because an empty-feeling match is a failed MVP demo.
- Bot control approach: periodic (every 1–2s) LLM-generated high-level intent (steer left/right/boost/hold), executed by a simple rule-based controller each frame. Per-frame LLM calls are explicitly OUT — too slow/costly.

**Vehicle selection**
- All three vehicles (auto, scooty, Mahindra Thar) must be selectable and drivable, even if their physics/handling differences are minimal at MVP (e.g. only different top speed or size/hitbox). Deep handling differentiation is a v2 nice-to-have.

**Voice AI (Smallest AI) — narrow scope**
- Short TTS voice lines on key discrete events only: crash/hit, police chase appearance, elimination, win.
- These are pre-scripted short lines sent to Smallest AI for TTS, not continuous commentary and not dynamically LLM-generated dialogue. This is the full MVP scope for voice — anything beyond these four event types is v2.

**Infra**
- SpacetimeDB module/database named `jaldigharpahuncho`, deployed and reachable by clients.
- React + Vite + TypeScript frontend, shadcn/ui for join-flow and leaderboard UI components, shadcnloaders.com spinner for loading/connecting states.

### 2.2 EXPLICITLY DEFERRED TO V2 (do not build for MVP)

- **Day/night cycle** or any time-of-day visual variation.
- **Multiple obstacle variety in the same match**: stray animals, pedestrians raising a hand, road-blocking crowd. MVP ships with one obstacle type only; the rest are v2 additions once the core loop is proven fun.
- **Full "AIJP - AI Janta Party" protest flavor**: the protest-crowd obstacle, its signage/chants, and any satirical flavor text are v2. Note: whenever this obstacle is eventually built (v2), it must stay visually neutral/generic — no real political party names, symbols, or colors — this constraint carries forward regardless of when it ships. The AIJP obstacle is satirical-neutral only: it pokes fun at generic traffic-jam/protest chaos, never at a real party, person, or symbol.
- **Difficulty scaling with score** (heavier obstacle density/music/effects as score rises): MVP may use a flat or minimal spawn rate; a real difficulty curve tied to score is v2 polish.
- **Voice AI polish**: dynamically generated commentary, persona-specific voice lines, reacting to gameplay nuance beyond the four fixed event types, multiple voice variations per event.
- **Admin dashboard / analytics**: any screen for organizers to see match history, player stats over time, email capture reporting, etc. MVP only needs the live in-match leaderboard.
- **Deep vehicle handling differentiation** (distinct suspension, drift behavior, acceleration curves per vehicle) beyond a basic stat difference.
- **Spectator mode UI polish**, post-elimination camera modes, replay/highlight reels.
- **Match matchmaking/lobby polish** (custom room codes, private matches, rejoin-after-disconnect flows) beyond the single QR-join-into-current-match flow.
- **Sound design beyond the four voice events** (ambient traffic audio, music layers) — nice to have, not MVP-blocking.

### 2.3 Cut rationale

The cut line is: *does removing this feature stop the game from being a complete, winnable, fun round?* Join → pick vehicle → drive → dodge something → get hit and see the comic police beat → get eliminated or win → see it reflected on a leaderboard is the smallest complete loop. Everything deferred is variety, polish, or tooling that makes the shipped loop richer but is not needed to prove the loop works.

---

## 3. Tech Stack & Architecture

### 3.1 Monorepo layout

```
optimist-hackathon/
├── client/                          # React + Vite front end
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── components.json             # shadcn/ui config
│   ├── package.json
│   ├── public/
│   │   └── models/                 # car .glb assets, track meshes
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css                # @import "tailwindcss"; + theme tokens
│       ├── components/
│       │   ├── ui/                  # shadcn/ui primitives (button, card, dialog, ...)
│       │   ├── loaders/              # shadcnloaders.com components (copy-pasted)
│       │   ├── JoinScreen.tsx
│       │   ├── VehicleSelect.tsx
│       │   ├── LeaderboardOverlay.tsx
│       │   └── HUD.tsx
│       ├── game/
│       │   ├── scene.ts              # Three.js scene/camera/renderer setup
│       │   ├── physics.ts            # Rapier world init + step loop
│       │   ├── vehicle.ts            # DynamicRayCastVehicleController wrapper
│       │   ├── loop.ts               # renderer.setAnimationLoop, fixed-step accumulator
│       │   └── sync.ts               # rigidBody -> mesh transform sync
│       ├── stdb/
│       │   ├── connection.ts         # DbConnection builder, subscription setup
│       │   └── generated/            # spacetime generate output (bindings.ts)
│       ├── audio/
│       │   └── tts.ts                # subscribes to tts_clip, plays returned audio
│       └── lib/
│           └── utils.ts              # cn() helper (shadcn convention)
│
├── server/                           # SpacetimeDB module (TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                  # table + reducer definitions
│       ├── tables/
│       │   ├── player_profile.ts
│       │   ├── player_position.ts
│       │   ├── player_vitals.ts
│       │   ├── bot_state.ts          # bot persona + latest intent (see 4.2, 6.2)
│       │   └── match.ts              # match lifecycle state (was "race_state" in early drafts)
│       └── reducers/
│           ├── join.ts               # join_match, pick_vehicle, fill_empty_slots_with_bots
│           ├── update_position.ts
│           ├── match_lifecycle.ts    # start_match, match_tick, end_match
│           └── tts_speak.ts           # writes voice_callout_job; off-chain worker calls Smallest AI
│
├── worker/                           # off-chain Node process for outbound Smallest AI calls
│   └── src/
│       └── voice_worker.ts           # polls voice_callout_job, calls Smallest AI, writes tts_clip
│
├── spacetime.toml                    # or module config for `spacetime publish`
├── package.json                      # root scripts (dev, build, deploy)
└── README.md
```

This mirrors the standard SpacetimeDB quickstart shape (a `client/` and a `server/` module side by side, each independently built and deployed), with `client/src/stdb/generated` populated by the SpacetimeDB CLI codegen step rather than hand-written. The `worker/` directory holds the small off-chain process described in 3.8 and 4.3 that performs the actual Smallest AI HTTP calls outside of any reducer.

### 3.2 Client dependencies

```jsonc
// client/package.json (dependencies)
{
  "three": "^0.170.0",
  "@dimforge/rapier3d-compat": "^0.14.0",
  "@clockworklabs/spacetimedb-sdk": "^1.x",   // TS client SDK, generated bindings depend on this
  "react": "^18.3.0",
  "react-dom": "^18.3.0",
  "tailwindcss": "^4.0.0",
  "@tailwindcss/vite": "^4.0.0",
  "class-variance-authority": "^0.7.0",       // pulled in by shadcn components
  "clsx": "^2.1.0",
  "tailwind-merge": "^2.5.0",
  "lucide-react": "^0.4xx.0",                 // icon set shadcn components use
  "framer-motion": "^11.x"                    // used by shadcnloaders.com loader components
}
```

```jsonc
// client/devDependencies
{
  "vite": "^6.0.0",
  "@vitejs/plugin-react": "^4.3.0",
  "typescript": "^5.6.0",
  "@types/node": "^22.0.0",
  "@types/three": "^0.170.0"
}
```

`@dimforge/rapier3d-compat` is the correct choice over plain `rapier3d`: it initializes WASM asynchronously via `await RAPIER.init()`, which works under Vite's dev server and production build without extra WASM-loader config. shadcn/ui itself is **not** an npm dependency — its CLI copies component source into `client/src/components/ui/`, so those files live in the repo and their transitive needs (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`) are what actually appear in `package.json`. Loader components from shadcnloaders.com follow the identical copy-paste pattern into `client/src/components/loaders/`, which is why `framer-motion` (their animation dependency) is listed explicitly.

### 3.3 Server (SpacetimeDB module) dependencies

```jsonc
// server/package.json
{
  "dependencies": {
    "@clockworklabs/spacetimedb-server": "^1.x"   // TS module SDK: table/reducer decorators, ctx.db
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

The module is compiled and published with the `spacetime` CLI (already installed locally at `~/.local/bin/spacetime`, v2.8.3):

```bash
spacetime build server
spacetime publish --project-path server jaldigharpahuncho --server maincloud
spacetime generate --lang typescript --out-dir client/src/stdb/generated --project-path server
```

The `worker/` process (3.1, 3.8, 4.3) is a plain Node/TS script — it is not a SpacetimeDB module, so it depends on `@clockworklabs/spacetimedb-sdk` (the client-style SDK, to subscribe/write like any other client) rather than `-server`, plus a standard `fetch`-capable Node runtime for calling Smallest AI.

### 3.4 Client ↔ SpacetimeDB communication

The client never polls. It opens one WebSocket connection via the generated `DbConnection` and declares subscriptions; SpacetimeDB pushes row diffs on any change.

```ts
// client/src/stdb/connection.ts
import { DbConnection } from './generated';

const conn = DbConnection.builder()
  .withUri('wss://maincloud.spacetimedb.com')
  .withModuleName('jaldigharpahuncho')
  .onConnect((conn, identity, token) => {
    conn.subscriptionBuilder()
      .onApplied(() => console.log('subscribed'))
      .subscribe([
        'SELECT * FROM player_position',
        'SELECT * FROM player_profile',
        'SELECT * FROM player_vitals',
        'SELECT * FROM match',
      ]);
  })
  .build();

conn.db.playerPosition.onInsert((ctx, row) => { /* spawn remote car */ });
conn.db.playerPosition.onUpdate((ctx, oldRow, newRow) => { /* buffer for interpolation */ });
```

Per the split-table pattern, `player_position` (x/y/z, rotation, updated 10–20Hz) is separate from `player_profile` (name, vehicle_type, is_bot — set once) and `player_vitals`/`match` (changed on discrete events only), so a client subscribed to positions doesn't pay diff cost for unrelated profile or match-state churn. `match` is the single table holding overall match lifecycle (`state`: `"waiting" | "active" | "finished"`, timestamps, winner) — see Section 4 for the full schema; there is no separate `race_state` table, and any earlier reference to one refers to this same `match` table.

Client → server is exclusively reducer calls, never direct writes:

```ts
conn.reducers.updatePosition(x, y, z, rotationQuat, inputSeq);
conn.reducers.joinMatch(matchId, email, consentGiven, name);
```

The client throttles its own call rate (accumulate input each render frame, call `updatePosition` at a fixed 15Hz tick) since SpacetimeDB does not publish a per-client reducer rate cap — the module itself also tracks `last_update_tick` per player and no-ops calls arriving faster than budget, guarding against a runaway or malicious client.

### 3.5 Three.js render loop + Rapier physics step

Physics runs on a fixed timestep, decoupled from the variable-rate render loop, using an accumulator:

```ts
// client/src/game/loop.ts
let accumulator = 0;
const FIXED_DT = 1 / 60;

renderer.setAnimationLoop((time) => {
  const frameDt = clock.getDelta();
  accumulator += frameDt;

  while (accumulator >= FIXED_DT) {
    world.step(eventQueue);
    accumulator -= FIXED_DT;
  }

  syncMeshesFromBodies();   // read rigidBody.translation()/rotation() into Three meshes
  renderer.render(scene, camera);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) world.timestep = 0; // effectively pause physics work while backgrounded
});
```

`renderer.setAnimationLoop` (not raw `requestAnimationFrame`) is used so the browser can pause/resume cleanly on tab visibility changes. Vehicle control per fixed step goes through Rapier's native `DynamicRayCastVehicleController` (`controller.setWheelSteering`, `setWheelEngineForce`, `setWheelBrake`, `updateVehicle(dt)`), with wheel meshes positioned each frame from `controller.wheelSuspensionLength(i)` / `wheelRotation(i)`. Mobile perf settings apply at renderer creation: `antialias: false`, `powerPreference: 'high-performance'`, `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))`, shadows disabled, road/prop geometry pooled via `InstancedMesh`.

> Note: Section 5.8 describes the shipped MVP control scheme as impulse/torque-driven on a single dynamic rigidbody (simpler, no per-wheel suspension). The `DynamicRayCastVehicleController` path above is the richer per-wheel model; treat it as the upgrade path once the simpler impulse-based controller (5.8) is working end-to-end, not as a second parallel implementation.

### 3.6 shadcn/ui — join / vehicle-select / leaderboard

Setup (once, in `client/`):

```bash
npm install tailwindcss @tailwindcss/vite
npx shadcn@latest init
npx shadcn@latest add button card dialog avatar tabs progress
```

This copies component source into `src/components/ui/`, imported directly:

```tsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

function VehicleSelect({ onPick }: { onPick: (v: string) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle>Choose Your Ride</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-3 gap-4">
        {vehicles.map(v => (
          <Button key={v.id} variant="outline" onClick={() => onPick(v.id)}>{v.name}</Button>
        ))}
      </CardContent>
    </Card>
  );
}
```

`LeaderboardOverlay.tsx` reuses `Card`/`Table`-style shadcn primitives, positioned as a fixed-position React overlay above the WebGL `<canvas>`, driven by `conn.db.match`/`conn.db.playerProfile`/`conn.db.playerVitals` subscription state (React re-renders on row updates via a small hook wrapping `onInsert`/`onUpdate` callbacks) — it never touches the Three.js scene graph directly.

### 3.7 shadcnloaders.com — QR-join loading state

Loader components follow the same copy-paste convention as shadcn/ui itself (no npm package): copy the chosen loader's source from shadcnloaders.com into `client/src/components/loaders/`, then import it locally:

```tsx
import { PulseLoader } from '@/components/loaders/pulse-loader';

function JoinScreen() {
  const [connecting, setConnecting] = useState(true);
  return connecting
    ? <PulseLoader label="Scanning QR / connecting..." />
    : <VehicleSelect onPick={handlePick} />;
}
```

Shown between QR scan and the SpacetimeDB `onConnect` callback firing (and again between vehicle pick and the `pick_vehicle` reducer's confirmation row arriving in `player_profile`), so the player always has visual feedback during the WebSocket handshake and reducer round trip.

### 3.8 Smallest AI TTS — server-side job queue, not client-side and not inline in a reducer

**Recommendation: never call Smallest AI from the browser, and never call it synchronously from inside a SpacetimeDB reducer either — go through a job-queue table plus a small off-chain worker process.**

Reasoning: the Waves API requires `Authorization: Bearer <API_KEY>` on every request. Any client-side `fetch` — even one hitting a same-origin proxy you forgot to lock down — risks the key ending up in browser devtools, a bundled JS file, or a request log, so the key must never reach the client at all. Separately, SpacetimeDB reducers are meant to be fast and transactional; they should not block on an outbound network call to a third-party API whose latency is out of your control (Smallest AI TTS calls can take real wall-clock time, and a slow or failed external call inside a reducer risks holding up the transaction and, at concurrency, the module's throughput). Both concerns are solved the same way: the reducer only ever writes a row describing *what* should be spoken, and a separate always-on Node worker process, holding the API key as a plain environment variable, does the actual HTTP call and writes the result back.

```ts
// server/src/reducers/tts_speak.ts — module reducer: enqueue only, no outbound HTTP
// This is the same triggerAiVoiceCallout reducer defined in Section 4.3, shown
// here again to make the "enqueue, don't call out" pattern explicit in context.
import { t } from '@clockworklabs/spacetimedb-server';
import { spacetimedb } from './schema'; // the schema({...}) value from Section 4.2

export const triggerAiVoiceCallout = spacetimedb.reducer(
  { player_id: t.u64(), persona: t.string(), trigger_type: t.string(), context_text: t.string() },
  (ctx, { player_id, persona, trigger_type, context_text }) => {
    ctx.db.voice_callout_job.insert({
      job_id: 0n,
      match_id: ctx.db.player_profile.player_id.find(player_id)!.match_id,
      player_id,
      persona,
      trigger_type,   // "collision" | "elimination" | "near_miss" | "taunt" | "win"
      context_text,
      status: 'pending',
      created_at: ctx.timestamp,
    });
  }
);
```

```ts
// worker/src/voice_worker.ts — off-chain Node process, polls/subscribes to voice_callout_job
import { DbConnection } from '../../client/src/stdb/generated';

const SMALLEST_AI_API_KEY = process.env.SMALLEST_AI_API_KEY!; // never committed, never sent to any client

conn.db.voiceCalloutJob.onInsert(async (ctx, job) => {
  if (job.status !== 'pending') return;
  const res = await fetch('https://api.smallest.ai/waves/v1/lightning-v3.1/get_speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SMALLEST_AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: job.context_text, voice_id: 'sophia', sample_rate: 24000, output_format: 'wav' }),
  });
  const audioBytes = new Uint8Array(await res.arrayBuffer());
  conn.reducers.completeVoiceCalloutJob(job.job_id, audioBytes); // writes tts_clip + status="done"
});
```

The client subscribes to `tts_clip` and plays the resulting clip once it lands:

```ts
// client/src/audio/tts.ts
conn.reducers.ttsSpeak(myPlayerId, myPersonaId, 'collision', "Jaldi ghar pahuncho!");

conn.db.ttsClip.onInsert((ctx, row) => {
  if (row.player_id !== myPlayerId) return;
  const blob = new Blob([row.audio], { type: 'audio/wav' });
  new Audio(URL.createObjectURL(blob)).play();
});
```

This keeps the API key server-only (in the worker's environment, never in the module or the client), centralizes rate-limiting/cost control for TTS calls in one place, and matches the general architecture principle here: the client renders and inputs, the SpacetimeDB module is the sole source of authoritative state, and only the off-chain worker — not the module, not the browser — holds outbound third-party secrets and makes outbound third-party calls. See `voice_callout_job` and `tts_clip` schemas in Section 4.2, and 4.3's `trigger_ai_voice_callout` reducer for the server-side event trigger that populates the job.

---

## 4. SpacetimeDB Data Model & Reducers

### 4.1 Design rationale

State is split by change-rate, per SpacetimeDB's row-diffing model:

- **Hot tables (10–20Hz writes)**: `player_position`, `obstacle` — position/rotation/velocity churn every tick and must not drag slow fields along with them.
- **Warm tables (event-driven writes)**: `player_vitals` (strikes/eliminated), `collision_event`, `police_event`, `bot_state` (updated every 1–2s per bot), `voice_callout_job` / `tts_clip` (updated per triggered event).
- **Cold tables (write-once / rare writes)**: `player_profile` (name, vehicle, is_bot, score), `match`.
- A **leaderboard view** is not its own writable table — it's a subscription query joining `player_profile` + `player_vitals` + `player_position` on `player_id`, so clients get one coherent read without the server maintaining a redundant denormalized row.
- **Scheduled tables** drive time-based server logic without an external cron: `obstacle_spawn_schedule` (spawns obstacles at intervals), `match_tick_schedule` (per-match heartbeat: timers, win/finish checks), and `bot_intent_schedule` (per-bot heartbeat: LLM intent refresh).

### 4.2 Table definitions

```typescript
import { table, schema, t, spacetimedb } from "@clockworklabs/spacetimedb-server";

// ---------------------------------------------------------------------------
// COLD / SLOW-CHANGING STATE
// ---------------------------------------------------------------------------

export const Match = table(
  { name: "match", public: true },
  {
    match_id: t.u64().primaryKey().autoInc(),
    state: t.string(), // "waiting" | "active" | "finished"
    created_at: t.timestamp(),
    started_at: t.timestamp().optional(),
    finished_at: t.timestamp().optional(),
    winner_player_id: t.u64().optional(),
    max_slots: t.u8(), // 4
  }
);

export const PlayerProfile = table(
  { name: "player_profile", public: true },
  {
    player_id: t.u64().primaryKey().autoInc(),
    match_id: t.u64().index(),
    identity: t.identity().index(), // SpacetimeDB connection identity
    email: t.string(), // captured post-consent from QR flow
    consent_given: t.bool(),
    name: t.string(),
    vehicle_type: t.string(), // "auto" | "scooty" | "thar" | "unassigned" until pick_vehicle runs
    is_bot: t.bool(),
    bot_persona: t.string().optional(), // persona tag, null for humans
    joined_at: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// WARM / EVENT-DRIVEN STATE
// ---------------------------------------------------------------------------

export const PlayerVitals = table(
  { name: "player_vitals", public: true },
  {
    player_id: t.u64().primaryKey(), // == PlayerProfile.player_id
    match_id: t.u64().index(),
    strikes: t.u8(),
    max_strikes: t.u8(), // e.g. 3
    score: t.u32(),
    eliminated: t.bool(),
    eliminated_at: t.timestamp().optional(),
    rank: t.u8().optional(),
  }
);

export const CollisionEvent = table(
  { name: "collision_event", public: true },
  {
    event_id: t.u64().primaryKey().autoInc(),
    match_id: t.u64().index(),
    player_id: t.u64().index(),
    other_player_id: t.u64().optional(), // set for player-vs-player hits
    obstacle_id: t.u64().optional(), // set for player-vs-obstacle hits
    obstacle_type: t.string().optional(), // "animal" | "wrong_way" | "pedestrian" | "crowd_block"
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    created_at: t.timestamp(),
  }
);

export const PoliceEvent = table(
  { name: "police_event", public: true },
  {
    event_id: t.u64().primaryKey().autoInc(),
    match_id: t.u64().index(),
    player_id: t.u64().index(),
    collision_event_id: t.u64(),
    triggered_at: t.timestamp(),
    resolved: t.bool(),
  }
);

export const BotState = table(
  { name: "bot_state", public: true },
  {
    player_id: t.u64().primaryKey(), // == PlayerProfile.player_id, where is_bot = true
    match_id: t.u64().index(),
    persona: t.string(), // e.g. "reckless_thar_bro" | "cautious_auto_uncle"
    intent_steer: t.string(), // "left" | "right" | "hold"
    intent_boost: t.bool(),
    intent_duration_ms: t.u32(),
    intent_updated_at: t.timestamp(),
  }
);

export const VoiceCalloutJob = table(
  { name: "voice_callout_job", public: true },
  {
    job_id: t.u64().primaryKey().autoInc(),
    match_id: t.u64().index(),
    player_id: t.u64().index(),
    persona: t.string(), // bot persona, or a default announcer persona for human-triggered events
    trigger_type: t.string(), // "collision" | "elimination" | "near_miss" | "taunt" | "win"
    context_text: t.string(), // short scene summary / line fed to Smallest AI for phrasing
    status: t.string(), // "pending" | "done" | "failed"
    created_at: t.timestamp(),
  }
);

export const TtsClip = table(
  { name: "tts_clip", public: true },
  {
    clip_id: t.u64().primaryKey().autoInc(),
    job_id: t.u64().optional().index(), // links back to voice_callout_job
    player_id: t.u64().index(),
    audio: t.bytes(), // WAV bytes returned by Smallest AI
    created_at: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// HOT / FAST-CHANGING STATE (10–20Hz)
// ---------------------------------------------------------------------------

export const PlayerPosition = table(
  { name: "player_position", public: true },
  {
    player_id: t.u64().primaryKey(), // == PlayerProfile.player_id
    match_id: t.u64().index(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    rotation: t.f32(),
    speed: t.f32(),
    input_seq: t.u32(), // last processed client input sequence
    last_update_tick: t.u64(), // server tick, used for rate-limiting
    server_tick: t.timestamp(), // for client-side interpolation buffers
  }
);

export const Obstacle = table(
  { name: "obstacle", public: true },
  {
    obstacle_id: t.u64().primaryKey().autoInc(),
    match_id: t.u64().index(),
    obstacle_type: t.string(), // "animal" | "wrong_way" | "pedestrian" | "crowd_block" — MVP ships "wrong_way" only
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    rotation: t.f32(),
    speed: t.f32(), // nonzero for wrong-way vehicle / animal
    active: t.bool(),
    spawned_at: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// SCHEDULED TABLES
// ---------------------------------------------------------------------------

export const ObstacleSpawnSchedule = table(
  { name: "obstacle_spawn_schedule", scheduled: (): any => spawnObstacleTick },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(), // interval, e.g. every 2s per active match
    match_id: t.u64(),
  }
);

export const MatchTickSchedule = table(
  { name: "match_tick_schedule", scheduled: (): any => matchTick },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(), // interval, e.g. every 1s per active match
    match_id: t.u64(),
  }
);

export const BotIntentSchedule = table(
  { name: "bot_intent_schedule", scheduled: (): any => botIntentTick },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(), // interval, e.g. every 1-2s per bot
    player_id: t.u64(),
    match_id: t.u64(),
  }
);

// One schema object binds every table above; ctx.db.<name> accessors below
// use these exact keys (snake_case, matching each table's `name` option).
const spacetimedb = schema({
  match: Match,
  player_profile: PlayerProfile,
  player_vitals: PlayerVitals,
  collision_event: CollisionEvent,
  police_event: PoliceEvent,
  bot_state: BotState,
  voice_callout_job: VoiceCalloutJob,
  tts_clip: TtsClip,
  player_position: PlayerPosition,
  obstacle: Obstacle,
  obstacle_spawn_schedule: ObstacleSpawnSchedule,
  match_tick_schedule: MatchTickSchedule,
  bot_intent_schedule: BotIntentSchedule,
});
export default spacetimedb;
```

> **Verified against the real TypeScript module SDK API** (see Section 8): reducers are created with `spacetimedb.reducer(argsSchema, callback)` — the reducer's callable name is its **export name**, not a string first argument — and a scheduled table's `scheduled` option is a `(): any => reducerRef` thunk pointing at the exported reducer, not a string. The code below reflects this corrected syntax; do not use the `spacetimedb.reducer("name", schema, fn)` or `scheduled: "name"` shapes seen in earlier drafts of this document.

### 4.3 Reducers

```typescript
// ---------------------------------------------------------------------------
// MATCHMAKING / JOIN FLOW (QR -> email consent + name + vehicle)
// ---------------------------------------------------------------------------

export const joinMatch = spacetimedb.reducer(
  { match_id: t.u64(), email: t.string(), consent_given: t.bool(), name: t.string() },
  (ctx, { match_id, email, consent_given, name }) => {
    // Validates consent_given === true, match has a free slot (< max_slots),
    // match.state === "waiting". Inserts PlayerProfile (vehicle_type left
    // as "unassigned" until pick_vehicle), PlayerVitals at defaults
    // (strikes: 0, max_strikes: 3, score: 0, eliminated: false), and
    // PlayerPosition at a spawn point. Uses ctx.sender as `identity`.
    // The client's URL-level "sessionId" (Section 5.1) is this match_id;
    // the join page resolves sessionId -> match_id before calling this.
  }
);

export const pickVehicle = spacetimedb.reducer(
  { player_id: t.u64(), vehicle_type: t.string() },
  (ctx, { player_id, vehicle_type }) => {
    // Validates vehicle_type in ("auto","scooty","thar"), player belongs to
    // ctx.sender's identity. Updates PlayerProfile.vehicle_type. Called
    // immediately after join_match succeeds when the join form submits
    // name + email + consent + vehicle together (Section 5.1) — the two
    // reducer calls fire back-to-back from one client-side submit action.
  }
);

export const fillEmptySlotsWithBots = spacetimedb.reducer(
  { match_id: t.u64() },
  (ctx, { match_id }) => {
    // Called when match is about to start (e.g. from match_tick or
    // start_match). For each of the remaining (4 - human_count) slots:
    // inserts PlayerProfile with is_bot=true, a generated bot_persona
    // string, and a random vehicle_type; inserts matching
    // PlayerVitals/PlayerPosition/BotState rows, and a BotIntentSchedule
    // row so the bot starts receiving periodic intent updates.
  }
);

export const startMatch = spacetimedb.reducer(
  { match_id: t.u64() },
  (ctx, { match_id }) => {
    // Requires match.state === "waiting". Calls fillEmptySlotsWithBots,
    // sets match.state = "active", match.started_at = now, and inserts the
    // initial ObstacleSpawnSchedule / MatchTickSchedule rows for match_id
    // (BotIntentSchedule rows are inserted per-bot in
    // fillEmptySlotsWithBots above).
  }
);

// ---------------------------------------------------------------------------
// MOVEMENT (client -> server, 10-20Hz, server-authoritative option shown)
// ---------------------------------------------------------------------------

export const updatePosition = spacetimedb.reducer(
  {
    player_id: t.u64(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    rotation: t.f32(),
    speed: t.f32(),
    input_seq: t.u32(),
  },
  (ctx, { player_id, x, y, z, rotation, speed, input_seq }) => {
    // Rate-limit guard: read PlayerPosition.last_update_tick, reject/no-op
    // if called again before the tick budget (~50-100ms) has elapsed.
    // Rejects stale input_seq (< current, out-of-order packet).
    // Writes x/y/z/rotation/speed/input_seq/server_tick=now in one atomic
    // update to PlayerPosition. Does NOT touch PlayerProfile/PlayerVitals.
  }
);

// Server-authoritative alternative (recommended for anti-cheat):
export const submitInput = spacetimedb.reducer(
  { player_id: t.u64(), dx: t.f32(), dy: t.f32(), buttons: t.u8(), input_seq: t.u32() },
  (ctx, { player_id, dx, dy, buttons, input_seq }) => {
    // Server runs movement/physics itself from raw input against the
    // current PlayerPosition row, clamps to road bounds/speed limits, then
    // writes the resulting row exactly like updatePosition. Smaller wire
    // payload; centralizes anti-cheat.
  }
);

// ---------------------------------------------------------------------------
// OBSTACLES (server-scheduled spawn)
// ---------------------------------------------------------------------------

export const spawnObstacleTick = spacetimedb.reducer(
  { timer: ObstacleSpawnSchedule.rowType },
  (ctx, { timer }) => {
    // Invoked automatically by SpacetimeDB per ObstacleSpawnSchedule row
    // (timer.match_id identifies which match). Skips if match.state !==
    // "active". Picks a random obstacle_type (MVP: "wrong_way" only; v2
    // adds "animal" | "pedestrian" | "crowd_block"), a spawn point ahead of
    // the leading player(s) on the endless road, and inserts an Obstacle
    // row with active=true. Optionally deactivates/deletes Obstacle rows
    // that have scrolled behind all players to bound table growth.
  }
);

export const deactivateObstacle = spacetimedb.reducer(
  { obstacle_id: t.u64() },
  (ctx, { obstacle_id }) => {
    // Sets active = false (obstacle passed, or consumed by a collision).
  }
);

// ---------------------------------------------------------------------------
// COLLISIONS / STRIKES / ELIMINATION
// ---------------------------------------------------------------------------

export const registerCollision = spacetimedb.reducer(
  {
    player_id: t.u64(),
    other_player_id: t.u64().optional(),
    obstacle_id: t.u64().optional(),
  },
  (ctx, { player_id, other_player_id, obstacle_id }) => {
    // Validates exactly one of other_player_id/obstacle_id is set. Reads
    // PlayerPosition for x/y/z and Obstacle.obstacle_type if applicable.
    // Inserts CollisionEvent. Decrements PlayerVitals.strikes (floor 0) and
    // adjusts score. If obstacle_id set, calls deactivateObstacle. Then
    // calls triggerPoliceEvent and, if strikes hits 0, eliminatePlayer.
  }
);

export const triggerPoliceEvent = spacetimedb.reducer(
  { player_id: t.u64(), collision_event_id: t.u64() },
  (ctx, { player_id, collision_event_id }) => {
    // Inserts PoliceEvent(resolved=false). Client subscribed to
    // police_event renders sirens/flash; a follow-up reducer or timer
    // can flip resolved=true after the animation window.
  }
);

export const eliminatePlayer = spacetimedb.reducer(
  { player_id: t.u64() },
  (ctx, { player_id }) => {
    // Sets PlayerVitals.eliminated = true, eliminated_at = now. Recomputes
    // `rank` for all PlayerVitals rows in the match (by elimination order/
    // score). Checks if only one non-eliminated player remains and, if so,
    // calls endMatch.
  }
);

// ---------------------------------------------------------------------------
// MATCH LIFECYCLE
// ---------------------------------------------------------------------------

export const matchTick = spacetimedb.reducer(
  { timer: MatchTickSchedule.rowType },
  (ctx, { timer }) => {
    // Invoked automatically per MatchTickSchedule row while match is
    // active (timer.match_id). Checks time-limit/win conditions and calls
    // endMatch when conditions are met. (Bot movement-intent refresh runs
    // on its own per-bot BotIntentSchedule / botIntentTick, not here.)
  }
);

export const botIntentTick = spacetimedb.reducer(
  { timer: BotIntentSchedule.rowType },
  (ctx, { timer }) => {
    // Invoked automatically every 1-2s per bot (Section 6.2), keyed by
    // timer.player_id / timer.match_id. Builds a small state snapshot (bot
    // position, nearby obstacles, nearby players) and sends it plus the
    // bot's persona (BotState.persona) to the LLM, requesting strict
    // structured output:
    //   { "steer": "left" | "right" | "hold", "boost": true | false, "duration_ms": 1500 }
    // Writes the result into BotState.intent_steer/intent_boost/
    // intent_duration_ms/intent_updated_at. On LLM error/timeout, leaves
    // the previous intent in place (or falls back to "hold", no boost) —
    // see 6.3. A separate deterministic per-tick controller (client-side
    // or a fast in-module step, per 6.2) reads BotState every physics
    // tick and applies it until the next intent overwrites it.
  }
);

export const endMatch = spacetimedb.reducer(
  { match_id: t.u64(), winner_player_id: t.u64().optional() },
  (ctx, { match_id, winner_player_id }) => {
    // Sets match.state = "finished", finished_at = now, winner_player_id
    // (last non-eliminated player, or highest score on time-limit end).
    // Deletes the match's ObstacleSpawnSchedule/MatchTickSchedule/
    // BotIntentSchedule rows so no further ticks fire.
  }
);

// ---------------------------------------------------------------------------
// VOICE CALLOUTS (Smallest AI TTS trigger)
// ---------------------------------------------------------------------------

export const triggerAiVoiceCallout = spacetimedb.reducer(
  {
    player_id: t.u64(),
    trigger_type: t.string(), // "collision" | "elimination" | "near_miss" | "taunt" | "win"
    context_text: t.string(), // short scene summary fed to Smallest AI for phrasing
  },
  (ctx, { player_id, trigger_type, context_text }) => {
    // Looks up PlayerProfile.bot_persona (or a default announcer persona
    // for human-triggered events). Does NOT call Smallest AI's HTTP API
    // directly from inside the reducer (SpacetimeDB reducers are
    // transactional and should stay side-effect-free w.r.t. the outside
    // world) — instead inserts a row into VoiceCalloutJob (job_id,
    // player_id, persona, trigger_type, context_text, status="pending",
    // created_at). The off-chain worker (Section 3.8) subscribes to
    // voice_callout_job rows with status="pending", calls the Smallest AI
    // TTS API, writes the resulting audio into TtsClip, and flips status
    // to "done" (or "failed"). This keeps reducers fast and deterministic
    // while still making the callout feel server-driven and synchronized
    // for all clients subscribed to the match.
  }
);

export const completeVoiceCalloutJob = spacetimedb.reducer(
  { job_id: t.u64(), audio: t.array(t.u8()) },
  (ctx, { job_id, audio }) => {
    // Called by the off-chain worker once Smallest AI returns audio.
    // Inserts a TtsClip row (job_id, player_id from the job,
    // audio: new Uint8Array(audio), created_at=now) and sets
    // VoiceCalloutJob.status = "done". On a worker-side fetch failure, the
    // worker instead calls this with an empty audio array and a status of
    // "failed" (or a dedicated failVoiceCalloutJob reducer) so the job
    // doesn't retry forever.
  }
);
```

### 4.4 Scheduled-table usage summary

| Scheduled table | Reducer | Cadence | Purpose |
|---|---|---|---|
| `obstacle_spawn_schedule` | `spawn_obstacle_tick` | ~every 2s per active match | Spawns/retires obstacles on the endless road without a client-driven call |
| `match_tick_schedule` | `match_tick` | ~every 1s per active match | Checks win-condition/time-limit and calls `end_match` |
| `bot_intent_schedule` | `bot_intent_tick` | ~every 1-2s per bot | Refreshes each bot's high-level movement intent via LLM call (Section 6.2) |

All three kinds of scheduled rows are inserted by `start_match`/`fill_empty_slots_with_bots` and deleted by `end_match`, so no ticks run against a finished match.

---

## 5. Client Flow & UI Screens

### 5.1 Screen 1 — Join Page (post QR scan)

The QR code on the venue poster points to a URL like `jaldighar.app/join/{sessionId}`. Scanning it opens this page in the phone's default browser. No app install. `sessionId` in the URL is the player-facing name for a SpacetimeDB `match_id` (Section 4.2's `Match.match_id`) — the join page resolves it to the numeric `match_id` before calling any reducer.

**Layout:**
- Header: event logo/title, small text "Scan complete — enter your details"
- shadcn `Form` wrapping:
  - `Input` — Name (required, max 30 chars)
  - `Input` — Email (required, validated format)
  - Consent text + shadcn `Checkbox` — "I agree to receive updates about this event" (must be checked to submit)
  - Vehicle picker: three shadcn `Card` components in a row (auto-rickshaw, scooty, Thar), each with an icon/illustration and a `RadioGroup` bound underneath — tapping a card selects that vehicle (highlight border + checkmark)
  - shadcn `Button` (full width) — "Join Race"

**On submit:**
1. Client-side validation (name/email/consent/vehicle) via the Form's zod resolver — inline error text under each field if invalid.
2. Button shows a shadcnloaders.com spinner (swapped in place of button label) and disables itself.
3. Client connects to SpacetimeDB (WebSocket), calls the `join_match` reducer with `match_id` (resolved from the URL's `sessionId`), `email`, `consent_given`, and `name`; once the resulting `PlayerProfile` row confirms the join, it immediately calls `pick_vehicle` with the selected `vehicle_type` (Section 4.3) — both calls fire in sequence from this one submit action, so the form still feels like a single step to the player.
4. On success: navigate to Waiting Room (5.2).
5. On failure (match full, match already active/finished, connection error): replace the loader with a shadcn `Alert` (destructive variant) above the form — "Couldn't join: {reason}" — button re-enables for retry.

### 5.2 Screen 2 — Waiting Room

Shown when the player has joined but the host hasn't started the match.

**Layout:**
- Centered shadcnloaders.com pulse/dots loader (large)
- Text: "You're in! Waiting for the race to start…"
- shadcn `Card` showing player's chosen vehicle icon + entered name, as confirmation
- Below: a live-updating list (shadcn `Badge` chips) of other joined players' names, streamed from SpacetimeDB's `player_profile` table subscription — gives a lobby feel
- Small footer text: player count, e.g. "14 racers ready"

**Behavior:** page subscribes to this player's `match` row (`Match.state`, Section 4.2). When `state` flips from `"waiting"` to `"active"` (i.e. `start_match` has run), the client auto-navigates to the Game Screen (5.3) with a 3-2-1 countdown overlay (shadcn `Dialog` or full-screen overlay, large countdown numbers) before input unlocks.

### 5.3 Screen 3 — In-Game HUD (overlay on Three.js canvas)

The canvas fills the viewport (`position: fixed; inset: 0`). HUD elements sit in DOM layers above it (`z-index` stacked), using plain absolutely-positioned `div`s and CSS — not shadcn components, since these must be render-loop-cheap and touch-optimized (per the mobile perf research: no libraries, `pointerdown`/`pointerup`/`pointercancel`, `touch-action: none`, instant class toggles instead of CSS transitions).

**HUD elements:**
- **Top-left:** Score counter (large bold number, plain div, updates via a ref not React state re-render, to avoid jank)
- **Top-right:** Strikes-remaining indicator — icons matching `PlayerVitals.max_strikes` (default 3; e.g. steering wheels or hearts) that gray out/disappear on each strike
- **Top-center, small:** Mini leaderboard strip — top 3 players' names + positions, updating live from the `player_position`/`player_vitals` subscription (throttled to ~2–4 updates/sec to avoid DOM thrash)
- **Bottom-left:** Left touch button (steer left)
- **Bottom-right:** Right touch button (steer right) and a Boost button above/beside it
- All touch buttons: minimum 56×56px hit area, semi-transparent circular background, `-webkit-tap-highlight-color: transparent`, bound with `{ passive: false }` pointerdown handlers calling `preventDefault()`

**On strike:** brief full-screen red flash overlay (CSS class toggle, no animation library) + strike icon dims. This is driven by a `PlayerVitals.strikes` decrement arriving over the subscription, and pairs with the police-car comic beat and Smallest AI voice line described in Section 2.1.

**On elimination trigger (3rd strike or falling off road):** transition immediately to Elimination Screen (5.4). This corresponds to `PlayerVitals.eliminated` flipping true (via `eliminate_player`, Section 4.3).

### 5.4 Screen 4 — Elimination Screen

Full-screen takeover replacing the HUD (canvas may keep rendering behind at reduced opacity, or freeze-frame).

**Layout:**
- Large text: "You're out!" with the player's final score and survival time
- shadcn `Card` showing final rank at time of elimination (from `PlayerVitals.rank`, e.g. "Eliminated 7th of 20")
- shadcn `Button` (secondary) — "Watch Live Leaderboard" → navigates to a read-only spectator view of the mini-leaderboard until the match ends
- No retry button in MVP (single life per session, per game design)

### 5.5 Screen 5 — Win/Lose End Screen

Shown to all remaining players when the match ends (`Match.state` flips to `"finished"`, via `end_match`).

**Layout:**
- Top banner: "🏆 You Won!" (if `Match.winner_player_id` matches this player) or "Race Over" (if not), using shadcn `Card` with emphasis styling
- Final leaderboard: shadcn `Table` — columns Rank, Name, Vehicle icon, Score/Survival Time — current player's row highlighted
- shadcn `Button` — "Done" (returns to a static thank-you page; no rematch loop in MVP)

### 5.6 Projector Leaderboard (separate route, big-screen view)

A distinct URL (`jaldighar.app/leaderboard/{sessionId}`) opened once on a venue TV/projector, not tied to any single player's phone. `sessionId` here is the same `match_id` mapping as 5.1.

**Layout:**
- Full-screen dark background, large fonts (readable from a distance)
- Live shadcn `Table` of all players ranked by current score/position, auto-scrolling if the list exceeds screen height
- Each row: rank, name, vehicle icon, live status badge using shadcn `Badge` with color variants — displayed as `Racing` / `Eliminated` / `Finished`, mapped from `PlayerVitals.eliminated` and `Match.state` (a non-eliminated player in an `"active"` match shows `Racing`; `eliminated=true` shows `Eliminated`; once `Match.state === "finished"` all rows show `Finished`)
- Header shows match state — displayed as `Waiting` / `Racing` / `Finished`, mapped directly from `Match.state`'s `"waiting" | "active" | "finished"` — and elapsed time (`now - Match.started_at`)
- Subscribes directly to the same SpacetimeDB tables as players' HUDs (`player_profile`, `player_position`, `player_vitals`, `match`) — no server round trip beyond the existing subscription, updates render at ~4–5 updates/sec (enough for spectators, cheap on the projector device)

### 5.7 Three.js Scene Composition (MVP)

- **Sky:** single `Color` background or a cheap gradient texture on a large sky-box plane/sphere — no dynamic sky shader
- **Lighting:** one `DirectionalLight` (sun) + one `AmbientLight`; `shadowMap.enabled = false`
- **Road:** a pool of 6–8 recycled flat-plane road-tile segments (`BufferGeometry`, tiled texture), repositioned ahead of the player as they pass behind — never destroyed/recreated
- **Vehicles:** three low-poly models (auto, scooty, Thar), one per vehicle type, loaded once and shared; other players' vehicles rendered via `InstancedMesh` or cloned lightweight meshes with baked/vertex-color materials (no per-vehicle dynamic lights)
- **Obstacles/roadside props:** trees, barriers, rocks — merged into a small number of `InstancedMesh` batches, drawn from the same shared texture atlas as the road
- **Fog:** `THREE.Fog` set to cut visibility at ~150–200 units, hiding tile pop-in/out and reducing effective draw distance
- **Camera rig:** third-person chase camera, fixed offset behind and above the player's vehicle (e.g. `position.set(0, 3.5, -6)` relative to vehicle, `lookAt` vehicle position), no camera collision handling in MVP
- **Renderer:** `antialias: false`, `powerPreference: "high-performance"`, `setPixelRatio(Math.min(devicePixelRatio, 1.75))`, driven by `renderer.setAnimationLoop`, paused on `visibilitychange` to hidden, frame rate capped at 30fps via a manual accumulator in the loop

### 5.8 Touch Input → Rapier Physics Mapping

The vehicle is a single Rapier dynamic rigidbody (box or convex-hull collider) driven by forces/impulses each fixed-timestep, not by directly setting position/rotation (keeps collisions with obstacles physically consistent). This is the MVP control scheme — simpler than the per-wheel `DynamicRayCastVehicleController` mentioned as an upgrade path in Section 3.5.

| Input | Rapier call | Effect |
|---|---|---|
| Left button held | `rigidBody.applyTorqueImpulse({x:0, y: +STEER_TORQUE, z:0}, true)` each physics tick while held | Rotates vehicle yaw left; clamped by `maxAngularVelocity` on the body so steering doesn't spin out |
| Right button held | `rigidBody.applyTorqueImpulse({x:0, y: -STEER_TORQUE, z:0}, true)` each tick | Yaw right, same clamp |
| No steer input | Angular velocity damped via `rigidBody.setAngularDamping(HIGH_DAMPING)` (always-on) so the vehicle self-centers instead of drifting indefinitely | Returns toward straight-ahead |
| Default (always, no button) | `rigidBody.applyImpulse({x:0, y:0, z: FORWARD_IMPULSE}, true)` each tick — constant forward push, auto-runner style | Continuous forward motion; player doesn't control throttle |
| Boost button held | Forward impulse multiplied by `BOOST_MULTIPLIER` (e.g. 1.8x) for the hold duration, plus a one-time `applyImpulse` spike on press; cooldown timer before boost can be reused | Temporary speed increase |
| Collision with obstacle/other vehicle | Rapier's built-in collision event fires; on `collisionEvent` handler, apply a small opposing impulse (knockback) and call the `register_collision` reducer (Section 4.3), which decrements strikes — no custom impulse math beyond a fixed knockback vector away from contact normal | Triggers strike + brief control loss (steering torque ignored for ~300ms) |
| Off-road / fell off edge | Sensor collider along road edges; on sensor-intersect, call `eliminate_player` directly (skip strikes) | Immediate elimination screen |

Movement values (position/rotation) read from `rigidBody.translation()` and `rigidBody.rotation()` each render frame to update the Three.js mesh transform — physics and render stay decoupled (fixed-timestep physics step, interpolated render). Locally-computed position is also sent to the server via `update_position` (Section 4.3) at the throttled 15Hz client tick described in 3.4.

---

## 6. AI Bot Behavior

### 6.1 Persona, not per-frame control

Each bot slot gets a fixed persona written into a system prompt, stored as `BotState.persona` (Section 4.2). Example:

- **Bot 1 — "Rex" (reckless Thar bro):** floors it, rams other vehicles, ignores potholes, boosts often.
- **Bot 2 — "Kaka" (cautious auto uncle):** keeps to lanes, slows near obstacles, boosts rarely, avoids contact.
- **Bot 3–4:** similar contrast pairs, so races feel different each run.

The system prompt is short (under 200 tokens): name, driving style, 2–3 example behaviors. This prompt is static per bot, so it can be prompt-cached.

### 6.2 The intent loop (server-side, every 1–2 seconds)

The game loop runs physics at 30–60fps. LLM calls do **not** happen every frame — that would add 200ms–2s of lag per decision, making the bot feel drunk or frozen. Instead:

1. A SpacetimeDB scheduled reducer (`bot_intent_tick`, driven by the `bot_intent_schedule` table, Section 4.2/4.3) fires every 1–2 seconds per bot.
2. It builds a small state snapshot (bot position, nearby obstacles, nearby players, progress along the road) and sends it plus the bot's persona to the LLM.
3. The LLM must return structured output only — no free text — matching a strict schema:
   ```json
   { "steer": "left" | "right" | "hold", "boost": true | false, "duration_ms": 1500 }
   ```
4. The reducer writes this intent to the bot's row in the `bot_state` table (`intent_steer`, `intent_boost`, `intent_duration_ms`, `intent_updated_at`).
5. A separate deterministic controller reads that row every physics tick and applies it (turn, accelerate, boost) until the next intent overwrites it — this runs the same Rapier torque/impulse calls described in Section 5.8, just driven by `bot_state` instead of touch input.

This split keeps reflexes (collision avoidance, staying on road) in code, and personality/strategy in the LLM. The bot never waits on the network mid-frame.

### 6.3 Fallback (hybrid degradation)

If the LLM call errors, times out, or takes too long, `bot_intent_tick` keeps the bot's last intent, or falls back to a simple rule (e.g. "hold lane, no boost"). A network hiccup must never freeze or crash a bot. The LLM is an enhancement to flavor, not a dependency for the bot to function.

### 6.4 Voice callouts (event-based, not continuous)

Voice lines are triggered by specific game events, not by the polling loop:

- Crash / collision
- Police chase started
- Player eliminated (3 strikes)
- Player or bot wins the race

On each event, the server calls `trigger_ai_voice_callout` (Section 4.3), which picks or generates a short line matching the persona (e.g. Rex: "Arre bhidha diya!") and enqueues it as a `voice_callout_job` row. The off-chain worker (Section 3.8) sends it to Smallest AI's Waves TTS REST endpoint to render audio, writes the result to `tts_clip`, and the client plays it once the row lands via subscription.

**Security requirement:** the Smallest AI API key must live only in the off-chain worker's server-side environment variable (Section 3.8), never in client code, never inside the SpacetimeDB module itself, and never in any request the browser can see. The user pasted a Smallest AI key in plaintext earlier in this chat session — that key must be treated as compromised and rotated in the Smallest AI dashboard before it is used anywhere in this project. See Section 8.

---

## 7. Build Order & Milestones

MVP scope: core driving loop, join flow, one obstacle type, strikes/elimination, win condition, basic leaderboard. Steps below are ordered top to bottom for a coding agent, and use the canonical table/reducer names defined in Section 4.

1. Scaffold Vite + React + TS app in `optimist-hackathon/client`.
2. Add Tailwind + shadcn/ui to the client (per shadcn Vite install steps: `@tailwindcss/vite`, path alias, `shadcn init`).
3. Init a SpacetimeDB module named `jaldigharpahuncho` in `optimist-hackathon/server`.
4. Define core tables (Section 4.2): `match`, `player_profile`, `player_vitals` (strikes, score, eliminated), `player_position`, `obstacle` (one type for MVP — `wrong_way`), and `bot_state` (persona id, current intent).
5. Write reducers (Section 4.3): `join_match`, `pick_vehicle`, `update_position` (client input tick), `register_collision` (decrements strikes, triggers the police event), `eliminate_player`, `match_tick`/`end_match` (win-condition check).
6. Write the scheduled reducer for bot intent polling (`bot_intent_tick`, every 1–2s) calling the LLM with structured output, plus the fallback rule (6.3).
7. Write the deterministic per-tick bot controller that reads `bot_state`'s intent fields and moves the bot.
8. Implement collision/obstacle-hit detection server-side, wired to `register_collision`.
9. Publish the module, generate TS client bindings.
10. Build the client join screen (name/email/consent entry, vehicle pick, join button, waiting room).
11. Build the core driving screen: canvas/render loop, subscribe to `player_position`/`obstacle`/`bot_state`, local input controls (steer, boost).
12. Wire client subscriptions to reducers (call `update_position` on input, react to strike/eliminate/win events from `player_vitals`/`match` state).
13. Add the strikes UI (show remaining strikes) and elimination screen.
14. Add the win screen and a basic leaderboard (final standings by finish order/time).
15. Wire event-based Smallest AI voice callouts server-side (crash, police chase, elimination, win) via `trigger_ai_voice_callout` → `voice_callout_job` → off-chain worker → `tts_clip` (Sections 3.8, 4.3) — API key lives only in the worker's env var, rotated before first use (Section 8).
16. Playtest end-to-end on a real phone (touch controls, screen size, network latency).

**Deferred to v2 (do not build now):**

- Day/night cycle
- Extra obstacle variety (`animal`, `pedestrian`, `crowd_block` — beyond the one MVP `wrong_way` obstacle type)
- Additional AIJP flavor/polish (extra personas, richer dialogue, cosmetics) — kept satirical-neutral, no real party names/symbols/colors
- Admin analytics dashboard
- Voice AI polish beyond the basic event callouts (e.g. dynamic commentary, streaming TTS via WebSocket)

---

## 8. Open Questions / Risks for Next Agent

- **Rotate the leaked Smallest AI key before any use.** A Smallest AI API key was pasted in plaintext earlier in this project's chat history. Treat it as fully compromised — rotate it in the Smallest AI dashboard and put only the new key into the off-chain worker's environment (Section 3.8) before writing or running any TTS code. Confirm the old key is deactivated, not just replaced.
- **Rapier WASM init timing on first load.** `@dimforge/rapier3d-compat` requires `await RAPIER.init()` before any physics call; on a phone hitting the join-to-game transition quickly (especially on a cold cache at a live event with many phones on one Wi-Fi), this async init could race the countdown-to-gameplay transition (5.2) and cause a blank/frozen first frame. Confirm the countdown overlay only unlocks input after `RAPIER.init()` resolves, not just after the WebSocket connects.
- **SpacetimeDB row-update rate limits at scale.** The design assumes 4 players/bots per match at 10–20Hz position writes plus obstacle spawns every ~2s — fine for one match, but the venue may run many concurrent matches. Verify with SpacetimeDB's actual (not assumed) per-module throughput/row-diff limits at the CLI version in use (v2.8.3) before assuming this scales linearly to N concurrent matches; the `last_update_tick` throttle in `update_position` (4.3) is a guard against a single misbehaving client, not a capacity plan for the whole module.
- **Smallest AI latency under concurrent bot + event voice calls.** Up to 4 bots plus human-triggered hit/elimination/win events in one match can each fire a `voice_callout_job`; at multiple concurrent matches this could produce a burst of simultaneous Waves API calls from the single off-chain worker. Load-test the worker's throughput and confirm Smallest AI's rate limits/pricing tier before the live event, and confirm the "stale job" behavior (Section 4.3's `complete_voice_callout_job`/failure path) actually prevents a backlog from playing badly-timed audio late.
- **SpacetimeDB TS SDK reducer syntax — corrected and unified.** An earlier draft of this document mixed two invented reducer-definition shapes. This has been fixed throughout Sections 4.2/4.3/3.8: a reducer is `export const someName = spacetimedb.reducer(argsSchema, (ctx, args) => {...})` — the exported name IS the reducer's callable name, there is no string name argument — and a scheduled table's `scheduled` option is `(): any => reducerRef`, referencing the exported reducer function, not a string. `ctx.db` accessors use the snake_case keys passed into `schema({...})` (e.g. `ctx.db.voice_callout_job`), matching each table's `name` option verbatim. Still double-check this against the installed `spacetime` CLI version's exact SDK (`@clockworklabs/spacetimedb-server`, matching CLI v2.8.3) before writing code, in case the API has moved since this document was written — but do not reintroduce the old string-name-argument style.
- **The outbound-HTTP job-queue pattern (Section 3.8) is a deliberate choice, not a workaround for a missing feature.** The TypeScript module SDK does expose `ctx.http.fetch` for outbound HTTP from procedures, but this document intentionally keeps outbound Smallest AI calls in a separate off-chain worker rather than a procedure, because reducers/procedures should stay fast and the API key must never be reachable from any code path that ships to the client. Keep the worker-process architecture; do not "simplify" it into an inline `ctx.http.fetch` call from a reducer even if that appears to work, since reducers are transactional and are not the right place for a slow, rate-limited third-party call.
- **QR code / session-to-match mapping is underspecified.** Section 5.1/5.6 assume `sessionId` in the URL maps 1:1 to a `match_id`, but it's not decided whether the printed QR code is static for the whole event (always resolving to "whichever match is currently `waiting`") or regenerated per match. If it's static, the join page needs server-side logic to resolve "the current waiting match" rather than a literal fixed `match_id` — confirm which before building the QR generation/printing step.
- **Email/PII handling has no retention or deletion policy defined.** `player_profile.email` is captured with consent (Section 2.1, 5.1) but this spec never says how long it's retained, who can access it, or how a player could request deletion. Flag to whoever owns event compliance before the first live run.
- **Frame-rate/timestep mismatch.** Section 5.7 caps rendering at 30fps while Section 3.5's physics accumulator targets a 60Hz fixed step — confirm the 30fps cap only throttles `renderer.render` calls and not the physics `world.step` cadence, or bot/player movement will feel different depending on which loop actually got capped.
---

## 9. Hackathon Scoring Strategy (Optimize for This, Not Just "a Good Game")

This game is being built for a specific hackathon with a locked scoring rubric. Every scope decision in Sections 2 and 7 should be checked against this section, and any future scope debate should be resolved by asking "does this move a scored parameter or a qualifier?" — not "is this cool."

### 9.1 Qualifiers — fail any of these and the build likely never reaches the demo/scoring stage

Treat this as a literal pre-flight checklist, not a formality:

- [ ] **Opens and runs on a phone.** Test on a real budget Android phone in Chrome, not just a dev laptop's mobile emulator, before the deadline.
- [ ] **Live URL opens and runs on the judges' device.** The client must be deployed (not just running on localhost) well before demo time, and tested on a network the judges will actually use (venue Wi-Fi, not your home connection).
- [ ] **Module live on Maincloud, created inside the contest window.** Do **not** run `spacetime publish jaldigharpahuncho --server maincloud` before the official start time (14:00 Saturday, per the rules). Publishing early to "test" risks the module's creation timestamp falling outside the judged window — rehearse the publish command against a *throwaway* database name beforehand if you need to validate it works, then run the real publish under the real `jaldigharpahuncho` name only after the window opens.
- [ ] **Repo created after 14:00 Saturday, nothing pushed after freeze.** The `optimist-hackathon` GitHub repo already exists (confirmed empty as of this document). Verify its creation timestamp is compliant with the "created after 14:00 Saturday" rule before relying on it — if it was created earlier than that, ask the organizers whether an empty repo created early still qualifies, or create a fresh repo at/after the window opens. Set a hard personal deadline for the last push well before the freeze, not at the freeze itself.
- [ ] **Demo video under 3 minutes.** Script this in advance (see 9.4) — do not attempt to improvise a 3-minute cut at the last minute.
- [ ] **Links to every build in the public post.** The launch post (9.4) must link the live URL, the repo, and ideally the demo video.
- [ ] **One-liner: who it's for, what it does.** Lock this before building UI copy — it should appear verbatim on the join page, the launch post, and be the first sentence out of whoever demos on stage.
- [ ] **Email comms live: a stranger signs up, an email lands.** This is NOT just "we captured an email address" — an actual email must be sent and received. Build and test this end-to-end early (Section 9.3), it is easy to underestimate.
- [ ] **A stranger gets in within 30 seconds, no password walls.** No login/password/account creation — QR scan → name/email/vehicle → playing, full stop. Time this with an actual stranger, not a teammate who already knows the flow.
- [ ] **Onboarding exists: a first-time user is shown what to do.** The join/waiting-room screens (5.1/5.2) need a one-line instruction ("Tap left/right to dodge, survive 3 hits, last one racing wins") — do not assume controls are self-explanatory.

### 9.2 Parameter 1 — Realtime (35 points, tie-breaker for the whole rubric)

This is the single most heavily-weighted parameter, and ties go to the SpacetimeDB team's read on it — meaning realtime correctness is worth over-investing in relative to visual polish.

**What judges literally do:** open the product in two browser tabs, act in one, watch the other for sync — then open the SpacetimeDB module itself and check that state lives in tables, logic lives in reducers, and the UI is driven by subscriptions (not polling, not client-side fake multiplayer).

**Score ladder and what it means for this build:**
- Score 3 requires: the core loop (driving, obstacles, strikes) syncs between 2+ users in under a second, with zero refreshes needed anywhere in the product — this is the MVP bar, non-negotiable.
- Score 4 requires: presence (who's currently connected) is visible, concurrent actions from multiple players don't overwrite each other's state, and it holds with 5+ users at once. This means: test with 5 real phones connected simultaneously well before the deadline, not just 2.
- Score 5 requires: the product *cannot exist* without live shared state (true here — a single-player version of this game is a different, less interesting product), holding with 10+ concurrent users, with the module doing real work verified in the repo (not the client faking multiplayer with local state and a thin sync layer).

**Build implications — do these explicitly, don't leave them implicit:**
- **Test with two tabs every hour while building**, per the rubric's own advice. The moment a second tab needs a refresh to see a change, stop everything else and fix that before adding any new feature.
- **Every piece of gameplay-relevant state must live in a SpacetimeDB table**, not client-only React/Three.js state — this is what "the module is doing the real work" means to a judge reading the repo. Position, strikes, obstacles, match state: all server-authoritative per Section 4, not client-simulated with server as an afterthought.
- **Deliberately test 5, then 10, concurrent phone connections before the deadline**, not just 2 — recruit teammates/friends to open the join URL simultaneously. This is the only way to know if the "5+ users" and "10+ users" bars are actually met, and it's exactly the test judges will run live.
- **The projector leaderboard (Section 5.6) doubles as your realtime demo prop** — showing 5-10 phones' state updating live on one big screen in front of judges is a more convincing "score 4/5" argument than any amount of code review, because it's the exact test the rubric describes (act in one place, watch it reflected elsewhere) at full visible scale.
- Given this weighting, if a scope tradeoff must be made under time pressure, cut visual/audio polish (Section 2.2's deferred list) before cutting realtime robustness — a rougher-looking game that flawlessly syncs 8 concurrent players beats a polished-looking game that silently breaks past 3 players.

### 9.3 Parameter 2 — Problem-Fit (35 points)

**What judges do:** score the build against whatever problem statement the team locked, checking whether a first-time user can complete the core task unaided.

**Score ladder implications:**
- Score 3 (the floor to aim past) requires a first-time user completing the core task start-to-finish, unaided, in under 3 minutes. This is the same "hand your phone to a stranger" test described generally in this conversation's earlier advice — run it literally, multiple times, with people who have never seen the game.
- Score 4/5 requires solving something other teams on the same problem statement miss, and/or judges saying they'd use it *this week*. For this game, the "hard part most teams skip" is very likely the realtime multiplayer sync itself (Parameter 1) plus the zero-friction QR-to-playing flow (the market-ready qualifiers) — most hackathon teams building a browser game will ship it single-player or with laggy, refresh-dependent sync. Nailing both is the differentiator, not extra game features.
- **Lock one plain-English problem statement now** (e.g. "the fastest way to get a room full of strangers physically playing something together, with zero install and zero friction") and make sure it's the sentence in the one-liner, on the join screen, and in the launch post — a judge should be able to repeat it back after 10 seconds on the page, per the qualifiers list.
- **Playtest the "hand a stranger your phone" test explicitly and often** during the build, exactly as suggested earlier for the general game design — but now it's not just good practice, it's literally how this parameter is scored.

### 9.4 Parameter 3 — Market Readiness (30 points: positioning, plan, traction — 10 each)

This parameter rewards work that happens in parallel with building, not after — "post at kickoff, post while building, launch at night" per the rubric's own guidance.

**Positioning (10 pts):** name a specific ICP now, not "everyone." For a QR-scan party game, a workable ICP is something like "hackathon/college-fest organizers who want an instant icebreaker game for 20-200 attendees with zero setup" — put this exact framing on the join page footer and in the launch post, so a stranger reading it can repeat back who it's for.

**Acquisition plan (10 pts):** name one channel and why it fits the ICP (e.g. "posting in hackathon/college-event WhatsApp and Discord communities where organizers already hang out, because that's where the actual decision-makers for 'what game do we run at our event' are"). Score 5 requires the plan is *already running* — start posting or DMing before the deadline, not after, and keep screenshots/links as proof.

**Traction (10 pts):** measured against your team's *usual* reach (median of last 10 posts), so:
- Post at kickoff (announce you're building this, tag the hackathon), post progress mid-build (a two-tab sync demo clip is great content and doubles as a Parameter-1 proof point), and do the real launch post at night per the rubric's own tip about a "warm account by 21:30."
- The demo video (qualifier: under 3 minutes) should BE the main launch post asset, not a separate throwaway — script it to show the two-tabs-syncing moment and the QR-to-playing-in-30-seconds moment explicitly, since those are the exact things being scored elsewhere.

### 9.5 Net effect on build priority order

Given this rubric, the priority order for engineering time, highest to lowest:
1. Rock-solid realtime sync of the core loop (Parameter 1, 35 pts) — the two-tab test must pass constantly.
2. A first-time stranger completing the core loop unaided in under 3 minutes (Parameter 2, 35 pts) — this is largely the same MVP scope in Section 2, tested ruthlessly.
3. The market-ready qualifiers (email delivery, no password wall, onboarding hint) — these are pass/fail gates before scoring even starts, so they cannot be skipped regardless of how good the game feels.
4. Positioning/plan/traction (Parameter 3, 30 pts) — runs in parallel with the above via posting cadence, not after.
5. Everything in Section 2.2's deferred list (day/night cycle, obstacle variety, AIJP flavor, admin dashboard, voice AI polish) — genuinely last, since none of it moves a scored parameter or a qualifier.
