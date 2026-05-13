# Scoreboard-Side Trader Strategy Integration

## TL;DR
> **Summary**: Add the scoreboard-side IPL chase strategy as a new backend trading strategy identity, make Value mode (`<=0.90`) the default active mode, keep Volume mode (`<=0.95`) selectable, and route dry-run trade intents through the existing durable trading pipeline. Preserve all Polymarket runbook safety gates while adding fixture-level one-shot protection so a match cannot produce multiple intents when chaser/defender side flips.
> **Deliverables**:
> - Backend scoreboard-side evaluator for balls 66-78 of the chase.
> - Active mode selector with Value default and Volume availability.
> - Scoreboard-supported token selection for chaser or defender, not market favourite.
> - Fixture-level one-shot guard across token and mode changes plus existing intent-key idempotency.
> - Idempotent recipe seeding/upsert for both home and away BUY tokens per fixture/mode.
> - Price-aware allocation fraction support using existing pUSD balance model.
> - Focused tests and dry-run rollout evidence.
> **Effort**: Medium
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 → Task 2 → Task 4 → Task 5 → Task 8 → Final Verification

## Context
### Original Request
Integrate `docs/ipl-observer-scoreboard-side-trading-plan.md` into the trader so this scoreboard-side strategy becomes the active strategy instead of the existing strategy.

### Interview Summary
- Keep both Value and Volume modes available.
- Default active mode: Value mode (`<=0.90`).
- Rollout: dry-run first.
- Bankroll sizing: use the existing bankroll/source-of-funds model.

### Research Summary
- Current bridge: `src/trading/observer-intents.ts:136-335` builds observer trade intents and is hardcoded to `ELEVEN_OVER_STRATEGY_KEY = "eleven-over"` at `src/trading/observer-intents.ts:16`.
- Current import `../ipl/eleven-over-strategy.js` at `src/trading/observer-intents.ts:2-6` appears to have no matching checked-in source file; this plan creates the new strategy module explicitly and replaces that import in Task 4. Full repo `pnpm typecheck` is intentionally gated after Task 4, not before.
- Durable trading tables already exist: `trading_recipes` at `src/db/schema.ts:155-174`, `trading_trade_intents` at `src/db/schema.ts:176-213`, and unique `intentKey` at `src/db/schema.ts:205-207`.
- Current idempotency key includes `strategyKey`, `recipeVersion`, `windowKey`, `fixtureId`, `marketId`, `tokenId`, and `side` via `src/trading/repository.ts:147-161`; because `tokenId` is included, a fixture-level one-shot guard is required for “at most once per match.”
- Current executor pipeline sizes from balance in `src/trading/policy.ts:105-115`, builds orders with `clientOrderId: intent.intentKey` in `src/trading/executor.ts:182-196`, and dry-runs when adapter mode is not live at `src/trading/executor.ts:349-364`.
- Runbook safety contract requires dry-run default and redundant live gates at `docs/polymarket-11-over-trading-runbook.md:9-19`, one-shot behavior at `docs/polymarket-11-over-trading-runbook.md:21-25`, and rollout checklist at `docs/polymarket-11-over-trading-runbook.md:91-104`.

### Metis Review (gaps addressed)
- New strategy identity is mandatory to avoid silent mutation of historical `eleven-over` attribution.
- Fixture-level one-shot dedupe is mandatory because token-level uniqueness alone is insufficient.
- Team-token mapping ambiguity must block intent creation.
- Volume mode must not create intents unless explicitly active.
- Live trading must remain disabled by default and verified through existing live gates.

### Oracle Review (architecture guidance)
- Keep existing intent → executor → adapter path; do not build a parallel executor.
- Use one shared evaluator and one active mode enum, not separate strategy forks.
- Seed both home and away BUY recipes because the scoreboard-supported side may be chaser or defender and either may be home/away.
- Use existing pUSD balance model with mode allocation overrides: Value `0.20`, Volume `0.10`.
- Add diagnostic-only inactive mode evaluation only if useful; inactive mode must not persist trade intents.

## Work Objectives
### Core Objective
Make scoreboard-side 11.0-13.0 chase logic the backend trader’s active dry-run strategy, while preserving the existing execution safety contract and avoiding duplicate match entries.

