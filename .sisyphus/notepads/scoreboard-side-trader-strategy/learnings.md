# Learnings

## 2026-05-13 Task 1 scoreboard-side evaluator
- Implemented `src/ipl/scoreboard-side-strategy.ts` as a standalone backend evaluator with no observer/frontend imports so Task 4 can bridge it later.
- Active mode defaults to `value90` (`maxPrice: 0.90`, `allocationFraction: 0.20`); `volume95` allows `maxPrice: 0.95` with `allocationFraction: 0.10`.
- Strength formulas use the plan's fixed `0.95` price-bonus baseline even when the active mode cap is `0.90`; mode cap only controls entry eligibility.
- Required focused verification passed with `pnpm exec vitest run tests/scoreboard-side-strategy.test.ts`; evidence saved to `.sisyphus/evidence/task-1-scoreboard-evaluator.txt`.

## 2026-05-13 Task 1 verification fix
- Corrected the evaluator public result API to match the plan and Task 4 bridge needs: `action`, `signalSide`, `tokenSide`, `priceCap`, and mode-derived `strategyVersion` (`v1-value90` / `v1-volume95`).
- Added evaluator-owned reduced-over detection from `firstInningsBalls < 120` when the first innings was not all out, while preserving caller-provided `reducedOverRisk`.
- Refreshed focused evidence after the API correction: `pnpm exec vitest run tests/scoreboard-side-strategy.test.ts` passes with 13 tests.

## 2026-05-13 Task 1 safety fix
- Added `SETTLED_MARKET` as a pre-gate blocker for either side priced at `<= 0.01` or `>= 0.99`; this prevents 1c/99c closed-market states from producing scoreboard-side buys.
- Added focused tests for defender gates that otherwise pass at `0.01` and for either market side at `0.99`; focused Vitest now passes with 15 tests and refreshed evidence.

## 2026-05-13 Task 1 diagnostics fix
- Added `MISSING_SCOREBOARD_DATA` for null `firstInningsScore`, `chasingScore`, or `wicketsLost` so scoreboard-input failures are not mislabeled as missing market team/price data.
- Kept `MISSING_BALLS` specific to missing legal balls and `MISSING_TEAM_OR_PRICE` specific to market side fields; focused Vitest now passes with 16 tests and refreshed evidence.

## 2026-05-13 Task 2 active mode config
- Added `config.trading.scoreboardSideStrategy` as the import-time active scoreboard-side mode settings, sourced from `getScoreboardSideStrategySettings()` rather than duplicated config constants.
- `SCOREBOARD_SIDE_STRATEGY_MODE` now defaults absent/blank values to `value90`, accepts `value90` and `volume95`, and fails fast with `SCOREBOARD_SIDE_STRATEGY_MODE must be one of: value90, volume95` for invalid values.
- Focused verification passed with `pnpm exec vitest run tests/trading-config.test.ts`; evidence saved to `.sisyphus/evidence/task-2-mode-config.txt`.

## 2026-05-13 Task 3 fixture-level trade intent guard
- Added repository-level fixture-scope detection for trade intents using `strategyKey + recipeVersion + windowKey + fixtureId + marketId + side`, intentionally excluding `tokenId` while preserving the existing token-scoped `intentKey` semantics.
- `createTradeIntentWithStore` now returns the existing fixture-scope row before insert, and also falls back to fixture-scope lookup after insert rejection so DB unique-index conflicts are idempotent.
- Focused verification passed with `pnpm exec vitest run tests/trading-repository.test.ts -t "fixture-level"`; evidence saved to `.sisyphus/evidence/task-3-one-shot.txt`.

## 2026-05-13 Task 4 observer intent bridge
- Replaced the legacy missing `eleven-over` observer intent bridge with the scoreboard-side evaluator and active `config.trading.scoreboardSideStrategy.mode` selection.
- Observer intents now use identity `scoreboard-side-11-13` / evaluator `strategyVersion` / `balls-66-78`, choose the selected scoreboard side token from fixture home/away team aliases, and persist full evaluation plus innings and scoreboard metrics in context.
- Added an optional repository fixture-scope precheck before recipe lookup for tests and compatible stores; `createTradeIntent` remains the database fallback for fixture-scope idempotency when the default repository does not expose direct lookup.
- Focused verification passed with `pnpm exec vitest run tests/observer-trade-intent.test.ts`; full `pnpm typecheck` also passes without the former missing `src/ipl/eleven-over-strategy.js` error. Evidence saved to `.sisyphus/evidence/task-4-intent-bridge.txt`.

## 2026-05-13 Task 4 verification fix
- Exported `findTradeIntentByFixtureScope()` from `src/trading/repository.ts` and wired it into the observer intent default repository, so runtime now performs the fixture-level one-shot precheck before recipe lookup as required.
- Tightened `tests/observer-trade-intent.test.ts` so the duplicate fixture-scope case has no recipe and asserts both `getTradingRecipe` and `createTradeIntent` are not called.
- Corrected the observer data-quality warning to reference the scoreboard-side `balls-66-78` window instead of the old `66-72` text.
- Refreshed Task 4 evidence after `pnpm exec vitest run tests/observer-trade-intent.test.ts`, `pnpm exec vitest run tests/trading-repository.test.ts`, `pnpm typecheck`, and `pnpm build` all passed.

