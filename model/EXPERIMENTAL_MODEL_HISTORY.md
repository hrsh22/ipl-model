# Experimental and ball-by-ball model history

This tracks model experiments, rejected ideas, and the experimental ball-by-ball workstream. It focuses on:

- what was tried
- why it was tried
- how it performed
- whether it was accepted, rejected, reverted, or left as future research

Production model decisions are summarized separately in the production history.

## Current experimental status

### Regular model experiments

Experiments are used to test changes before they affect the deployed model. A successful experiment still does not become production automatically. It must beat the relevant baseline and be safe operationally.

The most important rule is:

> Do not promote an experiment just because one metric improves. A model needs acceptable probability quality, cricket logic, and operational behavior.

### Experimental ball-by-ball model

The ball-by-ball model is currently a **shadow / research direction**, not the production predictor.

What exists today:

- The production system already learns from historical ball-by-ball-derived features such as powerplay, middle-over, death-over, wicket, boundary, and dot-ball behavior.
- The live ball-by-ball model idea is different: it would react to the current innings state while a match is in progress.
- One live-state context has been captured for a Delhi Capitals vs Royal Challengers Bengaluru match, including venue, innings, batting team, bowling team, and source commentary page.

Current decision: **experimental only**.

Reason: there is not yet a documented training loop, validation split, live failure policy, or backtest showing it beats the production pre-toss/post-toss models.

## Experimental timeline

### 2026-05-10 — RCB observer ball-state alias matching

Change / idea: make the experimental live ball-state observer attach overlays using the same canonical team aliases as the fixture/predictor pipeline, so `Royal Challengers Bangalore`, `Royal Challengers Bengaluru`, and `RCB` resolve to the same side.

What changed:

- Observer ball-state fixture matching now canonicalizes team names through the shared alias map before stripping punctuation.
- The dashboard/API ball-state run matcher in `src/index.ts` uses the same alias-aware normalization.
- Observer odds selections are stored under canonical selection keys, preventing provider `Bangalore` selections from missing fixture `Bengaluru` lookups.

Measured impact: no model artifact metrics changed; this is runtime attachment correctness for live overlays and opportunity display.

Decision: accepted for runtime use.

Reason: the RCB rename is a known data-source drift case, and matching live overlays by raw alphanumeric text is too brittle for production observer behavior.

### 2026-05-05 — first-innings observer win-probability target

Change / idea: prepare the experimental live ball-state observer to score a batting-team match-win probability during innings one, so the dashboard can show a model win probability before a chase target exists.

What changed:

- Added `batting_team_match_win` target wiring to the ball-state matrix/training scripts and tuning/selection inventories.
- The first all-innings target candidate looked strong in walk-forward but was rejected after the 2026 first-innings diagnostic showed material overconfidence. The trainer now restricts `batting_team_match_win` to innings 1 so its training population matches runtime use.
- Tested Platt, isotonic, and selected-trajectory alternatives. They either worsened locked-2026 log loss/Brier/ROC-AUC or retained worse overconfidence, so they were not promoted.
- Promoted `stable_depth4_lr003_l28_match_win_innings1` to the experimental observer runtime artifact.
- Extended live shadow scoring and the observer runtime payload to carry `battingTeamMatchWinProbability` / `battingTeamWinProbability` when a selected artifact exists.
- Updated the observer dashboard to render a first-innings `Batting win` probability separately from the existing second-innings `Chase win` probability. The runtime consumes `battingTeamMatchWinProbability` only in innings 1; innings 2 remains governed by `chase_success` and terminal chase logic.
- Generalized `model/backtest_ball_state_2026_official.py` so it can score either innings-2 `chase_success` or innings-1 `batting_team_match_win`.
- Added `model/test_ball_state_match_win_regressions.py` and `pnpm model:test:ball-state-live` to protect the innings-one training contract, runtime selection manifest, and observer innings gate.

Measured impact:

| evaluation | accuracy | ROC-AUC | log loss | Brier | calibration gap |
| --- | ---: | ---: | ---: | ---: |
| original all-innings walk-forward rows | `0.7033` | `0.7715` | `0.5728` | `0.1959` | `0.0602` ECE |
| original all-innings completed 2026 first-innings ball states | `0.5909` | `0.6911` | `0.6535` | `0.2318` | `+0.1794` |
| corrected innings-one walk-forward rows | `0.5768` | `0.6420` | `0.6809` | `0.2425` | `0.1000` ECE |
| corrected innings-one completed 2026 first-innings ball states | `0.6538` | `0.7306` | `0.6163` | `0.2145` | `+0.1430` |
| corrected innings-one completed 2026 first-innings final state by match | `0.6818` | n/a | n/a | n/a | n/a |

