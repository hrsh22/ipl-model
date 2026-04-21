# IPL model techniques and performance

This report combines historical technique summaries already present in the repo with new experiment outputs. Metrics are walk-forward averages unless the source only stored a summary JSON.

## Overall leaderboard (focus split)

| matrix | root_label | source_dir | model | accuracy_mean | roc_auc_mean | log_loss_mean | brier_mean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| post_toss | recency_try | post_toss/xgboost_full_recency_h3 | xgboost_tuned | 0.5691 | 0.5612 | 0.6920 | 0.2492 |
| post_toss | recency_try | post_toss/xgboost_full_recency_h2 | xgboost_tuned | 0.5016 | 0.5334 | 0.6948 | 0.2508 |
| post_toss | xgboost_try | post_toss/weighted_xgboost_full__catboost_ensemble | weighted_ensemble__xgb_full__cat_ens | 0.5383 | 0.5565 | 0.6969 | 0.2517 |
| post_toss | final_try | post_toss/xgboost_full_recency_h35_dense_a | xgboost_tuned | 0.5272 | 0.5278 | 0.6979 | 0.2521 |
| post_toss | xgboost_try | post_toss/xgboost_full | xgboost_tuned | 0.5471 | 0.5705 | 0.6980 | 0.2519 |
| post_toss | recency_try | post_toss/weighted_xgboost_h3__catboost_ensemble | weighted_ensemble__xgb_h3__cat_ens | 0.5313 | 0.5535 | 0.6980 | 0.2522 |
| post_toss | recency_try | post_toss/xgboost_full_recency_h3 | xgboost_tuned_platt | 0.5416 | 0.5612 | 0.6982 | 0.2520 |
| post_toss | final_try | post_toss/xgboost_full_recency_h4_dense_b | xgboost_tuned | 0.5162 | 0.5355 | 0.7006 | 0.2533 |
| post_toss | final_try | post_toss/xgboost_full_recency_h35_dense_a | xgboost_tuned_platt | 0.5506 | 0.5278 | 0.7030 | 0.2542 |
| post_toss | current | post_toss/ensemble_catboost | ensemble_summary | 0.5135 | 0.5158 | 0.7035 | 0.2549 |
| post_toss | recency_try | post_toss/xgboost_full_recency_h2 | xgboost_tuned_platt | 0.5277 | 0.5334 | 0.7036 | 0.2547 |
| post_toss | current | post_toss/full | catboost_tuned | 0.5272 | 0.5214 | 0.7036 | 0.2548 |
| post_toss | current | post_toss | catboost_tuned | 0.5272 | 0.5214 | 0.7036 | 0.2548 |
| post_toss | final_try | post_toss/xgboost_full_recency_h4_dense_b | xgboost_tuned_platt | 0.5087 | 0.5355 | 0.7057 | 0.2556 |
| post_toss | xgboost_try | post_toss/xgboost_full | xgboost_tuned_platt | 0.5192 | 0.5705 | 0.7061 | 0.2557 |
| post_toss | final_try | post_toss/xgboost_full_recency_h3_dense_a | xgboost_tuned_platt | 0.5320 | 0.5258 | 0.7061 | 0.2555 |
| post_toss | final_try | post_toss/xgboost_full_recency_h3_dense_a | xgboost_tuned | 0.4973 | 0.5258 | 0.7068 | 0.2559 |
| post_toss | xgboost_try | post_toss/xgboost_delta | xgboost_tuned | 0.4825 | 0.5338 | 0.7074 | 0.2567 |
| post_toss | current | post_toss/delta | catboost_tuned | 0.5094 | 0.5338 | 0.7095 | 0.2576 |
| post_toss | xgboost_try | post_toss/xgboost_delta | xgboost_tuned_platt | 0.5085 | 0.5215 | 0.7115 | 0.2583 |

## post_toss

