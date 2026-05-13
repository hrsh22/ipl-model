# Decisions

## 2026-05-12 Task: planning
- Use new strategy identity `scoreboard-side-11-13`; do not silently mutate legacy `eleven-over`.
- Default active mode is `value90` with price cap `0.90` and allocation fraction `0.20`.
- Keep `volume95` selectable with price cap `0.95` and allocation fraction `0.10`.
- Rollout remains dry-run first; live gates must not be bypassed.
- Rollback means disabling scoreboard-side observer intent creation and keeping live disarmed, not restoring absent legacy evaluator source.

## 2026-05-13 Task 3 fixture-level one-shot persistence
- Enforce one-shot trading at DB level with unique index `trading_trade_intents_fixture_scope_idx` over `strategy_key, recipe_version, window_key, fixture_id, market_id, side`; this gives concurrency protection beyond the repository precheck.
- Keep `trading_trade_intents_intent_key_idx` unchanged because token-scoped idempotency is still useful for exact duplicate recipe/intent retries.

## 2026-05-13 Task 3 verification fixes
- Changed trade-intent insert handling to targetless `onConflictDoNothing()` so conflicts from either `intent_key` or the fixture-scope unique index return no inserted row and let repository fallback lookups resolve idempotently.
- Scoped the fixture-scope unique index to `strategy_key = 'scoreboard-side-11-13'` because the hard DB one-shot protection is needed for the new scoreboard-side strategy, while a global index could fail migration or constrain historical/legacy strategies that may already have opposite-token duplicates. The repository fixture-scope lookup remains generic for callers, but DB-level enforcement is intentionally limited to the new strategy rollout.