### Deliverables
- `scoreboard-side-11-13` strategy identity with `value90` and `volume95` modes.
- Strategy evaluator for the exact plan rules in `docs/ipl-observer-scoreboard-side-trading-plan.md:36-132`.
- Intent creation path that selects the scoreboard-supported team token instead of the market favourite token.
- Fixture-level one-shot guard across both tokens and mode/recipe-version changes.
- Recipe seeding/upsert logic for both home and away BUY token recipes.
- Mode allocation support in the existing policy/executor model.
- Unit/integration tests plus dry-run execution evidence.

### Definition of Done (verifiable conditions with commands)
- `pnpm typecheck` passes.
- `pnpm build` passes.
- `pnpm exec vitest run tests/scoreboard-side-strategy.test.ts tests/observer-trade-intent.test.ts tests/trading-repository.test.ts tests/trading-executor.test.ts tests/trading-dry-run-e2e.test.ts` passes.
- A dry-run scenario creates exactly one `trading_trade_intents` row for `fixture-scoreboard-side-001`, strategy `scoreboard-side-11-13`, active mode `value90`, and never calls the live adapter.
- Repeated updates and opposite-side flips for the same fixture do not create a second intent.

### Must Have
- Strategy key: `scoreboard-side-11-13`.
- Default active mode: `value90`, price cap `0.90`, allocation fraction `0.20`.
- Selectable mode: `volume95`, price cap `0.95`, allocation fraction `0.10`.
- Window key: `balls-66-78`.
- Legacy `eleven-over` historical records remain untouched for audit. Because the checked-in legacy evaluator source appears missing, rollback in this plan means disabling scoreboard-side observer intent creation and keeping live trading disarmed; restoring a working legacy trading path is explicitly out of scope unless separately requested.
- Chaser buy gate: `RRR <= 11`, `wickets_lost <= 3`, `CRR >= RRR`, selected token price `<= active cap`.
- Defender buy gate: `CRR < RRR`, `RRR >= 12`, `wickets_lost >= 4`, `(wickets_lost >= 5 OR RRR >= 13)`, selected token price `<= active cap`.
- No trade for missing legal balls, non-second innings, stale fixture/signal, reduced innings/DLS/target mismatch, tie/super-over/data-integrity issue, settled/closed market, ambiguous team-token mapping, before ball 66, after ball 78, or existing fixture-level strategy/window intent even if the mode changed.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- MUST NOT enable live trading by default.
- MUST NOT mutate existing `eleven-over` historical intent identity.
- MUST NOT create a second trade because the supported side changes from chaser to defender or home to away.
- MUST NOT use model edge/favourite status as the strategy gate.
- MUST NOT create new credentials, bypass `TRADING_LIVE_ENABLED`, or bypass `live-trading-enabled`.
- MUST NOT train or change prediction models.
- MUST NOT require manual dashboard confirmation as a test pass condition.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after, using Vitest files already present in `tests/` plus `pnpm typecheck` and `pnpm build`.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`.

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 strategy evaluator, Task 2 mode/config contracts, Task 3 repository one-shot helper.
Wave 2: Task 4 observer intent bridge, Task 5 recipe seeding, Task 6 sizing policy.
Wave 3: Task 7 service/API/status wiring, Task 8 test suite.
Wave 4: Task 9 dry-run rollout evidence and docs/runbook alignment.

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 4, 8, 9.
- Task 2 blocks Tasks 4, 5, 6, 7, 8, 9.
- Task 3 blocks Tasks 4, 8, 9.
- Task 4 blocks Tasks 7, 8, 9.
- Task 5 blocks Tasks 7, 8, 9.
- Task 6 blocks Tasks 8, 9.
- Task 7 blocks Task 9.
- Task 8 blocks Task 9.
- Task 9 blocks Final Verification.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → deep, quick, deep.
- Wave 2 → 3 tasks → deep, deep, quick.
- Wave 3 → 2 tasks → quick, deep.
- Wave 4 → 1 task → unspecified-high.

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Create scoreboard-side strategy evaluator

  **What to do**: Add a new backend strategy module under `src/ipl/` for scoreboard-side 11.0-13.0 chase evaluation. Export typed inputs/outputs, constants (`STRATEGY_KEY = "scoreboard-side-11-13"`, `WINDOW_KEY = "balls-66-78"`, modes `value90`/`volume95`), and evaluator result fields: `action`, `signalSide`, `team`, `tokenSide`, `price`, `priceCap`, `mode`, `strength`, `reasons`, `blockers`, `dataQualityWarnings`, `strategyVersion`, `windowKey`, and metrics (`currentRate`, `requiredRate`, `runsNeeded`, `ballsLeft`, `wicketsLost`). Implement exact gates from the strategy doc. Include fixture-finished, reduced-over, target mismatch, missing-data, and boundary handling.
  **Must NOT do**: Do not import frontend `apps/web` code. Do not use market favourite as the decision gate. Do not silently recreate the missing legacy `eleven-over` behavior inside this module.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Core trading logic with many edge cases.
  - Skills: [] - Backend TypeScript only.
  - Omitted: [`frontend-design`, `react-doctor`] - No UI work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [4, 8, 9] | Blocked By: []

  **References** (executor has NO interview context - be exhaustive):
  - Strategy spec: `docs/ipl-observer-scoreboard-side-trading-plan.md:36-132` - exact window and entry rules.
  - Strategy sizing/strength: `docs/ipl-observer-scoreboard-side-trading-plan.md:158-237` - price bands and strength formulas.
  - Current bridge input shape: `src/trading/observer-intents.ts:23-66` - fixture, innings, and market side input types.
  - Current reduced-over detection: `src/trading/observer-intents.ts:180-204` - preserve/reuse data-integrity checks.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm exec vitest run tests/scoreboard-side-strategy.test.ts` passes.
  - [ ] Unit tests cover chaser buy, defender buy, wait before ball 66, passed after ball 78, price-above-cap wait/skip, missing data, target reached, all out, reduced-over risk, target mismatch, and mode-specific caps.
  - [ ] New strategy module imports compile in the targeted Vitest run; full repo `pnpm typecheck` is not required until Task 4 removes the missing legacy import from `src/trading/observer-intents.ts`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Value-mode chaser signal
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/scoreboard-side-strategy.test.ts -t "value mode buys chaser"` using fixture `fixture-scoreboard-side-001`, price `0.89`, balls `66`, score/wickets that make `CRR >= RRR` and `RRR <= 11`.
    Expected: Evaluator returns `action="buy"`, `signalSide="chaser"`, `priceCap=0.90`, `windowKey="balls-66-78"`.
    Evidence: .sisyphus/evidence/task-1-scoreboard-evaluator.txt

  Scenario: Reduced match blocks trading
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/scoreboard-side-strategy.test.ts -t "blocks reduced match"` with first innings balls `<120` and wickets `<10`.
    Expected: Evaluator returns non-buy action and blocker includes reduced-over/data-integrity reason.
    Evidence: .sisyphus/evidence/task-1-scoreboard-evaluator-error.txt
  ```

  **Commit**: YES | Message: `feat(trading): add scoreboard-side strategy evaluator` | Files: [`src/ipl/scoreboard-side-strategy.ts`, `tests/scoreboard-side-strategy.test.ts`]

- [x] 2. Add active mode configuration and strategy contracts

  **What to do**: Add typed configuration for the active scoreboard-side mode with default `value90`. Use existing config style in `src/config.ts`; add an env variable such as `SCOREBOARD_SIDE_STRATEGY_MODE` accepting `value90` or `volume95`. Expose mode settings from a single source of truth: `value90 = { priceCap: 0.90, allocationFraction: 0.20 }`, `volume95 = { priceCap: 0.95, allocationFraction: 0.10 }`. Make inactive mode evaluation diagnostic-only and impossible to persist as an intent unless selected.
  **Must NOT do**: Do not create two divergent evaluator implementations. Do not enable simultaneous Value and Volume intent creation.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Small config/type addition once evaluator constants exist.
  - Skills: [] - Backend TypeScript only.
  - Omitted: [`frontend-design`] - No UI design.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [4, 5, 6, 7, 8, 9] | Blocked By: []

  **References**:
  - Runtime config pattern: `src/config.ts` per AGENTS.md runtime config notes.
  - User decision: default active mode is Value `<=0.90`; keep Volume selectable.
  - Oracle default: Value allocation `0.20`, Volume allocation `0.10`.

  **Acceptance Criteria**:
  - [ ] Targeted config tests pass with `SCOREBOARD_SIDE_STRATEGY_MODE` absent; full repo `pnpm typecheck` is deferred until Task 4 because the current legacy observer import is known missing.
  - [ ] Config defaults to `value90` when env is absent or blank.
  - [ ] Invalid mode fails fast during startup/config parse or returns a deterministic validation error in tests.

  **QA Scenarios**:
  ```
  Scenario: Default active mode is value90
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/scoreboard-side-config.test.ts -t "defaults to value90"` without setting `SCOREBOARD_SIDE_STRATEGY_MODE`.
    Expected: Config reports active mode `value90`, cap `0.90`, allocation `0.20`.
    Evidence: .sisyphus/evidence/task-2-mode-config.txt

  Scenario: Invalid mode rejected
    Tool: Bash
    Steps: Run `SCOREBOARD_SIDE_STRATEGY_MODE=aggressive pnpm exec vitest run tests/scoreboard-side-config.test.ts -t "rejects invalid mode"`.
    Expected: Test observes deterministic invalid-mode failure; no fallback to Volume or live behavior.
    Evidence: .sisyphus/evidence/task-2-mode-config-error.txt
  ```

  **Commit**: YES | Message: `feat(config): add scoreboard-side strategy mode` | Files: [`src/config.ts`, `src/ipl/scoreboard-side-strategy.ts`, `tests/scoreboard-side-config.test.ts`]