Decision: **experimental observer runtime only**.

Reason: the corrected innings-one model improves the locked 2026 first-innings diagnostic versus the original all-innings artifact and covers all 44 completed matches, but the 2026 diagnostic still shows positive overconfidence (`+0.1430` calibration gap). It is acceptable as an experimental live overlay, not as an execution-grade probability by itself.

### 2026-05-04 — experiment-only squad-info match model workflow

Change / idea: create a separate match-level experiment path that can test 2025-trained models with 2026 preseason squad information on the completed 2026 holdout without changing production serving or artifacts.

What changed:

- Added an experiment-only matrix builder that writes squad-info holdout CSVs, combined test matrices, and a dedicated matrix manifest under `model/experiments/<name>/`. The 2026 holdout rows now derive likely-XI/resource features from the dated preseason roster sidecar instead of falling back to stale historical XIs.
- Added optional `--manifest-path` and `--final-holdout-season` support to the CatBoost and XGBoost match-level trainers so experiments can train from non-production manifests while keeping 2026 as the untouched final holdout.
- Documented the workflow in `model/README-squad-info-experiments.md`.

Decision: **experimental only**.

Reason: the workflow isolates the squad-info idea under `model/experiments/` and treats 2026 completed matches as holdout labels, not training/calibration data.

### 2026-05-04 — production-parity squad-info 2026 holdout

Change / idea: rerun the squad-info 2026 holdout with the same model shapes used by production instead of generic full-feature baselines.

What changed:

- Pre-toss parity used the production-style CatBoost `top60_full` allowlist component, the CatBoost `delta` component, and a validation-selected CatBoost blend under `model/experiments/squad-info-2026-post-toss/artifacts_parity/`.
- Post-toss parity used the production-style XGBoost `post_toss_state` feature mode with a linear booster and exponential half-life season weighting.
- 2026 completed matches remained a final holdout: train through 2024, calibrate/validate on 2025, test on 44 completed 2026 rows.

Measured 2026 holdout impact:

| candidate | accuracy | ROC-AUC | log loss | Brier |
| --- | ---: | ---: | ---: | ---: |
| pre-toss CatBoost `top60_full` | `0.4318` | `0.3543` | `0.7102` | `0.2585` |
| pre-toss CatBoost `delta` | `0.5682` | `0.5413` | `0.6888` | `0.2479` |
| pre-toss validation-selected ensemble (`25% top60`, `75% delta`) | `0.5455` | `0.5021` | `0.6938` | `0.2503` |
| pre-toss fixed production-weight ensemble (`45% top60`, `55% delta`) | `0.4545` | `0.4525` | `0.6979` | `0.2524` |
| post-toss XGBoost `post_toss_state` linear | `0.5227` | `0.5744` | `0.6896` | `0.2482` |

Decision: **experimental only / not promoted**.

Reason: production-parity shape fixed the earlier generic-baseline mismatch and materially improved the 2026 holdout, especially post-toss. The pre-toss delta component beat the ensemble on this narrow 44-match slice, so promotion needs a broader guardrail run before changing production weights.

### 2026-05-04 — squad-info current-season breakthrough sweep

Change / idea: run targeted safe sweeps on the squad-info matrices with 2026 as the untouched final holdout, using feature views and recency settings suggested by prior production experiments.

What changed:

- Pre-toss sweep tested CatBoost `delta`, `delta_plus_mean`, no-identity variants, XGBoost delta variants, and weighted blends of the strongest components.
- Post-toss sweep tested production-safe `post_toss_state` XGBoost linear models across recency half-lives, shallow tree/state variants, no-identity variants, CatBoost state variants, weighted blends, and a modern-season-only matrix variant.
- All runs used the squad-info experiment manifest with `--final-holdout-season 2026`, so 2026 stayed test-only.

Breakthrough candidates on the 44 completed 2026 holdout:

| phase | candidate | accuracy | ROC-AUC | log loss | Brier |
| --- | --- | ---: | ---: | ---: | ---: |
| pre-toss | CatBoost `delta_plus_mean` uniform | `0.5909` | `0.5950` | `0.6872` | `0.2470` |
| pre-toss | weighted `delta_plus_mean` + XGBoost delta | `0.6136` | `0.5950` | `0.6875` | `0.2472` |
| post-toss | modern-season XGBoost `post_toss_state` linear, half-life `1.0` | `0.5455` | `0.5971` | `0.6853` | `0.2461` |

Decision: **experimental breakthrough / not promoted yet**.

Reason: both phases now beat the previous production-parity squad-info baselines on probability quality. The pre-toss weighted blend improves accuracy but slightly worsens log loss versus raw `delta_plus_mean`, so the primary pre-toss candidate is `delta_plus_mean` by probability quality. The post-toss modern half-life-1 state model is the best safe post-toss candidate found so far. Promotion still needs broader historical guardrails because the selection pressure used 2026 as the diagnostic holdout.

### 2026-05-04 — post-toss squad-info delta-plus-mean breakthrough

Change / idea: test whether post-toss should use the same matchup-compressed `delta_plus_mean` representation that improved pre-toss, while still preserving batting-order equivalence and keeping 2026 as a final holdout.

What changed:

- Added and evaluated post-toss `post_toss_state_delta_plus_mean` candidates under `model/experiments/squad-info-2026-post-toss/artifacts_post_improve/`.
- The best candidate was uniform-history CatBoost with isotonic calibration on the full squad-info post-toss matrix.
- The run kept the same leakage boundary as the earlier squad-info experiments: train through 2024, calibrate/validate on 2025, and test on completed 2026 rows only. The initial breakthrough used 44 completed rows; the refreshed holdout now has 48 completed rows.

Measured 2026 holdout impact:

| candidate | accuracy | ROC-AUC | log loss | Brier |
| --- | ---: | ---: | ---: | ---: |
| prior post-toss best: modern XGBoost `post_toss_state` linear, half-life `1.0` | `0.5455` | `0.5971` | `0.6853` | `0.2461` |
| prior pre-toss probability-quality best: CatBoost `delta_plus_mean` uniform | `0.5909` | `0.5950` | `0.6872` | `0.2470` |
| post-toss CatBoost `post_toss_state_delta_plus_mean` uniform + isotonic, 44-row initial holdout | `0.5682` | `0.5506` | `0.6712` | `0.2395` |
| post-toss CatBoost `post_toss_state_delta_plus_mean` uniform + isotonic, 48-row refreshed holdout | `0.5625` | `0.5487` | `0.6707` | `0.2394` |

Decision: **experimental post-toss breakthrough / not promoted yet**.

Reason: the new post-toss candidate materially improves probability quality versus both the prior safe post-toss best and the best pre-toss probability-quality candidate on the initial 44-match 2026 diagnostic holdout, and the refreshed 48-match holdout preserves the log-loss/Brier improvement. ROC-AUC is lower than the previous modern XGBoost state model, so this is not promotion-ready by itself; it needs broader historical guardrails and calibration checks before any production decision.

### 2026-05-04 — match-model promotion-readiness gate for squad-info candidates

Change / idea: add a promotion-readiness audit for the squad-info match-model experiments, then stage the post-toss CatBoost state delta-plus-mean candidate in a temporary final-models tree to test batting-order equivalence without touching production artifacts.

What changed:

- Added `model/check_match_model_promotion_eligibility.py` and the `pnpm model:eligibility:match` script.
- The checker verifies candidate artifacts, final-holdout isolation, production daily-refresh-style metric gates, and post-toss sensitivity/equivalence evidence.
- Updated post-toss inference so CatBoost final components can use `calibrationMethod` / `calibratorPath`, matching the experimental `catboost_tuned_isotonic` candidate instead of silently scoring the uncalibrated base model.
- Updated toss sensitivity testing so a fixture shell can be passed through `--fixture-row-json`, allowing staged validation without writing runtime fixture files.
- Staged the post-toss candidate under `/var/folders/31/p7sq6wwx6p9_6hrm6bx2c2940000gn/T/opencode/post-toss-promotion-readiness/final_models` and ran the toss sensitivity gate there.

Promotion-readiness results:

| candidate | eligible | accuracy | ROC-AUC | log loss | Brier | blocker |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| pre-toss CatBoost `delta_plus_mean` uniform | yes | `0.5909` | `0.5950` | `0.6872` | `0.2470` | none |
| pre-toss weighted `delta_plus_mean` + XGBoost delta | no | `0.6136` | `0.5950` | `0.6875` | `0.2472` | blend-search output is not directly packageable |
| post-toss CatBoost `post_toss_state_delta_plus_mean` uniform + isotonic | yes | `0.5682` | `0.5506` | `0.6712` | `0.2395` | none |

Refreshed 48-match promotion-readiness results after adding the latest completed 2026 labels:

| candidate | eligible | accuracy | ROC-AUC | log loss | Brier | blocker |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| pre-toss CatBoost `delta_plus_mean` uniform | yes | `0.6250` | `0.6400` | `0.6797` | `0.2433` | none |
| post-toss CatBoost `post_toss_state_delta_plus_mean` uniform + isotonic | yes | `0.5625` | `0.5487` | `0.6707` | `0.2394` | none |

Post-toss staged sensitivity result:

| check | value |
| --- | ---: |
| observed spread across toss states | `0.2009569378` |
| equivalent-state diff when team1 bats first | `0.0` |
| equivalent-state diff when team2 bats first | `0.0` |
| equivalent states match | `true` |
| sensitivity gate passed | `true` |

Decision: **promoted to production on 2026-05-08 as a joint pre-toss/post-toss pair**.

Reason: both primary candidates cleared the local promotion-readiness audit on the refreshed 48-match holdout, staged runtime checks, and post-toss sensitivity/equivalence checks. The user explicitly requested promotion if the deep readiness check passed, so the serialized/packageable primary candidates were promoted together. The higher-accuracy pre-toss blend remains blocked because it is only a blend-search result, not a serialized/packageable production candidate.

### 2026-05-03 — promoted live chase-success regularization candidate

Change / idea: run a broader live-safe `chase_success` sweep around the previous `stable_depth4_lr0045_l210` candidate and promote the first candidate that beats historical walk-forward guardrails while also improving the 2026 official-innings diagnostic holdout.

What changed:

- Added `stable_depth4_lr0035_l215` to the live tuning grid and candidate-selection inventory.
- Trained the candidate with `feature_mode=live_compatible`, `iterations=160`, `learning_rate=0.035`, `depth=4`, `l2_leaf_reg=15`, and no calibration.
- Updated `model/ball_state_live_candidate_selection.json` so the observer runtime bridge uses this artifact for second-innings `chase_success`.
- Bundled the selected observer runtime artifacts and the runtime feature-column manifest under `model/runtime_artifacts/ball_state_live/` so clean deploys do not depend on the ignored local `model/experiments/` tree.

Measured impact:

| metric | previous `stable_depth4_lr0045_l210` | promoted `stable_depth4_lr0035_l215` | direction |
| --- | ---: | ---: | --- |
| walk-forward log loss | `0.4841` | `0.4727` | better |
| walk-forward Brier | `0.1566` | `0.1530` | better |
| walk-forward ROC-AUC | `0.8522` | `0.8563` | better |
| walk-forward ECE | `0.0655` | `0.0605` | better |
| walk-forward accuracy | `0.7877` | `0.7839` | slightly lower |

2026 official-innings diagnostic holdout, selected after the sweep was frozen:

| metric | previous runtime artifact | promoted artifact | direction |
| --- | ---: | ---: | --- |
| row accuracy | `0.7672` | `0.7948` | better |
| log loss | `0.4445` | `0.4222` | better |
| Brier | `0.1470` | `0.1369` | better |
| ROC-AUC | `0.8772` | `0.8927` | better |
| final-state match accuracy | `0.8571` | `0.9048` | better |

Decision: **promoted for experimental observer runtime**.

Reason: the candidate improves the primary historical walk-forward metric and most probability-quality guardrails, while also improving the untouched 2026 official-innings diagnostic. The small walk-forward accuracy dip is accepted because this target is selected by log loss/probability quality, not raw threshold accuracy.

### 2026-05-03 — live chase-success health check and diagnostics

Change / idea: evaluate the current live `chase_success` artifact on completed IPL 2026 official innings feeds, compare calibration/trajectory alternatives, and make future backtests expose phase, calibration-bin, and worst-match diagnostics.

What changed:

- Extended the 2026 official-innings backtest summary to include phase metrics, probability-bin calibration, and worst matches by log loss.
- Re-ran the current selected `live_compatible` chase-success artifact on the latest 42 completed 2026 matches.
- Tested temporary Platt, isotonic, and selected-trajectory alternatives outside the tracked runtime manifest.

Findings:

- Current selected artifact on 42 completed 2026 matches: row accuracy `0.7672`, log loss `0.4445`, Brier `0.1470`, ROC-AUC `0.8772`, final-state match accuracy `0.8571`.
- Weakest phase is powerplay: accuracy `0.6885`, log loss `0.5660`, calibration gap `-0.1063`; death overs are much stronger with accuracy `0.8637`, log loss `0.3013`, ROC-AUC `0.9592`.
- The model underestimates successful chases overall on this 2026 slice: average predicted chase success `0.5436` vs actual rate `0.6313`.
- Platt calibration improved the same 42-match 2026 holdout to log loss `0.4368`, Brier `0.1438`, ROC-AUC `0.9107`, final-state accuracy `0.9524`, but it worsened historical walk-forward metrics versus the currently selected artifact.
- Uncalibrated selected-trajectory `chase_success` improved the 42-match 2026 holdout to log loss `0.4363`, Brier `0.1419`, accuracy `0.7921`, ROC-AUC `0.8928`, but also trailed the currently selected artifact on historical walk-forward log loss/ROC-AUC.

Decision: **no artifact promotion**.

Reason: the alternatives look promising on the live 2026 holdout, but both regress on the historical walk-forward guardrail. The safe next step is a broader candidate-selection run that treats current-season holdout performance as a diagnostic, not as training or promotion criteria.

### 2026-05-01 — preseason squad priors for live ball-state inference

Change / idea: add official 2026 preseason roster context to live ball-state inference without adding 2026 match results to the training matrix.

What changed:

- Added dated preseason roster and optional numeric prior sidecars under `model/data/features/`.
- Updated the shared live feature path so `PriorLookup.team_priors()` overlays date-gated 2026 preseason continuity after loading frozen historical priors.
- Runtime shadow scoring uses the same overlay because it reuses the parity feature builder.

Decision: **accepted for experimental live inference only**.

Reason: this captures squad churn before the 2026 season while keeping 2026 matches available for out-of-sample testing.

### 2026-05-01 — live observer runtime ball-state scoring bridge

Change / idea: wire the current `/observer/live-model` payload through the selected experimental ball-by-ball artifacts at request time instead of relying on pre-generated shadow files.

What changed:

- The observer runtime now invokes the existing live ball-state scorer against the current live payload and recent observer snapshots.
- Expected runs now and expected wickets now use `live_expected_now` artifacts so they do not copy the actual score state.
- Projected innings uses the selected-trajectory final-innings artifact when snapshot coverage is sufficient; otherwise the target remains unavailable.
- Chase success uses the stable live-compatible `chase_success` artifact for second innings.

Decision: **accepted for the experimental observer only**.

Reason: this makes the operator dashboard use the trained ball-by-ball workstream automatically for live expected-state fields while preserving the production predictor boundary and making missing model targets explicit.

### Initial model architecture — cricket fundamentals first, markets second

Change / idea: build an IPL prediction system that outputs team win probabilities, confidence, fair prices, market edge, and an explanation.

Core philosophy:

> Cricket fundamentals should produce the probability. Market data should be used afterward to compare price and edge.

Planned feature families:

- recent team form
- venue behavior
- head-to-head history
- batting-first and chasing strength
- powerplay, middle-over, and death-over performance
- Elo ratings
- probable XI strength
- player continuity
- rest days
- market overlay for price comparison

Decision: **accepted as the guiding architecture**.

Reason: it keeps the model from simply copying market odds and preserves the ability to find market disagreement.

### Historical ball-by-ball data foundation

Change / idea: use historical IPL ball-by-ball data as the base from which match-level and team-level features are derived.

What this enabled:

- match-level records
- innings summaries
- team batting and bowling summaries
- player match summaries
- venue phase behavior
- powerplay, middle-over, and death-over features

Decision: **accepted as the data foundation**.

Reason: ball-by-ball history provides the cricket-detail layer that match result data alone cannot provide.

### Separate pre-toss and post-toss datasets

Change / idea: keep pre-toss and post-toss training views separate.

Why this matters:

- Pre-toss predictions should not know the toss result.
- Post-toss predictions are allowed to know the toss result and batting order.
- Mixing those views would create leakage and make pre-toss performance look better than it really is.

Decision: **accepted**.

Reason: it prevents data leakage and keeps the two prediction modes honest.

### Player-style enrichment plan

Change / idea: enrich player data with batting style, bowling style, and playing role.

Potential features unlocked:

- team spin strength
- team pace strength
- venue spin wicket share
- venue pace wicket share
- better role-aware XI strength

Decision: **future research / not yet production**.

Reason: the idea is valuable, but the identity matching and metadata coverage need to be reliable before it can affect production probabilities.

### 2026-04-23 — current-season-only Elo experiment

Hypothesis: resetting Elo each IPL season would better reflect current squads and avoid stale franchise history.

Result:

| phase | effect |
| --- | --- |
| pre-toss | improved probability quality and ROC-AUC |
| post-toss | worsened probability quality and accuracy |

Metrics:

| phase | baseline log loss | candidate log loss | baseline Brier | candidate Brier | baseline ROC-AUC | candidate ROC-AUC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pre-toss | 0.6987 | 0.6940 | 0.2527 | 0.2504 | 0.5300 | 0.5495 |
| post-toss | 0.6920 | 0.6991 | 0.2492 | 0.2526 | 0.5612 | 0.5436 |

Decision: **rejected for production**.

Reason: the experiment helped pre-toss but hurt post-toss, so it was not safe as a shared model change.

Future note: this may still be worth testing as a pre-toss-only idea.

### 2026-04-23 — 2018+ training-window experiment

Hypothesis: older IPL seasons may be less relevant to current team structures, so training only on 2018 onward could improve modern predictions.

Result:

| phase | effect |
| --- | --- |
| pre-toss | improved strongly on the tested modern slice |
| post-toss | regressed materially |

Metrics:

| phase | baseline log loss | candidate log loss | baseline Brier | candidate Brier | baseline ROC-AUC | candidate ROC-AUC | baseline accuracy | candidate accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pre-toss | 0.7010 | 0.6858 | 0.2539 | 0.2463 | 0.4444 | 0.5833 | 0.4493 | 0.5507 |
| post-toss | 0.6797 | 0.6963 | 0.2433 | 0.2514 | 0.6073 | 0.5593 | 0.6377 | 0.5217 |

Decision: **rejected for production**.

Reason: the pre-toss improvement was promising but not broad enough, and the post-toss regression was too large.

Future note: this remains a candidate for a dedicated pre-toss-only experiment.

### 2026-04-23 — post-toss learner sweep on modern data

Hypothesis: even if the first 2018+ post-toss model was weak, another learner or ensemble might recover the signal.

What was tried:

- CatBoost models
- XGBoost models
- full feature views
- team-difference feature views
- no-identity feature views
- weighted ensembles
- stacked ensembles

Best candidates:

| candidate type | accuracy | ROC-AUC | log loss | Brier | interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| best single probabilistic model | 0.5362 | 0.6120 | 0.6854 | 0.2461 | good ROC-AUC, but still worse than baseline on core metrics |
| best weighted blend | 0.5217 | 0.6187 | 0.6850 | 0.2460 | best ROC-AUC, still not enough |
| best raw-accuracy XGBoost | 0.5652 | 0.5438 | 0.6970 | 0.2515 | accuracy improved, probability quality weak |

Decision: **rejected**.

Reason: no candidate beat the deployed post-toss model on the combination of probability quality, error metrics, and accuracy.

### 2026-04-23 — carry-over Elo inside modern training window

Hypothesis: if we train only on modern seasons, maybe Elo should still carry across those seasons rather than reset every year.

Result:

| setup | result |
| --- | --- |
| pre-toss | no measurable benefit |
| post-toss | higher raw accuracy in one setup, but worse probability quality |

Representative post-toss comparison:

| Elo mode | accuracy | ROC-AUC | log loss | Brier |
| --- | ---: | ---: | ---: | ---: |
| season-reset | 0.5362 | 0.6120 | 0.6854 | 0.2461 |
| carry-over | 0.5652 | 0.5568 | 0.6901 | 0.2485 |

Decision: **rejected**.

Reason: raw accuracy improvement was not enough because probability quality worsened. For betting/fair-price work, log loss and calibration-style quality matter more than raw accuracy alone.

