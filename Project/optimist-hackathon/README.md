# Jaldi Ghar Pahuncho

A zero-install realtime party racing game for live events. Players join from their phones, choose a ride, dodge wrong-way traffic, survive three hits, and watch the whole match stay synchronized through SpacetimeDB.

## Local development

Requirements: Node.js 18+ and SpacetimeDB CLI 2.10.x.

Terminal 1:

```bash
spacetime start
```

Terminal 2:

```bash
npm install
npm install --prefix spacetimedb
spacetime publish --server local --module-path spacetimedb jaldigharpahuncho-local --yes
VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3000 VITE_SPACETIMEDB_DB_NAME=jaldigharpahuncho-local npm run dev
```

Open the printed Vite URL. Use an incognito window to test a second player identity.

## Verification

```bash
cd spacetimedb && spacetime build
cd .. && spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb --yes
npm run build
```

Do not use `--delete-data` against Maincloud. Local schema resets may use `--delete-data=always` while development data is disposable.

The complete product and architecture brief is in [jaldigharpahuncho.md](./jaldigharpahuncho.md).