- [x] 3. Add fixture-level one-shot repository guard

  **What to do**: Extend trading repository/query surface to detect any existing intent for `strategyKey + recipeVersion/mode + fixtureId + marketId` regardless of `tokenId`. Add a helper such as `findExistingFixtureStrategyIntent(...)` or `hasFixtureStrategyIntent(...)` and use indexed fields already present in `trading_trade_intents`. If a new DB index is needed for performance, add it to `src/db/schema.ts` and generate a Drizzle migration.
  **Must NOT do**: Do not remove the existing `intentKey` unique index; keep current token-level idempotency for executor/reconciliation.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Persistence/idempotency correctness is safety-critical.
  - Skills: [] - Backend persistence work.
  - Omitted: [] - None.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [4, 8, 9] | Blocked By: []

  **References**:
  - Existing unique key: `src/db/schema.ts:176-213`.
  - Intent key builder: `src/trading/repository.ts:147-161`.
  - Idempotent insert fallback: `src/trading/repository.ts:199-217`, `src/trading/repository.ts:320-351`.
  - Runbook one-shot policy: `docs/polymarket-11-over-trading-runbook.md:21-25`.

  **Acceptance Criteria**:
  - [ ] `pnpm exec vitest run tests/trading-repository.test.ts -t "fixture-level"` passes.
  - [ ] Repository test proves an existing home-token intent blocks away-token intent for the same fixture/strategy/mode/window.
  - [ ] Existing duplicate intent-key test still returns existing row, not error.

  **QA Scenarios**:
  ```
  Scenario: Opposite token blocked by fixture one-shot
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/trading-repository.test.ts -t "blocks opposite token for same fixture strategy"` with `fixture-scoreboard-side-001`, `token-home-001`, `token-away-001`.
    Expected: First row exists; second attempt is detected as already traded at fixture strategy scope.
    Evidence: .sisyphus/evidence/task-3-one-shot.txt

  Scenario: Different fixture allowed
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/trading-repository.test.ts -t "allows different fixture"`.
    Expected: Same strategy/mode may create one intent per distinct fixture.
    Evidence: .sisyphus/evidence/task-3-one-shot-error.txt
  ```

  **Commit**: YES | Message: `feat(trading): enforce fixture-level strategy one-shot` | Files: [`src/trading/repository.ts`, `src/db/schema.ts`, `drizzle/*.sql`, `tests/trading-repository.test.ts`]

