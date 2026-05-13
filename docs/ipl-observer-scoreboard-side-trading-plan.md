# IPL Observer Scoreboard-side Trading Plan

## Purpose

This document captures the planned IPL observer trading strategy for later implementation. The strategy watches every legal ball from 11.0 to 13.0 overs in the chase and enters the first usable scoreboard-side signal.

The main design choice is to trade the side supported by the live scoreboard, not simply the market favourite. That side may be the chasing team, the defending team, or occasionally a market underdog when the live match state disagrees with market pricing.

This is a strategy specification, not an implementation runbook. Live execution safety, credentials, duplicate handling, reconciliation, and incident response remain governed by `docs/polymarket-11-over-trading-runbook.md`.

## Scope

Applies to IPL chase innings only.

- Start scanning at 66 legal balls completed in the chase, which is 11.0 overs.
- Stop scanning at 78 legal balls completed in the chase, which is 13.0 overs.
- Evaluate after every ball and after any relevant odds update inside the window.
- Enter at most once per match.
- Hold any entered position to settlement.
- If no usable signal appears by 13.0 overs, record `NO TRADE`.

## Core idea

The observer should not ask only, "Who is favourite?"

It should ask, "Which side does the scoreboard support?"

Then it should buy that side only if the price is still acceptable.

This means the strategy can buy:

1. The chasing team, if the chase is genuinely comfortable.
2. The defending team, if the chase is genuinely under pressure.
3. A market underdog, if the scoreboard says the market is wrong.

## Ball window

```text
START_BALL = 66  # 11.0 overs in chase
END_BALL   = 78  # 13.0 overs in chase
```

For each live ball or odds update from `START_BALL` to `END_BALL`:

```text
overs_elapsed = legal_balls_completed / 6
balls_left = 120 - legal_balls_completed

target = first_innings_score + 1
runs_needed = target - chasing_score

CRR = chasing_score / overs_elapsed
RRR = runs_needed * 6 / balls_left
```

## Entry rules

The entry rules are the primary gate. Strength score and price should influence sizing, not replace these conditions.

### Chasing-side buy signal

Buy the chasing team if all conditions are true:

```text
RRR <= 11
wickets_lost <= 3
CRR >= RRR
chasing_team_price <= 0.95
```

This is deliberately looser than an older 11-over rule using `RRR <= 10`. When scanning ball-by-ball through 13 overs, a chase can still be strong with `RRR` between 10 and 11 if both of these are true:

- `CRR >= RRR`
- `wickets_lost <= 3`

Those cases produced some of the best value entries in the updated sheet.

### Defending-side buy signal

Buy the defending team if all conditions are true:

```text
CRR < RRR
RRR >= 12
wickets_lost >=4
(wickets_lost >= 5 OR RRR >= 13)
defending_team_price <= 0.95
```

This is the tightened defending rule from the updated sheet. The older "4 wickets down" condition was too loose. Four wickets down is not enough unless the required rate is also seriously high.

## Exact programmable rule

```text
START_BALL = 66  # 11.0 overs in chase
END_BALL   = 78  # 13.0 overs in chase

for each live ball/update from START_BALL to END_BALL:
    overs_elapsed = legal_balls_completed / 6
    balls_left = 120 - legal_balls_completed

    target = first_innings_score + 1
    runs_needed = target - chasing_score

    CRR = chasing_score / overs_elapsed
    RRR = runs_needed * 6 / balls_left

    if (
        RRR <= 11
        and wickets_lost <= 3
        and CRR >= RRR
        and chasing_team_price <= 0.95
    ):
        BUY chasing_team
        STOP scanning this match

    elif (
        CRR < RRR
        and RRR >= 12
        and wickets_lost >=4
        and (wickets_lost >= 5 or RRR >= 13)
        and defending_team_price <= 0.95
    ):
        BUY defending_team
        STOP scanning this match

    else:
        continue watching

if no signal by 13.0 overs:
    NO TRADE
```

## Backtest results from the updated sheet

| Strategy                                                    | Trades | Wins | Losses | PnL, $100 flat stake |    ROI |
| ----------------------------------------------------------- | -----: | ---: | -----: | -------------------: | -----: |
| Ball-by-ball scoreboard-side, cap <= 95c                    |     28 |   28 |      0 |              +$1,486 | +53.1% |
| Same rule, cap <= 90c                                       |     18 |   18 |      0 |              +$1,411 | +78.4% |
| Same rule, cap <= 85c                                       |     15 |   15 |      0 |              +$1,390 | +92.6% |
| Conservative: only buy if also market favourite, cap <= 95c |     23 |   23 |      0 |                +$479 | +20.8% |

The best balance is the `<= 95c` version, with stake sizing based on price. The `<= 90c` version has much better ROI but fewer trades.

## Why scoreboard-side is preferred

The ball-by-ball strategy found value on both sides of the match:

| Type                    | Trades | Wins |   PnL |
| ----------------------- | -----: | ---: | ----: |
| Buying chasing team     |     18 |   18 | +$856 |
| Buying defending team   |     10 |   10 | +$630 |
| Buying market favourite |     23 |   23 | +$516 |
| Buying market underdog  |      5 |    5 | +$970 |

The biggest edge came from the five underdog buys where the market favourite disagreed with the scoreboard. For that reason, this should be programmed as a scoreboard-side signal bot, not a buy-favourite bot.

## Price and stake sizing

Do not treat all signals equally. Use price to scale exposure.

| Entry price            | Signal quality              | Suggested sizing        |
| ---------------------- | --------------------------- | ----------------------- |
| `<= 0.70`              | Excellent value             | Full stake              |
| `> 0.70` and `<= 0.85` | Strong                      | Full or normal stake    |
| `> 0.85` and `<= 0.90` | Good but less upside        | Normal or reduced stake |
| `> 0.90` and `<= 0.95` | High confidence, low upside | Small stake             |
| `> 0.95`               | Too expensive               | Skip or tiny stake      |

Recommended bankroll sizing:

```text
if price <= 0.85:
    stake 20-30% bankroll
elif price <= 0.90:
    stake 15-20% bankroll
elif price <= 0.95:
    stake 5-10% bankroll
else:
    skip
```

Recommended default:

- Use 20% bankroll for price `<= 0.90`.
- Use 5-10% bankroll for price `> 0.90` and `<= 0.95`.
- Skip above `0.95`.

## Strength score

The dashboard can show a 0-100 strength score. Calculate it separately for chasing and defending signals.

The entry rules remain the main trade gate. Strength score should mostly drive position sizing and operator display, not decide whether a signal exists.

### Chasing strength

```text
rate_edge = CRR - RRR
wicket_edge = 3 - wickets_lost
rrr_cushion = 11 - RRR
price_bonus = max(0, 0.95 - chasing_team_price) * 20

strength = 50 \
         + 7 * rate_edge \
         + 6 * wicket_edge \
         + 3 * rrr_cushion \
         + price_bonus

strength = clamp(strength, 0, 100)
```

### Defending strength

```text
rate_edge = RRR - CRR
wicket_edge = wickets_lost - 4
rrr_pressure = RRR - 12
price_bonus = max(0, 0.95 - defending_team_price) * 20

strength = 50 \
         + 7 * rate_edge \
         + 6 * wicket_edge \
         + 3 * rrr_pressure \
         + price_bonus

strength = clamp(strength, 0, 100)
```

### Strength labels

| Strength | Label       | Action                           |
| -------: | ----------- | -------------------------------- |
|     0-59 | Weak        | No trade                         |
|    60-69 | Acceptable  | Trade only if price is very good |
|    70-84 | Strong      | Normal signal                    |
|   85-100 | Very strong | Highest-confidence signal        |

## Trade execution logic

Use this order of operations:

```text
if match already traded:
    do nothing

if legal_balls < 66:
    wait

if legal_balls > 78:
    no trade

if signal appears:
    enter immediately
    mark match as traded

after entry:
    hold to settlement
```

Operational rules:

- Do not enter multiple times in one match.
- Do not wait for a better signal after one already appears, unless price is above the cap.
- If a signal exists but price is above `0.95`, do not enter.
- If price later comes under `0.95` while conditions still hold and the innings remains inside the window, enter then.

## Final strategy card

Window:

```text
Watch every ball from 11.0 to 13.0 overs of the chase.
```

Buy chasing team if:

```text
RRR <= 11
wickets_lost <= 3
CRR >= RRR
chasing_price <= 0.95
```

Buy defending team if:

```text
CRR < RRR
RRR >= 12
(wickets_lost >= 5 OR RRR >= 13)
defending_price <= 0.95
```

No trade if:

- No signal appears by 13.0 overs.
- Price is above `0.95` and never comes back under the cap while conditions still hold.
- The match has already been traded.
- There is a tie, super-over, reduced-data issue, or other data integrity problem.

## Recommended implementation modes

### Mode 1: Value mode

Use price `<= 0.90` only.

Backtest result:

- 18 trades
- 18 wins
- +$1,411 PnL
- +78.4% ROI

Use this mode when bankroll protection matters more than trade volume.

### Mode 2: Volume mode

Use price `<= 0.95`.

Backtest result:

- 28 trades
- 28 wins
- +$1,486 PnL
- +53.1% ROI

Use this mode when more action is preferred, but reduce stake above `0.90`.

## Implementation notes for later work

When implementing this plan in the observer/trading stack:

1. Treat the rule as a new strategy identity or recipe version, not a silent change to the existing 11-over path.
2. Persist a one-shot trade intent so duplicate observer updates cannot create multiple entries for the same match.
3. Surface signal side, price cap, strength score, and reason fields on the dashboard.
4. Keep the live executor in dry-run until the rule has completed a full rollout checklist.
5. Reconcile this strategy with the safety contract in `docs/polymarket-11-over-trading-runbook.md` before enabling live trading.