| root_label | source_dir | model | accuracy_mean | roc_auc_mean | log_loss_mean | brier_mean |
| --- | --- | --- | --- | --- | --- | --- |
| current | post_toss/delta | catboost_tuned | 0.5094 | 0.5338 | 0.7095 | 0.2576 |
| current | post_toss/delta | catboost_tuned_platt | 0.5085 | 0.5338 | 0.7125 | 0.2589 |
| current | post_toss/delta | logistic_regression | 0.5244 | 0.5248 | 0.9176 | 0.3056 |
| current | post_toss/full | catboost_tuned | 0.5272 | 0.5214 | 0.7036 | 0.2548 |
| current | post_toss/full | catboost_tuned_platt | 0.5154 | 0.5214 | 0.7143 | 0.2595 |
| current | post_toss/full | logistic_regression | 0.5096 | 0.5276 | 1.0989 | 0.3407 |
| current | post_toss | catboost_tuned | 0.5272 | 0.5214 | 0.7036 | 0.2548 |
| current | post_toss | catboost_tuned_platt | 0.5154 | 0.5214 | 0.7143 | 0.2595 |
| current | post_toss | logistic_regression | 0.5096 | 0.5276 | 1.0989 | 0.3407 |
| current | post_toss/ensemble_catboost | ensemble_summary | 0.5135 | 0.5158 | 0.7035 | 0.2549 |
| xgboost_try | post_toss/stacked_xgboost__catboost_best | stacked_ensemble | 0.5041 | 0.5323 | 0.7130 | 0.2595 |
| xgboost_try | post_toss/weighted_xgboost_full__catboost_ensemble | weighted_ensemble__xgb_full__cat_ens | 0.5383 | 0.5565 | 0.6969 | 0.2517 |
| xgboost_try | post_toss/xgboost_delta | xgboost_tuned | 0.4825 | 0.5338 | 0.7074 | 0.2567 |
| xgboost_try | post_toss/xgboost_delta | xgboost_tuned_isotonic | 0.5390 | 0.5259 | 1.0604 | 0.2799 |
| xgboost_try | post_toss/xgboost_delta | xgboost_tuned_platt | 0.5085 | 0.5215 | 0.7115 | 0.2583 |
| xgboost_try | post_toss/xgboost_full | xgboost_tuned | 0.5471 | 0.5705 | 0.6980 | 0.2519 |
| xgboost_try | post_toss/xgboost_full | xgboost_tuned_isotonic | 0.5552 | 0.5484 | 1.2665 | 0.2812 |
| xgboost_try | post_toss/xgboost_full | xgboost_tuned_platt | 0.5192 | 0.5705 | 0.7061 | 0.2557 |
| recency_try | post_toss/catboost_full_recency_h3 | catboost_tuned | 0.4930 | 0.4985 | 0.7199 | 0.2626 |
| recency_try | post_toss/catboost_full_recency_h3 | catboost_tuned_platt | 0.4732 | 0.4985 | 0.7249 | 0.2646 |
| recency_try | post_toss/catboost_full_recency_h3 | logistic_regression | 0.5096 | 0.5276 | 1.0989 | 0.3407 |
| recency_try | post_toss/weighted_xgboost_h3__catboost_ensemble | weighted_ensemble__xgb_h3__cat_ens | 0.5313 | 0.5535 | 0.6980 | 0.2522 |
| recency_try | post_toss/xgboost_full_recency_h2 | xgboost_tuned | 0.5016 | 0.5334 | 0.6948 | 0.2508 |
| recency_try | post_toss/xgboost_full_recency_h2 | xgboost_tuned_platt | 0.5277 | 0.5334 | 0.7036 | 0.2547 |
| recency_try | post_toss/xgboost_full_recency_h3 | xgboost_tuned | 0.5691 | 0.5612 | 0.6920 | 0.2492 |
| recency_try | post_toss/xgboost_full_recency_h3 | xgboost_tuned_platt | 0.5416 | 0.5612 | 0.6982 | 0.2520 |
| final_try | post_toss/xgboost_full_recency_h35_dense_a | xgboost_tuned | 0.5272 | 0.5278 | 0.6979 | 0.2521 |
| final_try | post_toss/xgboost_full_recency_h35_dense_a | xgboost_tuned_platt | 0.5506 | 0.5278 | 0.7030 | 0.2542 |
| final_try | post_toss/xgboost_full_recency_h3_dense_a | xgboost_tuned | 0.4973 | 0.5258 | 0.7068 | 0.2559 |
| final_try | post_toss/xgboost_full_recency_h3_dense_a | xgboost_tuned_platt | 0.5320 | 0.5258 | 0.7061 | 0.2555 |
| final_try | post_toss/xgboost_full_recency_h4_dense_b | xgboost_tuned | 0.5162 | 0.5355 | 0.7006 | 0.2533 |
| final_try | post_toss/xgboost_full_recency_h4_dense_b | xgboost_tuned_platt | 0.5087 | 0.5355 | 0.7057 | 0.2556 |

## pre_toss

