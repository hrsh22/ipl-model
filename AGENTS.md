# AGENTS.md

## Stack and entrypoint
- Package manager: `pnpm` (`packageManager` is pinned in `package.json`).
- Runtime stack: Node.js + Express 5 + Effect + TypeScript in ESM mode (`"type": "module"`).
- Main source entrypoint is `src/index.ts`; build output goes to `dist/`.
- Runtime config lives in `src/config.ts`; Winston logger setup lives in `src/logger.ts`.
- PostgreSQL readiness checks live in `src/database.ts` using the `pg` client.
- Drizzle ORM is wired from `src/database.ts`; schema files live in `src/db/schema.ts`, and Drizzle Kit config lives in `drizzle.config.ts`.

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
- `src/db/schema.ts` is currently an empty placeholder; define tables there before generating or pushing schema changes.
- `.env` is the runtime source of truth; keep `.env.example` in sync with required variables, and prefer required config validation over duplicating fallback defaults in code.
- Keep code clean and readable: centralize shared config, remove unnecessary fallback branches, and prefer small helpers over repeated inline env parsing.

## App behavior
- The starter API exposes `GET /` and `GET /health` from `src/index.ts`.
- Request handlers use `Effect.runPromise(...)` to execute Effect programs and send JSON responses.
- Required runtime variables are `PORT`, `LOG_LEVEL`, and `DATABASE_URL`; the checked-in `.env.example` documents the expected values.
- Logging goes through Winston in `src/logger.ts` with Console transports and `service: ipl-trader-node` metadata.
- Use log levels intentionally: `debug` for routine request traces and detailed readiness steps, `info` for meaningful lifecycle events like server startup, `warn` for recoverable degraded states or retries, and `error` for request failures or startup failures.
- Avoid logging sensitive connection details such as the full `DATABASE_URL` at normal `info` level.
- Server startup now fails fast if Postgres is unreachable, and `GET /health` performs a live DB connectivity check before returning `database: "reachable"`.