- [x] 4. Replace observer intent strategy bridge with scoreboard-side selection

  **What to do**: Update `src/trading/observer-intents.ts` to remove the missing legacy import from `../ipl/eleven-over-strategy.js` and use the new scoreboard-side evaluator and active mode. Preserve stale/live/second-innings gates. Replace favourite-token selection with scoreboard-supported team selection: if evaluator returns chaser, map to second-innings batting team; if defender, map to first-innings batting team or second-innings bowling team. Determine home/away token by normalized team match against `fixture.homeTeam`/`fixture.awayTeam`; block on ambiguity. Use identity `strategyKey="scoreboard-side-11-13"`, `recipeVersion` including active mode (`v1-value90` / `v1-volume95`), `windowKey="balls-66-78"`, and selected token. Check fixture-level one-shot guard before recipe lookup/intent insert. Persist full evaluation/mode/metrics in intent context.
  **Must NOT do**: Do not choose token by market favourite. Do not create intents from inactive mode diagnostics. Do not bypass recipe lookup.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Core trading bridge and safety gates.
  - Skills: [] - Backend TypeScript.
  - Omitted: [] - None.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [7, 8, 9] | Blocked By: [1, 2, 3]

  **References**:
  - Current bridge: `src/trading/observer-intents.ts:136-335`.
  - Current favourite selection to replace: `src/trading/observer-intents.ts:160-166`, `src/trading/observer-intents.ts:242-247`.
  - Current persistence context: `src/trading/observer-intents.ts:276-309`.
  - Team normalization: `src/trading/observer-intents.ts:1`, `src/trading/observer-intents.ts:342-360`.

  **Acceptance Criteria**:
  - [ ] `pnpm exec vitest run tests/observer-trade-intent.test.ts` passes.
  - [ ] `pnpm typecheck` no longer fails due to missing `src/ipl/eleven-over-strategy.js`.
  - [ ] Tests prove an underdog scoreboard-supported side can create an intent even when not market favourite.
  - [ ] Tests prove ambiguous team-token mapping returns ignored/blocked result and creates no intent.
  - [ ] Existing stale/non-live/non-second-innings tests still pass.

  **QA Scenarios**:
  ```
  Scenario: Defender underdog creates dry-run intent
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/observer-trade-intent.test.ts -t "creates defender underdog scoreboard intent"` with defending team price `0.88`, chaser market favourite price `0.12`, balls `72`, `RRR >= 13`, wickets `5`.
    Expected: Intent uses defender token id, strategy `scoreboard-side-11-13`, recipe version `v1-value90`, and status created.
    Evidence: .sisyphus/evidence/task-4-intent-bridge.txt

  Scenario: Ambiguous token mapping blocks intent
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/observer-trade-intent.test.ts -t "blocks ambiguous scoreboard team mapping"`.
    Expected: Result is ignored/blocked with mapping reason; repository createTradeIntent spy is not called.
    Evidence: .sisyphus/evidence/task-4-intent-bridge-error.txt
  ```

  **Commit**: YES | Message: `feat(trading): route observer intents through scoreboard-side strategy` | Files: [`src/trading/observer-intents.ts`, `tests/observer-trade-intent.test.ts`]