| root_label | source_dir | model | accuracy_mean | roc_auc_mean | log_loss_mean | brier_mean |
| --- | --- | --- | --- | --- | --- | --- |
| current | pre_toss/delta | catboost_tuned | 0.5258 | 0.5285 | 0.7031 | 0.2546 |
| current | pre_toss/delta | catboost_tuned_platt | 0.5276 | 0.5285 | 0.7054 | 0.2558 |
| current | pre_toss/delta | logistic_regression | 0.5040 | 0.5217 | 0.9216 | 0.3061 |
| current | pre_toss/delta_plus_mean | catboost_tuned | 0.5070 | 0.5037 | 0.7025 | 0.2544 |
| current | pre_toss/delta_plus_mean | catboost_tuned_platt | 0.5000 | 0.5037 | 0.7146 | 0.2595 |
| current | pre_toss/delta_plus_mean | logistic_regression | 0.5272 | 0.5346 | 1.1146 | 0.3427 |
| current | pre_toss/full | catboost_tuned | 0.5014 | 0.5387 | 0.7001 | 0.2532 |
| current | pre_toss/full | catboost_tuned_platt | 0.5256 | 0.5387 | 0.7117 | 0.2581 |
| current | pre_toss/full | logistic_regression | 0.5094 | 0.5351 | 1.0856 | 0.3379 |
| current | pre_toss/full_no_identity | catboost_tuned | 0.5080 | 0.5213 | 0.7088 | 0.2569 |
| current | pre_toss/full_no_identity | catboost_tuned_platt | 0.5184 | 0.5182 | 0.7204 | 0.2618 |
| current | pre_toss/full_no_identity | logistic_regression | 0.5194 | 0.5254 | 1.0423 | 0.3322 |
| current | pre_toss | catboost_tuned | 0.5014 | 0.5387 | 0.7001 | 0.2532 |
| current | pre_toss | catboost_tuned_platt | 0.5256 | 0.5387 | 0.7117 | 0.2581 |
| current | pre_toss | logistic_regression | 0.5094 | 0.5351 | 1.0856 | 0.3379 |
| current | pre_toss/artifacts_pruned/top60/pre_toss/full__delta | ensemble_summary | 0.5365 | 0.5300 | 0.6987 | 0.2527 |
| current | pre_toss/ensemble_catboost | ensemble_summary | 0.5346 | 0.5293 | 0.6992 | 0.2529 |
| current | pre_toss/ensemble_catboost__full__delta | ensemble_summary | 0.5365 | 0.5300 | 0.6987 | 0.2527 |
| current | pre_toss/stacked_ensemble | summary_json | 0.5013 | 0.5161 | 0.7129 | 0.2595 |
| pruned | top40/pre_toss/full | catboost_tuned | 0.5175 | 0.5291 | 0.7111 | 0.2572 |
| pruned | top40/pre_toss/full | catboost_tuned_platt | 0.5128 | 0.5291 | 0.7132 | 0.2588 |
| pruned | top40/pre_toss/full | logistic_regression | 0.5112 | 0.5338 | 0.8660 | 0.3042 |
| pruned | top60/pre_toss/full | catboost_tuned | 0.5179 | 0.5258 | 0.6984 | 0.2526 |
| pruned | top60/pre_toss/full | catboost_tuned_platt | 0.5303 | 0.5258 | 0.7092 | 0.2575 |
| pruned | top60/pre_toss/full | logistic_regression | 0.4888 | 0.5322 | 0.9373 | 0.3178 |
| pruned | top80/pre_toss/full | catboost_tuned | 0.5076 | 0.5356 | 0.7029 | 0.2544 |
| pruned | top80/pre_toss/full | catboost_tuned_platt | 0.5161 | 0.5356 | 0.7109 | 0.2582 |
| pruned | top80/pre_toss/full | logistic_regression | 0.5043 | 0.5361 | 0.9512 | 0.3180 |
| catboost_try | pre_toss/delta | catboost_tuned | 0.5370 | 0.5578 | 0.6998 | 0.2532 |
| catboost_try | pre_toss/delta | catboost_tuned_isotonic | 0.5546 | 0.5626 | 1.0959 | 0.2787 |
| catboost_try | pre_toss/delta | catboost_tuned_platt | 0.5163 | 0.5578 | 0.7048 | 0.2555 |
| catboost_try | pre_toss/delta | logistic_regression | 0.5040 | 0.5217 | 0.9216 | 0.3061 |
| catboost_try | pre_toss/full | catboost_tuned | 0.5207 | 0.5057 | 0.7029 | 0.2545 |
| catboost_try | pre_toss/full | catboost_tuned_isotonic | 0.5173 | 0.5126 | 1.1377 | 0.2885 |
| catboost_try | pre_toss/full | catboost_tuned_platt | 0.5195 | 0.5057 | 0.7192 | 0.2611 |
| catboost_try | pre_toss/full | logistic_regression | 0.5094 | 0.5351 | 1.0856 | 0.3379 |
| xgboost_try | pre_toss/stacked_xgboost__catboost_best | stacked_ensemble | 0.4920 | 0.5083 | 0.7128 | 0.2594 |
| xgboost_try | pre_toss/weighted_xgboost_full__catboost_top60 | weighted_ensemble__xgb_full__cat_top60 | 0.5031 | 0.5347 | 0.6979 | 0.2524 |
| xgboost_try | pre_toss/xgboost_delta | xgboost_tuned | 0.4892 | 0.5218 | 0.7186 | 0.2611 |
| xgboost_try | pre_toss/xgboost_delta | xgboost_tuned_isotonic | 0.5085 | 0.5029 | 1.1388 | 0.2933 |
| xgboost_try | pre_toss/xgboost_delta | xgboost_tuned_platt | 0.5204 | 0.5190 | 0.7196 | 0.2617 |
| xgboost_try | pre_toss/xgboost_full | xgboost_tuned | 0.5193 | 0.5453 | 0.6974 | 0.2520 |
| xgboost_try | pre_toss/xgboost_full | xgboost_tuned_isotonic | 0.5419 | 0.5340 | 0.9577 | 0.2784 |
| xgboost_try | pre_toss/xgboost_full | xgboost_tuned_platt | 0.5121 | 0.5453 | 0.7059 | 0.2557 |
| xgboost_try | pre_toss/xgboost_top60_full | xgboost_tuned | 0.5107 | 0.5433 | 0.6984 | 0.2525 |
| xgboost_try | pre_toss/xgboost_top60_full | xgboost_tuned_isotonic | 0.5330 | 0.5352 | 1.1097 | 0.2793 |
| xgboost_try | pre_toss/xgboost_top60_full | xgboost_tuned_platt | 0.5127 | 0.5433 | 0.7089 | 0.2569 |
| recency_try | pre_toss/catboost_top60_recency_h3 | catboost_tuned | 0.5098 | 0.5202 | 0.7094 | 0.2574 |
| recency_try | pre_toss/catboost_top60_recency_h3 | catboost_tuned_platt | 0.5008 | 0.5202 | 0.7174 | 0.2606 |
| recency_try | pre_toss/catboost_top60_recency_h3 | logistic_regression | 0.4888 | 0.5322 | 0.9373 | 0.3178 |
| recency_try | pre_toss/weighted_xgboost_h3__catboost_top60 | weighted_ensemble__xgb_h3__cat_top60 | 0.5286 | 0.5400 | 0.6998 | 0.2531 |
| recency_try | pre_toss/xgboost_full_recency_h2 | xgboost_tuned | 0.4958 | 0.5300 | 0.7019 | 0.2540 |
| recency_try | pre_toss/xgboost_full_recency_h2 | xgboost_tuned_platt | 0.5231 | 0.5300 | 0.7063 | 0.2558 |
| recency_try | pre_toss/xgboost_full_recency_h3 | xgboost_tuned | 0.5350 | 0.5450 | 0.7036 | 0.2546 |
| recency_try | pre_toss/xgboost_full_recency_h3 | xgboost_tuned_platt | 0.5304 | 0.5189 | 0.7068 | 0.2557 |
| final_try | pre_toss/xgboost_full_tuned_a | xgboost_tuned | 0.5095 | 0.5244 | 0.7071 | 0.2565 |
| final_try | pre_toss/xgboost_full_tuned_a | xgboost_tuned_platt | 0.5083 | 0.5244 | 0.7210 | 0.2620 |
| final_try | pre_toss/xgboost_full_tuned_b | xgboost_tuned | 0.5225 | 0.5214 | 0.7065 | 0.2562 |
| final_try | pre_toss/xgboost_full_tuned_b | xgboost_tuned_platt | 0.5084 | 0.4977 | 0.7122 | 0.2587 |

## Data sources

- `current` → `/Users/harsh/Developer/ipl-trader/model/artifacts`
- `pruned` → `/Users/harsh/Developer/ipl-trader/model/artifacts_pruned`
- `catboost_try` → `/Users/harsh/Developer/ipl-trader/model/experiments/first-real-suite/artifacts`
- `xgboost_try` → `/Users/harsh/Developer/ipl-trader/model/experiments/xgboost-first-pass/artifacts`
- `recency_try` → `/Users/harsh/Developer/ipl-trader/model/experiments/recency-second-pass/artifacts`
- `final_try` → `/Users/harsh/Developer/ipl-trader/model/experiments/final-tuning-pass/artifacts`
