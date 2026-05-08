# Production model history

This tracks the deployed IPL prediction model: what changed, how the change performed, and whether it was accepted, rejected, reverted, or kept only as a future idea.

## Current production model

### Pre-toss model

The current pre-toss model is a single CatBoost `delta_plus_mean` squad-info component. It focuses on team-vs-team gaps while retaining matchup mean context, using preseason squad/XI resource features for the 2026 evaluation boundary.

Current benchmark:

| accuracy | ROC-AUC | log loss | Brier score |
| ---: | ---: | ---: | ---: |
| 0.6250 | 0.6400 | 0.6797 | 0.2433 |

Decision: **accepted and active**.

Why it is active: it beat the previous deployed pre-toss benchmark across accuracy, ROC-AUC, log loss, and Brier on the refreshed 48-match completed-2026 holdout, while preserving the no-2026-training leakage boundary.

### Post-toss model

The current post-toss model is a CatBoost `post_toss_state_delta_plus_mean` squad-info component with isotonic calibration. It uses the **resulting batting-order state** after the toss, plus team-vs-team deltas and matchup mean context.

The important rule is:

> If two toss descriptions create the same batting order, they must produce the same probability.

For example:

- “Punjab win toss and bat” is the same cricket state as “Rajasthan win toss and field.”
- “Punjab win toss and field” is the same cricket state as “Rajasthan win toss and bat.”

Latest verified behavior for Gujarat Titans vs Punjab Kings in the staged/production promotion fixture shell:

| post-toss state | Gujarat win probability |
| --- | ---: |
| Gujarat bat first | 0.5263 |
| Punjab field first | 0.5263 |
| Gujarat field first | 0.7273 |
| Punjab bat first | 0.7273 |

Current benchmark:

| accuracy | ROC-AUC | log loss | Brier score |
| ---: | ---: | ---: | ---: |
| 0.5625 | 0.5487 | 0.6707 | 0.2394 |

Decision: **accepted and active**.

Why it is active: it improves the deployed post-toss benchmark across accuracy, ROC-AUC, log loss, and Brier on the refreshed 48-match completed-2026 holdout. Staged and post-promotion sensitivity checks preserve the required cricket logic: probabilities move when batting order changes, and equivalent toss phrasings match exactly.

## Timeline of production-relevant changes

### 2026-05-08 — squad-info pre/post match models jointly promoted

Change: promoted the experimental squad-info match-model pair into `model/final_models`: pre-toss now uses CatBoost `delta_plus_mean` (`cat_delta_plus_mean_uniform`) and post-toss now uses CatBoost `post_toss_state_delta_plus_mean` with isotonic calibration (`cat_state_dpm_uniform`). Added `model/promote_catboost_single_component.py` so reviewed single-component CatBoost artifacts can be packaged with self-contained manifests, copied model/calibrator files, copied training matrices, backups, and revision-history entries. The repo PM2 daily refresh config now runs without `--auto-promote-pre-toss` / `--auto-promote-post-toss` so a future PM2 reload does not silently re-enable automatic model replacement.

Impact: on the refreshed 48-match completed-2026 holdout, pre-toss improved from the prior deployed benchmark `0.5365` accuracy / `0.5300` ROC-AUC / `0.6987` log loss / `0.2527` Brier to `0.6250` / `0.6400` / `0.6797` / `0.2433`. Post-toss improved from `0.5119` / `0.5444` / `0.7039` / `0.2550` to `0.5625` / `0.5487` / `0.6707` / `0.2394`. Post-toss sensitivity passed with observed spread `0.2009569377990431` and equivalent-state diffs `0.0` for both batting-order groups.

Decision: **accepted and promoted**.

Reason: both candidates cleared the strict promotion-readiness audit with 2026 held out from training/calibration/validation, staged runtime prediction worked, post-toss equivalence passed, and both phases were promoted together as requested. The final promoted model source hash after the post-toss package refresh is `4d0ac460a23a619c85712153023092e1ebe81b9a5e5d7b4eacb33f8be0fedd92`.

### 2026-05-01 — post-toss official XI contract tightened

Change: kept production model weights unchanged, but tightened the runtime contract for post-toss inference. Automatic post-toss predictions now require official toss plus confirmed/effective XI, post-toss manual preselection follows the official effective XI before falling back to confirmed XI, and the web UI no longer resubmits the unchanged official XI through the generic manual probable-XI path.

Impact: this removes a probability drift where re-submitting the same official XI as a manual probable XI could produce a different post-toss probability from the automatic official-feed path. It also prevents the UI from claiming post-toss auto readiness when only toss data is present. Fixture `2483` remains an official post-toss auto prediction with `official_post_toss_applied: true` and no probable-XI override.

Decision: **accepted**.