- [x] 5. Add idempotent both-token recipe seeding/upsert

  **What to do**: Add `src/trading/scoreboard-side-recipes.ts` for recipe seeding/upsert so each eligible fixture and selected mode has BUY recipes for both home and away tokens. Use `upsertTradingRecipe` from `src/trading/repository.ts:274-318`. Recipe identity must match strategy key, recipe version, window key, fixture, market, token, and side. Max price must equal selected mode cap. Expiry must be after the 13-over window and before/at market settlement window per existing recipe conventions. Context must include `strategyMode`, `priceCap`, `allocationFraction`, source plan doc, and token team. Default seeding uses active mode `value90`; `volume95` is seeded only when explicitly selected/requested, not alongside active Value mode by default.
  **Must NOT do**: Do not seed only the current favourite token. Do not seed live-enabled state. Do not require manual SQL.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Recipe identity and token mapping directly affect live order target.
  - Skills: [] - Backend persistence.
  - Omitted: [] - None.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [7, 8, 9] | Blocked By: [2]

  **References**:
  - Recipe schema: `src/db/schema.ts:155-174`.
  - Upsert helper: `src/trading/repository.ts:274-318`.
  - Strategy implementation notes: `docs/ipl-observer-scoreboard-side-trading-plan.md:328-336`.
  - Runbook recipe validation requirement: `docs/polymarket-11-over-trading-runbook.md:91-104`.

  **Acceptance Criteria**:
  - [ ] `pnpm exec vitest run tests/trading-recipe-seeding.test.ts` passes.
  - [ ] Seeding `fixture-scoreboard-side-001` creates/upserts exactly two active-mode recipes: `token-home-001` and `token-away-001`.
  - [ ] Re-running seeding updates existing rows instead of duplicating.
  - [ ] Volume recipes are created only when explicitly requested/selected, not by default during Value-mode seeding.

  **QA Scenarios**:
  ```
  Scenario: Both-token active value recipes seeded
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/trading-recipe-seeding.test.ts -t "seeds both home and away value recipes"`.
    Expected: Two recipes with strategy `scoreboard-side-11-13`, recipe version `v1-value90`, maxPrice `0.90`, side `buy`.
    Evidence: .sisyphus/evidence/task-5-recipe-seeding.txt

  Scenario: Rerun is idempotent
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/trading-recipe-seeding.test.ts -t "rerun updates recipes without duplicates"`.
    Expected: Row count remains two and updated context reflects latest config.
    Evidence: .sisyphus/evidence/task-5-recipe-seeding-error.txt
  ```

  **Commit**: YES | Message: `feat(trading): seed scoreboard-side token recipes` | Files: [`src/trading/scoreboard-side-recipes.ts`, `tests/trading-recipe-seeding.test.ts`]