### 2026-04-23 — no-Elo all-data experiment

Hypothesis: if Elo was stale or noisy, removing it entirely might improve the model.

Result:

| phase | accuracy delta | ROC-AUC delta | log-loss delta | Brier delta |
| --- | ---: | ---: | ---: | ---: |
| pre-toss | -0.0479 | -0.0244 | +0.0120 | +0.0054 |
| post-toss | -0.0621 | -0.0249 | +0.0071 | +0.0035 |

Decision: **reverted / rejected**.

Reason: removing Elo hurt both model phases. Elo is imperfect, but still useful.

### 2026-04-28 — toss-sensitive post-toss experiments

Hypothesis: post-toss XGBoost should react to toss outcome and batting order instead of returning the same probability for different post-toss scenarios.

Experiment path:

1. Add toss and batting-order implication features.
2. Try an XGBoost blend that mixes a tree model with a linear toss-aware model.
3. Revert that blend because metrics regressed heavily.
4. Try a single toss-sensitive tree model.
5. Supersede that model because equivalent batting-order states did not match.
6. Accept a batting-order-state model that enforces the correct cricket semantics.

Key results:

| candidate | accuracy | ROC-AUC | log loss | Brier | decision |
| --- | ---: | ---: | ---: | ---: | --- |
| first toss-sensitive blend | 0.5372 | 0.5405 | 0.6962 | 0.2513 | reverted; too weak |
| toss-sensitive tree | 0.5189 | 0.5511 | 0.6989 | 0.2525 | superseded; violated equivalent-state logic |
| batting-order-state model | 0.5119 | 0.5444 | 0.7039 | 0.2550 | accepted; semantically correct |

Decision: **partially accepted**.

Reason: the experiment did not produce the strongest metric model, but it fixed a major semantic issue in post-toss mode. The accepted model is a correctness-first bridge, not the final quality target.

### 2026-04-28 — daily experiment suite updated for batting-order-state models

Change: daily training and experiment runs now include the batting-order-state post-toss model family.

Additional guard: post-toss candidates must pass a sensitivity and equivalent-state check before promotion.

Decision: **accepted as experiment and automation infrastructure**.

Reason: future daily retrains must test the same semantic behavior expected in production.

## Ball-by-ball / ball-state roadmap

### What exists now

- Historical ball-by-ball events are already used to build pre-match and post-toss features.
- The production model benefits from ball-by-ball-derived phase summaries.
- A live ball-state shadow direction exists, but it is not production.

### What the live ball-by-ball model should eventually do

It should understand the current state of an innings, including:

- batting team
- bowling team
- innings number
- venue
- current score context
- over and ball
- wickets
- batter/bowler context
- phase of innings
- recent ball sequence

It should then estimate match win probability from the live cricket state.

### Why it is not production yet

Before promotion, it needs:

1. A stable live-state feature schema.
2. A way to reconstruct historical in-match states for training.
3. Backtests against the existing pre-toss and post-toss models.
4. Clear calibration checks.
5. A live-data reliability plan for delayed or missing ball commentary.
6. Separation from trading heuristics and market overlays.

Current decision: **keep experimental**.

Reason: there is not yet enough evidence to trust it for production pricing.

## Summary of rejected or not-promoted experiments

| experiment | final status | reason |
| --- | --- | --- |
| current-season-only Elo | rejected | helped pre-toss but hurt post-toss |
| 2018+ training window | rejected | promising pre-toss slice, major post-toss regression |
| post-toss modern-data learner sweep | rejected | no candidate beat the deployed baseline on core metrics |
| carry-over Elo in modern window | rejected | raw accuracy was not enough; probability quality worsened |
| no-Elo model | reverted / rejected | Elo removal hurt both phases |
| first toss-sensitive XGBoost blend | reverted | restored some movement but regressed too much |
| toss-sensitive tree with toss-agency wording | superseded | different wording of same cricket state could produce different prices |
| live ball-by-ball model | still experimental | no complete training/evaluation evidence yet |

## Rules for future experiment notes

For every future experiment, record:

1. What was tried.
2. Why it was tried.
3. What changed at the model-behavior level.
4. How it performed against the current baseline.
5. Whether it was accepted, rejected, reverted, or left open.
6. The plain-English reason for that decision.

If an experiment affects the deployed model, also update the production history.