Reason: this is an inference-input correctness fix. It does not change model artifacts, but it protects the deployed model from receiving semantically different feature inputs for the same official XI state.

### 2026-05-01 — official fixture kickoff times preserved

Change: kept production model weights unchanged, but corrected the official IPL fixture input contract. Fixture ingestion now serializes official kickoff instants from `GMTMatchDate` + `GMTMatchTime` instead of turning date-only `MatchDate` values into midnight UTC.

Impact: dashboard/operator timing and live prediction windows now align with the actual match start. Rajasthan Royals vs Delhi Capitals (`2483`) moved from `2026-05-01T00:00:00.000Z` to `2026-05-01T14:00:00.000Z`, which displays as 7:30 PM IST instead of 5:30 AM IST. The observed pre-toss probability movement from Delhi `0.55077` to `0.52990` was caused by the related player-name canonicalization, not the kickoff timestamp; model artifacts and benchmark metrics are unchanged.

Decision: **accepted**.

Reason: this is an inference-data correctness fix that prevents scheduled fixtures from being treated as midnight starts.

### 2026-05-01 — predictor input contract hardened after OpticOdds removal

Change: kept production model weights unchanged, but changed the live predictor inputs around them. Fixture discovery can now use the official IPL schedule when OpticOdds is disabled; automatic pre-toss predictions send the suggested XI explicitly; manual mode starts from the same XI and only becomes an override when edited. The predictor now records whether a probable XI came from `suggested` or `manual`, rejects partial XI payloads, canonicalizes common player-name variants for XI feature lookup, excludes no-result rows from current-season result supplements, and stops counting full squad bench players as zero-stat player appearances.

Impact: production probabilities can change because inference-time fixture, current-season form, and probable-XI inputs changed. For the current Rajasthan Royals vs Delhi Capitals fixture (`2483`), the suggested-XI pre-toss read now gives Delhi `0.52990` after alias canonicalization, and the output correctly marks the XI source as suggested rather than manual. Post-toss behavior remains gated on toss information; manual toss input still produces a valid post-toss prediction when official toss data is unavailable.

Decision: **accepted**.

Reason: this is an operational correctness fix. The production model artifacts remain active, but their live inputs are now available without OpticOdds and are labelled/validated more accurately.

### 2026-04-23 — model-change tracking created

Change: started maintaining a written model-change record so every material model change explains what changed, why, how it performed, and whether it was accepted or rejected.

Impact: no prediction impact.

Decision: **accepted**.

Reason: production model changes need a written audit trail, not only machine logs.

### 2026-04-23 — current-season-only Elo tested

Change: tested resetting team Elo ratings at the start of each IPL season instead of carrying ratings across seasons.

Hypothesis: current-season Elo may better reflect current squads and avoid stale franchise history.

Impact:

| model phase | effect |
| --- | --- |
| pre-toss | improved probability quality and ROC-AUC |
| post-toss | materially worsened probability quality and accuracy |

Detailed metrics:

| phase | baseline log loss | candidate log loss | baseline Brier | candidate Brier | baseline ROC-AUC | candidate ROC-AUC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pre-toss | 0.6987 | 0.6940 | 0.2527 | 0.2504 | 0.5300 | 0.5495 |
| post-toss | 0.6920 | 0.6991 | 0.2492 | 0.2526 | 0.5612 | 0.5436 |

Decision: **rejected for production**.

Reason: it helped pre-toss but hurt post-toss too much. A shared production Elo change was not safe.

### 2026-04-23 — 2018+ training window tested

Change: tested training on only modern IPL seasons from 2018 onward.

Hypothesis: older IPL seasons may have stale team and player patterns that hurt modern predictions.

Impact:

| model phase | effect |
| --- | --- |
| pre-toss | improved strongly on the 2025 test slice |
| post-toss | regressed materially |

Detailed metrics:

| phase | baseline log loss | candidate log loss | baseline Brier | candidate Brier | baseline ROC-AUC | candidate ROC-AUC | baseline accuracy | candidate accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pre-toss | 0.7010 | 0.6858 | 0.2539 | 0.2463 | 0.4444 | 0.5833 | 0.4493 | 0.5507 |
| post-toss | 0.6797 | 0.6963 | 0.2433 | 0.2514 | 0.6073 | 0.5593 | 0.6377 | 0.5217 |

Decision: **rejected for production**.

Reason: the pre-toss signal was interesting, but the post-toss regression was too large and the pre-toss result depended on a narrow test slice. It remains a possible pre-toss-only research direction.

### 2026-04-23 — no-Elo model tested

Change: tested removing Elo-derived features entirely while keeping the full historical training window.

Hypothesis: if stale Elo was the problem, removing Elo might improve model robustness.

Impact:

| model phase | accuracy delta | ROC-AUC delta | log-loss delta | Brier delta |
| --- | ---: | ---: | ---: | ---: |
| pre-toss | -0.0479 | -0.0244 | +0.0120 | +0.0054 |
| post-toss | -0.0621 | -0.0249 | +0.0071 | +0.0035 |

Decision: **reverted / rejected**.

Reason: removing Elo hurt both pre-toss and post-toss. Elo remains useful.

### Before 2026-04-28 — strong but flawed post-toss baseline

State: the old post-toss model had better benchmark metrics than the current state model.

Benchmark:

| accuracy | ROC-AUC | log loss | Brier score |
| ---: | ---: | ---: | ---: |
| 0.5691 | 0.5612 | 0.6920 | 0.2492 |

Problem: it was semantically wrong for manual post-toss use. Changing toss winner and toss decision could leave probabilities unchanged, so the model did not reliably react to the cricket information the operator entered.

Decision: **replaced despite stronger metrics**.

Reason: post-toss mode must respond to batting-order information. A strong metric model that ignores the key post-toss state is not acceptable for this product.

### 2026-04-28 — first toss-sensitive post-toss blend tested and rolled back

Change: added toss-derived and batting-order-derived features, then tried a blended XGBoost setup to make post-toss probabilities move when toss assumptions changed.

Impact:

| metric | old baseline | candidate | delta |
| --- | ---: | ---: | ---: |
| log loss | 0.6797 | 0.6962 | +0.0165 |
| Brier | 0.2433 | 0.2513 | +0.0080 |
| ROC-AUC | 0.6073 | 0.5405 | -0.0668 |
| accuracy | 0.6377 | 0.5372 | -0.1005 |

Decision: **reverted**.

Reason: the model became more responsive, but the validation regression was too large and the resulting prices looked operationally unsafe.

### 2026-04-28 — toss-sensitive tree model tested and superseded

Change: tried a single tree-based XGBoost model that directly used toss and batting-order implication features.

Impact:

| model | log loss | Brier | ROC-AUC | accuracy |
| --- | ---: | ---: | ---: | ---: |
| old post-toss baseline | 0.6920 | 0.2492 | 0.5612 | 0.5691 |
| first blend | 0.6962 | 0.2513 | 0.5405 | 0.5372 |
| toss-sensitive tree | 0.6989 | 0.2525 | 0.5511 | 0.5189 |

Positive: it restored meaningful movement across toss scenarios.

Problem: it violated equivalence. It could price “team wins toss and bats” differently from “opponent wins toss and fields,” even though those are the same batting-order state.

Decision: **superseded**.

Reason: post-toss pricing must depend on the cricket state, not on wording or toss agency.

### 2026-04-28 — batting-order-state post-toss model accepted

Change: changed the post-toss model to use batting-order state rather than toss-agency wording.

It keeps features like:

- who bats first
- who fields first
- how each team historically performs batting first or chasing
- venue batting-order tendencies

It removes direct wording features like:

- which team won the toss
- whether the toss winner chose bat or field

Impact:

| model | log loss | Brier | ROC-AUC | accuracy |
| --- | ---: | ---: | ---: | ---: |
| previous toss-sensitive tree | 0.6989 | 0.2525 | 0.5511 | 0.5189 |
| accepted state model | 0.7039 | 0.2550 | 0.5444 | 0.5119 |

Decision: **accepted**.

Reason: metrics are weaker, but the model now obeys the required cricket logic. Equivalent batting-order states match exactly, and different batting-order states produce different probabilities.

### 2026-04-28 — daily retraining updated for the accepted post-toss model

Change: updated the 4am daily training path so it retrains the accepted batting-order-state post-toss model family instead of the older full-feature post-toss family.

Additional guard: before daily auto-promotion, the post-toss candidate must pass a sensitivity and equivalence check.

Decision: **accepted**.

Reason: without this, the daily job could retrain and promote an older model family that does not satisfy the new post-toss correctness requirement.

## Summary of rejected or reverted production-relevant changes

| change | final status | reason |
| --- | --- | --- |
| current-season-only Elo | rejected | helped pre-toss but hurt post-toss |
| 2018+ training window | rejected | promising pre-toss slice, but post-toss regressed heavily |
| no-Elo model | reverted / rejected | removing Elo hurt both phases |
| first toss-sensitive blend | reverted | probabilities moved, but metrics and price behavior regressed too much |
| toss-sensitive tree with toss-agency features | superseded | moved correctly, but equivalent cricket states did not match |

## Current priorities

1. Keep the pre-toss ensemble stable unless a candidate clearly improves probability quality.
2. Keep post-toss on batting-order-state modeling until a stronger model preserves the same equivalence rules.
3. Treat the old post-toss benchmark as the quality target, but do not return to it unless it also responds correctly to batting-order state.
4. Every production model change should document the change, impact, decision, and reason in plain English.