- [x] 6. Apply mode allocation through existing balance sizing

  **What to do**: Extend validated recipe/context or policy input so `evaluateTradeIntentPolicy` can use an allocation fraction from the active scoreboard-side recipe context, falling back to `TRADING_BALANCE_ALLOCATION_FRACTION` for legacy recipes. Value mode uses `0.20`; Volume mode uses `0.10`. Requested notional remains `balanceAvailableUsd * allocationFraction`; requested order size remains `requestedNotionalUsd / recipe.maxPrice`. Include allocation in execution events for auditability.
  **Must NOT do**: Do not introduce a new bankroll source. Do not hardcode strategy-specific branches inside Polymarket adapter. Do not use `trading_recipes.size` as the only source unless policy actually reads it.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Narrow policy change but safety-sensitive tests required.
  - Skills: [] - Backend TypeScript.
  - Omitted: [] - None.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [8, 9] | Blocked By: [2]

  **References**:
  - Current sizing: `src/trading/policy.ts:105-115`.
  - Executor policy call: `src/trading/executor.ts:281-301`.
  - Order request: `src/trading/executor.ts:182-196`, `src/trading/executor.ts:334-340`.
  - Runbook existing 20% model: `docs/polymarket-11-over-trading-runbook.md:11-19`.

  **Acceptance Criteria**:
  - [ ] `pnpm exec vitest run tests/trading-executor.test.ts tests/trading-dry-run-e2e.test.ts` passes.
  - [ ] Legacy recipes without allocation context still use existing `TRADING_BALANCE_ALLOCATION_FRACTION`.
  - [ ] Value mode with `$1000` balance requests `$200` notional.
  - [ ] Volume mode with `$1000` balance requests `$100` notional.

  **QA Scenarios**:
  ```
  Scenario: Value sizing uses 20 percent existing balance
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/trading-executor.test.ts -t "value mode uses allocation override"` with balance `1000`, cap `0.90`.
    Expected: Submitted/dry-run order details show requestedNotionalUsd `200` and size `222.222222` after rounding.
    Evidence: .sisyphus/evidence/task-6-sizing.txt

  Scenario: Legacy fallback unchanged
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/trading-executor.test.ts -t "legacy allocation fallback"`.
    Expected: Existing legacy recipe behavior still uses `TRADING_BALANCE_ALLOCATION_FRACTION`.
    Evidence: .sisyphus/evidence/task-6-sizing-error.txt
  ```

  **Commit**: YES | Message: `feat(trading): apply strategy allocation in policy sizing` | Files: [`src/trading/policy.ts`, `src/trading/executor.ts`, `tests/trading-executor.test.ts`, `tests/trading-dry-run-e2e.test.ts`]

