# Issues

## 2026-05-12 Task: planning
- Existing `src/trading/observer-intents.ts` imports `../ipl/eleven-over-strategy.js`, but matching checked-in source appears missing. Full `pnpm typecheck` is expected to remain blocked until Task 4 removes this import.

## 2026-05-13 Task 7 observer service/status wiring
- No unresolved blockers. A pre-existing time-dependent exposure endpoint test was made deterministic with `vi.setSystemTime(FIXED_NOW)` so the targeted trading API suite does not depend on the wall-clock date.

## 2026-05-13 Review follow-up
- Resolved high-priority runtime seeding gap: clean DB scoreboard-side signals now seed both token recipes before lookup instead of returning `RECIPE_MISSING`.
- Resolved mode-switch duplicate gap: fixture-scope one-shot ignores recipe version and token for `scoreboard-side-11-13` while preserving exact versioned token intent keys.
- Resolved review design gap: shared repository fixture-scope lookup now returns matches only for `scoreboard-side-11-13`, aligning code behavior with the partial DB unique index.
- Resolved rollout safety gap: migration preflights duplicate scoreboard-side fixture scopes and fails with an explicit remediation message before creating the unique index.
