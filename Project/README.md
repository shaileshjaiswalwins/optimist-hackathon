# ⚰️ Project Graveyard

A live wall of dead side projects. Anyone opens the link, buries a project
(name, cause of death, epitaph) → a tombstone appears on **everyone's** screen
instantly. The idle big screen in the room becomes a shared, growing graveyard.

Built on **SpacetimeDB**: the `tombstone` table + `bury` reducer *are* the whole
backend. Every client subscribes to the table and gets live updates — no server
to write, no websockets to wire.

```
project-graveyard/
├── server/            # the SpacetimeDB module (Rust) — this is the real-time backend
│   ├── Cargo.toml
│   └── src/lib.rs     # 1 table + 1 reducer, ~40 lines
└── client/            # a Vite web app that connects, subscribes, renders
    ├── index.html
    └── src/main.js
```

---

## Prerequisites
- **Rust**: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **SpacetimeDB CLI**: install per https://spacetimedb.com/install  (then `spacetime --version`)
- **Node 18+**

> Version note: this targets SpacetimeDB **2.x**. If a command's flags differ,
> run `spacetime <cmd> --help` — the CLI is the source of truth.

---

## Local dev loop (recommended while building)

```bash
# terminal 1
spacetime start

# terminal 2 — from project root
spacetime publish project-graveyard-local --server local --module-path server --anonymous --yes
spacetime generate --lang typescript --out-dir client/src/module_bindings --module-path server --yes

cd client
npm install
npm run dev
```

`client/src/main.js` is already pointed at local:

```js
const MODULE = 'project-graveyard-local';
const URI    = 'ws://localhost:3000';
```

Open http://localhost:5173 — bury a project, open a second tab, watch it appear live.
Big-screen mode (form hidden): append `#screen` to the URL.

Quick smoke test without the client:

```bash
spacetime call project-graveyard-local bury "CryptoPetSitter" "no users" "It had potential." "Alice" --server local --anonymous
spacetime sql  project-graveyard-local "SELECT * FROM tombstone" --server local --anonymous
```

---

## Publish to Maincloud (hackathon submission)

```bash
spacetime login
spacetime publish project-graveyard-YOURTEAM --server maincloud --module-path server --yes
```

- Pick a **unique** name (`project-graveyard-YOURTEAM`) — names are global on Maincloud.
- In `client/src/main.js` set:

```js
const MODULE = 'project-graveyard-YOURTEAM';
const URI    = 'https://maincloud.spacetimedb.com';
```

Then regenerate bindings if needed and run `npm run build` / `npm run preview`.

---

## Why this wins the rubric
- **Real-time (35):** can't exist without shared state; the module does the real work; holds any number of clients via one subscription.
- **Problem (35):** directly answers "the big screen is doing nothing" — it becomes a live wall the whole room fills.
- **Onboarding / market-ready:** three text fields, no login, in under 15s.
- **Traction:** relatable + funny → people share it.

## Stretch ideas (only after the core loop is solid)
- QR code on the big screen so strangers join instantly.
- Reactions (🪦 count) — another tiny reducer + table.
- "Cause of death" leaderboard.
- A gentle fog/particles layer on the big-screen view.