- [x] 7. Wire observer service and trading status around active scoreboard mode

  **What to do**: Ensure `src/observer/service.ts` evaluates scoreboard-side strategy after every relevant live ball/update inside balls 66-78, not only after a live-model edge signal. Keep persistence throttles for journals if needed, but intent creation must not depend on model-edge threshold. Update status/API payloads minimally so `/trading/status` or related diagnostics identify active strategy key/mode and dry-run blockers. Keep dashboard changes minimal and informational only if existing web panel consumes these fields.
  **Must NOT do**: Do not redesign the dashboard. Do not make live-model edge/confidence a required strategy input. Do not create intents outside live second innings.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Wiring/status after core bridge exists.
  - Skills: [] - Backend plus optional existing dashboard field display.
  - Omitted: [`frontend-design`] - No visual redesign.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [9] | Blocked By: [2, 4, 5]

  **References**:
  - Current observer intent call: `src/observer/service.ts:1810-1828`.
  - Current live-model signal throttle: `src/observer/service.ts:1798-1807`.
  - Live opportunity output source: `src/observer/service.ts:591-627`.
  - Trading status API: `src/trading/api.ts` per research `/trading/status` route.
  - Dashboard polling: `apps/web/src/routes/observer.tsx` fetches trading status per research.

  **Acceptance Criteria**:
  - [ ] `pnpm exec vitest run tests/observer-service-scoreboard-intents.test.ts tests/trading-api.test.ts` passes.
  - [ ] Valid scoreboard-side signal creates a dry-run intent even if model edge is below `LIVE_MODEL_SIGNAL_THRESHOLD_BPS`.
  - [ ] `/trading/status` response includes active strategy/mode/readiness without exposing credentials.

  **QA Scenarios**:
  ```
  Scenario: Ball update creates scoreboard intent independent of model edge
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/observer-service-scoreboard-intents.test.ts -t "creates scoreboard intent without model edge"`.
    Expected: One dry-run intent is created for valid balls 66-78 signal; live-model edge threshold is not required.
    Evidence: .sisyphus/evidence/task-7-service-status.txt

  Scenario: Status exposes mode but no secrets
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/trading-api.test.ts -t "trading status includes scoreboard mode"`.
    Expected: JSON has active strategy/mode and dry-run blockers; response contains no private key, auth header, signature, or funded account identifier.
    Evidence: .sisyphus/evidence/task-7-service-status-error.txt
  ```

  **Commit**: YES | Message: `feat(observer): evaluate scoreboard-side intents on live updates` | Files: [`src/observer/service.ts`, `src/trading/api.ts`, optional `apps/web/src/routes/observer.tsx`, tests]

- [x] 8. Expand focused safety and integration tests

  **What to do**: Consolidate test coverage across evaluator, intent bridge, repository, API, executor, and dry-run e2e. Use exact fixtures `fixture-scoreboard-side-001`, `market-001`, `condition-001`, `token-home-001`, `token-away-001`. Cover ball boundaries, chaser/defender, market-underdog buy, Value/Volume mode selection, reduced/tie/super-over/data-integrity blocks, fixture-level one-shot, both-token recipe lookup, allocation override, and dry-run no-live-submit.
  **Must NOT do**: Do not use tests that require real Polymarket credentials or live network calls.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Cross-cutting safety verification.
  - Skills: [] - Test engineering.
  - Omitted: [] - None.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [9] | Blocked By: [1, 2, 3, 4, 5, 6]

  **References**:
  - Existing observer intent tests: `tests/observer-trade-intent.test.ts` per research.
  - Existing repository tests: `tests/trading-repository.test.ts` per research.
  - Existing dry-run e2e tests: `tests/trading-dry-run-e2e.test.ts` per research.
  - Existing executor tests: `tests/trading-executor.test.ts` per research.
  - Package scripts: `package.json:13-15`, `package.json:70-79` (Vitest installed, no test script).

  **Acceptance Criteria**:
  - [ ] `pnpm exec vitest run tests/scoreboard-side-strategy.test.ts tests/observer-trade-intent.test.ts tests/trading-repository.test.ts tests/trading-executor.test.ts tests/trading-dry-run-e2e.test.ts tests/trading-api.test.ts` passes.
  - [ ] No test requires live credentials, real account balance, or network access.
  - [ ] Every no-trade rule in `docs/ipl-observer-scoreboard-side-trading-plan.md:293-298` has at least one assertion.

  **QA Scenarios**:
  ```
  Scenario: Full focused safety suite
    Tool: Bash
    Steps: Run `pnpm exec vitest run tests/scoreboard-side-strategy.test.ts tests/observer-trade-intent.test.ts tests/trading-repository.test.ts tests/trading-executor.test.ts tests/trading-dry-run-e2e.test.ts tests/trading-api.test.ts`.
    Expected: All tests pass with no real network calls.
    Evidence: .sisyphus/evidence/task-8-focused-suite.txt

  Scenario: Type/build validation
    Tool: Bash
    Steps: Run `pnpm typecheck && pnpm build`.
    Expected: TypeScript check and production build pass.
    Evidence: .sisyphus/evidence/task-8-build.txt
  ```

  **Commit**: YES | Message: `test(trading): cover scoreboard-side safety flow` | Files: [`tests/*.test.ts`]

