# AGENTS.md

## Stack and entrypoint
- Package manager: `pnpm` (`packageManager` is pinned in `package.json`).
- Runtime stack: Node.js + Express 5 + Effect + TypeScript in ESM mode (`"type": "module"`).
- Main source entrypoint is `src/index.ts`; build output goes to `dist/`.
- Runtime config lives in `src/config.ts`; Winston logger setup lives in `src/logger.ts`.
- PostgreSQL readiness checks live in `src/database.ts` using the `pg` client.
- Drizzle ORM is wired from `src/database.ts`; schema files live in `src/db/schema.ts`, and Drizzle Kit config lives in `drizzle.config.ts`.
- Cricsheet/IPL prediction helpers now live under `src/ipl/` and are wired from `src/index.ts` for experimental IPL modeling endpoints.

## Verified commands
- `pnpm dev` — run the server with `tsx watch src/index.ts`.
- `pnpm typecheck` — run TypeScript without emitting files.
- `pnpm build` — compile `src/` to `dist/` with `tsc -p tsconfig.json`.
- `pnpm start` — run the built server from `dist/index.js`.
- `pnpm db:generate` — generate SQL migrations from `src/db/schema.ts` into `drizzle/`.
- `pnpm db:migrate` — apply generated Drizzle migrations.
- `pnpm db:push` — push schema changes directly to the configured database.
- `pnpm db:studio` — open Drizzle Studio against the configured database.

## TypeScript / runtime notes
- `tsconfig.json` uses `module` / `moduleResolution` = `NodeNext`, `strict: true`, `rootDir: src`, and `outDir: dist`.
- `esModuleInterop` is enabled so default-importing Express is intentional.
- Keep new runtime code under `src/`; `dist/` is generated output and should not be edited manually.
- Use ESM-style relative imports with `.js` extensions between local TypeScript files.
- `.env` is the runtime source of truth; keep `.env.example` in sync with required variables, and prefer required config validation over duplicating fallback defaults in code.
- Keep code clean and readable: centralize shared config, remove unnecessary fallback branches, and prefer small helpers over repeated inline env parsing.

## Runtime config
- Required runtime vars are `PORT`, `LOG_LEVEL`, `DATABASE_URL`, and `OPTICODDS_API_KEY`.
- `OBSERVER_API_TOKEN` is optional; when set, all `/observer/*` JSON routes require `Authorization: Bearer <token>`.
- `src/config.ts` imports `dotenv/config`, so local `.env` values are loaded automatically during normal startup.

## Database / persistence
- Observer persistence is no longer a placeholder. `src/db/schema.ts` defines:
  - `observer_fixtures`
  - `observer_odds`
  - `observer_signals`
  - `observer_checkpoints`
- Observer history currently persists fixtures, latest odds rows, signal journal entries, and OpticOdds stream checkpoints.

## App behavior
- Core health endpoints from `src/index.ts`:
  - `GET /`
  - `GET /health`
  - `GET /ready`
- Request handlers use `Effect.runPromise(...)` to execute Effect programs and send JSON responses.
- Logging goes through Winston in `src/logger.ts` with Console transports and `service: ipl-trader-node` metadata.
- Use log levels intentionally: `debug` for routine request traces and detailed readiness steps, `info` for meaningful lifecycle events like server startup, `warn` for recoverable degraded states or retries, and `error` for request failures or startup failures.
- Avoid logging sensitive connection details such as the full `DATABASE_URL` at normal `info` level.
- Server startup now fails fast if Postgres is unreachable, and `GET /health` performs a live DB connectivity check before returning `database: "reachable"`.

## Observer engine
- `src/observer/service.ts` owns the live IPL observer lifecycle.
- `IplObserverService.start()` loads stream checkpoints, refreshes fixtures, starts periodic fixture refresh + active-fixture reconciliation, and connects OpticOdds odds/results streams plus the Polymarket market websocket.
- The current pricing engine is **Betfair-first**:
  - `buildReferenceProbabilities()` anchors fair value on `PRIMARY_REFERENCE_BOOK` (`betfair_exchange`)
  - support books (`1xbet`, `parimatch_india_`, `opticodds_ai`) affect confidence/diagnostics, not the anchor probability itself.
- Current opportunity filtering includes:
  - fee-adjusted edge (`SPORTS_TAKER_FEE_RATE`)
  - persistence gate (`OPPORTUNITY_PERSISTENCE_MS`)
  - minimum executable shares / notional gates
  - confidence thresholding (`low` / `medium` / `high`)
- Mapping behavior is split intentionally:
  - broad fixture + Polymarket mapping discovery ahead of time
  - active odds hydration only for near-start or live fixtures

## Observer/API surface
- Public dashboard route: `GET /observer/dashboard`
- Static dashboard assets are served from `/observer/assets/*` out of `public/`.
- Observer JSON routes in `src/index.ts`:
  - `GET /observer/status`
  - `GET /observer/diagnostics`
  - `GET /observer/metrics`
  - `GET /observer/fixtures`
  - `GET /observer/fixtures/live`
  - `GET /observer/fixtures/:fixtureId`
  - `GET /observer/opportunities`
  - `GET /observer/opportunities/diagnostics`
  - `GET /observer/tape/live`
  - `GET /observer/signals`
  - `GET /observer/history/signals`

## Dashboard behavior
- The internal operator dashboard is a lightweight static HTML/CSS/JS page under `public/observer-dashboard.*`.
- The dashboard currently polls every 5 seconds and fetches:
  - `/ready`
  - `/observer/metrics`
  - `/observer/fixtures/live`
  - `/observer/opportunities/diagnostics?minEdgeBps=1`
  - `/observer/diagnostics`
  - `/observer/tape/live`
- The dashboard is meant for **live/current operator state**. Historical signal rows are intentionally separated from the live tape.
- Important caveat: the dashboard JS does not attach auth headers. If `OBSERVER_API_TOKEN` is enabled, the JSON observer routes return 401 and the dashboard becomes read-only/erroring until auth support is added to the UI.

## IPL prediction endpoints
- `src/index.ts` also wires experimental IPL prediction helpers from `src/ipl/`.
- Current surfaced endpoint: `GET /predict/ipl` (and related IPL modeling helpers referenced from `src/index.ts`). Treat this area as experimental compared with the observer engine.

## Model change discipline
- The deployed predictor model lives under `model/`, with active production artifacts in `model/final_models/`.
- `model/MODEL_CHANGELOG.md` is the required human-readable source of truth for any material model-affecting change.
- Update `model/MODEL_CHANGELOG.md` whenever you change training data inputs, derived features, feature engineering logic, allowlists, model family, calibration, ensemble weights, hyperparameters, or inference-time inputs that can change predicted probabilities.
- Each changelog entry should explain what changed, why it changed, how it was tested, the baseline vs candidate metrics, and whether the change was promoted, rejected, or reverted.
- Automatic logs are supporting evidence only; when relevant, reference `model/final_models/revision_history.jsonl`, `model/data/live/predictor_performance_predictions.jsonl`, and `model/data/live/predictor_performance_summary.json` from the changelog entry.