## 2026-05-13 Task 5 scoreboard-side recipe seeding
- Added `seedScoreboardSideTokenRecipes()` and `buildScoreboardSideRecipeInputs()` in `src/trading/scoreboard-side-recipes.ts`; the API always seeds exactly two BUY recipes for home and away tokens and defaults to active `value90` settings unless a mode is explicitly supplied.
- Recipe identity uses existing repository helpers (`buildTradeRecipeKey` / `upsertTradingRecipe`) with `scoreboard-side-11-13`, `v1-value90` or `v1-volume95`, `balls-66-78`, fixture, market, token, and side, preserving deterministic lookup for the Task 4 bridge.
- Recipe context now carries `strategyMode`, `priceCap`, `allocationFraction`, `.sisyphus/plans/scoreboard-side-trader-strategy.md`, token side, and token team for downstream auditability.
- Focused verification passed with `pnpm exec vitest run tests/trading-recipe-seeding.test.ts`; `pnpm typecheck` and `pnpm build` also pass. Evidence saved to `.sisyphus/evidence/task-5-recipe-seeding.txt`.

## 2026-05-13 Task 6 allocation-aware sizing
- `evaluateTradeIntentPolicy()` still sizes from available pUSD balance, but now prefers a finite positive recipe `context.allocationFraction` up to `1`; invalid or absent context falls back to `TRADING_BALANCE_ALLOCATION_FRACTION`.
- `toValidatedTradingRecipe()` preserves record context after a small object guard, allowing scoreboard-side recipe context to flow into policy without strategy-specific executor or adapter branches.
- Execution audit events now include the allocation fraction used; approved/blocked events also include requested sizing fields so dry-run sizing evidence is traceable.
- Focused verification passed with `pnpm exec vitest run tests/trading-executor.test.ts tests/trading-dry-run-e2e.test.ts`; `pnpm typecheck` also passes. Evidence saved to `.sisyphus/evidence/task-6-sizing.txt`.

## 2026-05-13 Task 7 observer service/status wiring
- Moved observer scoreboard-side intent evaluation ahead of live-model edge thresholding and snapshot/signal journal throttles in `recordLiveModelSnapshot()`, while still delegating all strategy, second-innings, staleness, recipe, and one-shot checks to `createObserverTradeIntent()`.
- Added `/trading/status` `activeStrategy` output with `scoreboard-side-11-13`, active/default `value90` settings, dry-run state, live readiness, and string readiness blockers without exposing credentials.
- Focused verification passed with `pnpm exec vitest run tests/observer-service-scoreboard-intents.test.ts tests/trading-api.test.ts`; `pnpm typecheck` also passes. Evidence saved to `.sisyphus/evidence/task-7-service-status.txt`.

## 2026-05-13 Task 7 verification fix
- `recordLiveModelSnapshot()` must build the live model and call `evaluateObserverTradeIntent()` before checking `liveModelPersistenceDisabledReason`; otherwise one schema/persistence failure disables future scoreboard-side intent evaluation along with journal writes.
- Added regression coverage for persistence-disabled follow-up balls; focused verification now passes with 10 tests across `tests/observer-service-scoreboard-intents.test.ts` and `tests/trading-api.test.ts`, and `pnpm typecheck` passes.

## 2026-05-13 Task 8 focused safety suite
- Expanded focused regression tests without touching runtime code: evaluator now explicitly covers non-second innings, underdog scoreboard-supported chaser buys, and reduced-data/tie integrity blockers.
- Strengthened observer bridge tests around exact fixture identities (`fixture-scoreboard-side-001`, `market-001`, `condition-001`, `token-home-001`, `token-away-001`), both-token recipe lookup, default `value90` persistence, fixture staleness, window boundaries, missing balls, reduced/target mismatch, finished fixtures, settled markets, and fixture-level one-shot precheck.
- Focused suite passed with 58 tests across the six required files; `pnpm typecheck && pnpm build` also passed. Evidence saved to `.sisyphus/evidence/task-8-focused-suite.txt` and `.sisyphus/evidence/task-8-build.txt`.

## 2026-05-13 Task 9 dry-run rollout docs
- Updated `docs/polymarket-11-over-trading-runbook.md` to make `scoreboard-side-11-13` the active operational framing while preserving legacy 11-over/favourite wording only as historical context.
- Runbook now documents dry-run-first rollout with `TRADING_LIVE_ENABLED=false` and `live-trading-enabled=false`, both-token recipe seeding, fixture-level one-shot behavior, `value90`/`volume95` mode settings, and rollback/disabling without claiming legacy `eleven-over` runtime restoration.
- Focused verification passed for the dry-run no-submit path, `/trading/status` dry-run blockers, and `pnpm typecheck`; evidence saved to `.sisyphus/evidence/task-9-dry-run-rollout.txt` and `.sisyphus/evidence/task-9-docs.txt`.

## 2026-05-13 Review follow-up fixes
- Runtime recipe seeding belongs in `createObserverTradeIntent()` rather than only in tests: once fixture market slug, condition id, and both team tokens are present, the bridge upserts both active-mode scoreboard-side recipes before selected recipe lookup.
- The fixture-level one-shot contract must ignore `recipeVersion`, not only `tokenId`; otherwise changing `SCOREBOARD_SIDE_STRATEGY_MODE` from `value90` to `volume95` mid-match can create a second intent.
- Repository fixture-scope lookup is scoreboard-side-specific even though it lives in the shared trading repository; non-scoreboard strategies keep exact intent-key idempotency and are not broadened to strategy/window/fixture/market/side dedupe.
- The migration now preflights for historical duplicate scoreboard-side fixture scopes and raises a clear remediation error before creating the unique index, rather than relying on an opaque unique-index failure.
- Focused review-fix verification passed with `pnpm vitest run tests/observer-trade-intent.test.ts tests/trading-repository.test.ts tests/trading-recipe-seeding.test.ts tests/observer-service-scoreboard-intents.test.ts`, `pnpm typecheck`, and `pnpm build`.