- [x] 9. Produce dry-run rollout evidence and update operational docs

  **What to do**: Update docs/runbook text to describe the new strategy identity, active mode selector, default Value mode, Volume mode availability, fixture-level one-shot rule, recipe seeding requirement, and dry-run-first rollout. Run a dry-run scripted/e2e scenario proving no live submission. Save command output to `.sisyphus/evidence/`. Include explicit rollback note: disable scoreboard-side observer intent creation or set active mode to a non-trading/disabled state, keep `live-trading-enabled=false`, inspect `/trading/intents`, and do not claim a working legacy `eleven-over` runtime path unless a separate task restores the missing legacy evaluator.
  **Must NOT do**: Do not place secrets in evidence. Do not claim live readiness unless all runbook gates are intentionally enabled and user has explicitly approved.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Operational validation and documentation synthesis.
  - Skills: [] - Docs plus command verification.
  - Omitted: [`frontend-design`] - No UI redesign.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: [Final Verification] | Blocked By: [1, 2, 3, 4, 5, 6, 7, 8]

  **References**:
  - Scoreboard-side strategy doc: `docs/ipl-observer-scoreboard-side-trading-plan.md:328-336`.
  - Runbook safety and rollout: `docs/polymarket-11-over-trading-runbook.md:9-25`, `docs/polymarket-11-over-trading-runbook.md:91-112`.
  - Trading status controls: research found `/trading/status` and `/trading/controls/live` in `src/trading/api.ts`.

  **Acceptance Criteria**:
  - [ ] Docs mention `scoreboard-side-11-13`, `value90`, `volume95`, dry-run-first rollout, and fixture-level one-shot behavior.
  - [ ] Evidence file proves dry-run adapter path and no live `createOrder` call.
  - [ ] Evidence file proves `/trading/status` remains dry-run unless existing live gates are deliberately enabled.

  **QA Scenarios**:
  ```
  Scenario: Dry-run e2e evidence
    Tool: Bash
    Steps: Run `TRADING_LIVE_ENABLED=false pnpm exec vitest run tests/trading-dry-run-e2e.test.ts -t "scoreboard-side dry run"` and save output.
    Expected: Intent is approved/acknowledged in dry-run; live adapter createOrder is never called.
    Evidence: .sisyphus/evidence/task-9-dry-run-rollout.txt

  Scenario: Docs contain rollout guardrails
    Tool: Bash
    Steps: Search updated docs for `scoreboard-side-11-13`, `value90`, `volume95`, `live-trading-enabled=false`, and `fixture-level`.
    Expected: All terms present in relevant operational sections; no credential values present.
    Evidence: .sisyphus/evidence/task-9-docs.txt
  ```

  **Commit**: YES | Message: `docs(trading): document scoreboard-side rollout guardrails` | Files: [`docs/polymarket-11-over-trading-runbook.md`, optional strategy doc update, `.sisyphus/evidence/*`]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high
- [x] F4. Scope Fidelity Check — deep

## 2026-05-13 Review Follow-up Fixes
- [x] Runtime scoreboard-side recipe seeding now occurs lazily in `createObserverTradeIntent()` before selected recipe lookup, using the mapped fixture market/condition/home token/away token and active strategy mode. Clean databases no longer return `RECIPE_MISSING` for otherwise valid scoreboard-side signals.
- [x] Fixture-level one-shot dedupe now ignores `recipeVersion` as well as `tokenId` only for `scoreboard-side-11-13`, and the partial DB unique index matches that scope.
- [x] The fixture-scope migration now preflights historical duplicate scoreboard-side scopes and raises a clear remediation error before unique-index creation if cleanup is needed.
- [x] Regression verification passed: `pnpm vitest run tests/observer-trade-intent.test.ts tests/trading-repository.test.ts tests/trading-recipe-seeding.test.ts tests/observer-service-scoreboard-intents.test.ts`, `pnpm typecheck`, and `pnpm build`.

## Commit Strategy
- Commit by task when each task’s acceptance criteria pass.
- Use conventional messages listed in each task.
- Do not commit secrets, `.env`, raw credentials, account identifiers, or live-order artifacts.
- Do not push or enable live trading unless the user explicitly requests it after dry-run evidence review.

## Success Criteria
- Backend trader creates dry-run intents from scoreboard-side rules, not favourite-only rules.
- Value mode is active by default; Volume mode is selectable but inactive unless configured.
- Chaser and defender buys correctly target home/away tokens through deterministic mapping.
- One match creates at most one strategy/window intent even if supported side or active mode flips.
- Existing executor, reconciliation, credential redaction, and live gates remain intact.
- Focused tests, `pnpm typecheck`, and `pnpm build` pass.
