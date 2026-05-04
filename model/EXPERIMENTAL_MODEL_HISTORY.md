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
