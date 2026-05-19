# HashCerebrum

Medical research agent app for source-grounded clinical literature work.
This is an early Tauri v2 desktop starting point for a researcher-audience tool.

## Stack

- **Frontend:** Vite + React 18 + TypeScript (strict) + R3F (Three.js)
- **State:** Zustand stores + typed EventBus (no globals)
- **Backend:** Tauri v2 + Rust (tokio + reqwest + rusqlite)
- **Atlas:** lightweight agent signal scaffold, lit by agent + topic blend
- **Audit:** Hash-chained SQLite append-only log (the name pays off)
- **Keys:** OS keychain only — never in files, never in JS

This starter commit intentionally does not bundle a 3D anatomical model asset
or third-party model license files. Add a reviewed, licensed GLB later.

## Hard caps (compile-time)

- The atlas is the only active mode right now
- 5 modes max — `src/config/modes.ts` rejects a sixth mode
- 6 agents — `src/config/agents.ts` same pattern

These exist to keep the first public phase intentionally bounded.

## Mode build order

Modes are isolated by folder and loaded through `src/modes/registry.ts`.
New modes should only be registered when their own module can typecheck and
render independently. The first build focuses on the atlas scaffold only.

## Run

```sh
npm install
npm run dev                # desktop dev app
npm run dev:web            # browser-only Vite, only when needed
npm run build              # production macOS .app
npm run build:app:debug    # debug .app bundle, no browser workflow
npm run build:web          # production frontend bundle only
npm run build:all          # all Tauri bundle targets for this OS
```

Tauri dev uses a local Vite server internally for hot reload. Packaged `.app`
builds load the compiled files from `dist` and do not use localhost.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Agents](docs/AGENTS.md)
- [Remaining work](REMAINING_WORK.md)
