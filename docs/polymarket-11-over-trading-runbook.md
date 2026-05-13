# Polymarket Scoreboard-side Trading Runbook

## Purpose

This runbook covers operations, secrets, dry-run rollout, reconciliation, and incident response for the active scoreboard-side Polymarket trading path. It applies to durable trade intents created from the observer live model and submitted by the trading executor.

The current strategy key is `scoreboard-side-11-13`. Historical notes may still refer to the earlier 11-over or favourite-based framing, but operators should not treat a legacy `eleven-over` runtime as restorable working behavior.

Dry-run is default. In dry-run, the executor records the would-submit order, execution events, and exposure ledger entries, but it must not call the live Polymarket submit path or live `createOrder`.

## Active strategy and modes

The active observer strategy trades the side supported by the live scoreboard between 11.0 and 13.0 overs in the chase, not simply the market favourite. That supported side may flip between the home BUY token and away BUY token as live match state changes.

- Strategy key: `scoreboard-side-11-13`.
- Active default mode: `value90`, price cap `<=0.90`, allocation `0.20` of available pUSD balance.
- Selectable explicit mode: `volume95`, price cap `<=0.95`, allocation `0.10` of available pUSD balance, only when explicitly selected.
- Window key: `balls-66-78`, which covers the 11.0 through 13.0 chase window.

Before dry-run or live evaluation for a fixture/mode, seed both-token recipes: one home BUY token recipe and one away BUY token recipe for the same fixture, market, strategy key, recipe version, and window. The observer chooses the scoreboard-supported token at intent time, so seeding only the current favourite is insufficient.

## Safety contract

Live trading is controlled by deployment environment plus runtime readiness checks. It requires all of the following at the same time:

1. Environment gate `TRADING_LIVE_ENABLED=true`.
2. Polymarket credentials present: `POLYMARKET_PRIVATE_KEY` for signing and `POLY_BUILDER_CODE` for V2 builder attribution. The TypeScript CLOB V2 SDK creates or derives its internal L2 API credentials from the private key.
3. A valid trading recipe for the exact intent identity, seeded for both home BUY and away BUY tokens for the active fixture/mode.
4. Fresh match/book state and sufficient pUSD balance. The executor sizes each eligible order from current Polymarket pUSD balance using the selected recipe allocation: `0.20` for `value90` or `0.10` for explicitly selected `volume95`.

If any gate is missing, the trading adapter stays in dry-run and readiness returns dry-run blockers. Do not bypass this by creating a live client manually.

## One-shot duplicate policy

Each trade intent is keyed by strategy, recipe version, window key, fixture, market, token, and side. The repository uses that deterministic key to prevent exact duplicates.

For `scoreboard-side-11-13`, the operational one-shot policy is fixture-level: create at most one intent per fixture/market/side for the strategy and window, even if the scoreboard-supported side later flips to the opposite token or the operator changes `SCOREBOARD_SIDE_STRATEGY_MODE`. The fixture-level guard intentionally ignores token and recipe version for this duplicate check while preserving the token-scoped, versioned intent key for exact retry idempotency.

There is no automatic re-entry. A duplicate observer signal should return the existing intent, not create a second one. A partial fill, cancelled order, expired order, timeout, rate limit, duplicate order response, or WebSocket disconnect must not trigger an automatic top-up, replacement, or blind retry.

Before applying migrations that create or tighten the fixture-level unique index, run a duplicate-scope preflight for `scoreboard-side-11-13`. If any existing rows share the same strategy/window/fixture/market/side, retain the earliest canonical intent for audit and resolve later duplicates before rerunning `pnpm db:migrate`; the migration intentionally fails with a clear duplicate-scope error rather than silently choosing which historical trading intent to keep.

## Credential handling

Store credentials only in the secret manager or the runtime `.env` source used by the deployment. Never put real values in docs, tests, tickets, logs, screenshots, shell history, evidence files, or chat.

credential redaction is mandatory for every operator-facing view, evidence file, and incident note.

Required credential names:

1. `POLYMARKET_PRIVATE_KEY`
2. `POLY_BUILDER_CODE`

Do not configure CLOB API key/secret/passphrase env vars for this service. The SDK derives those internal L2 credentials from `POLYMARKET_PRIVATE_KEY`; the only builder-side value attached to orders is the public `bytes32` builder code.

Safe operator views may show whether each credential is present, but never the value. Do not paste auth headers, signed payloads, raw signatures, private keys, API keys, passphrases, account balances tied to a funded account, or funded account identifiers into logs or incident notes.

## Key rotation

Rotate keys when a credential may have leaked, when an operator leaves the rotation group, after vendor-side auth anomalies, or on the normal secrets calendar.

Rotation steps:

1. Disarm live trading by setting `TRADING_LIVE_ENABLED=false` and restarting the backend.
2. Keep the deployment env false if the incident may involve active submission risk.
3. Revoke old Polymarket CLOB credentials and private key access at the source.
4. Issue a new `POLYMARKET_PRIVATE_KEY` and confirm the approved `POLY_BUILDER_CODE` remains scoped to this app.
5. Restart the service so `POLYMARKET_PRIVATE_KEY` and `POLY_BUILDER_CODE` are read from the new secret set.
6. Confirm `/trading/status` shows credential presence only, not values.
7. Run in dry-run first, then re-enable `TRADING_LIVE_ENABLED=true` only after reconciliation is clean.

## Environment live-switch operation

There is no DB live switch. Operators control live submission with the deployment environment variable `TRADING_LIVE_ENABLED`; changing it requires a backend restart. The `/trading/controls/live` route reports that live mode is environment-controlled and does not mutate Postgres.

Daily start:

1. Confirm `/ready` is healthy.
2. Confirm `/trading/status` shows mode `dry-run` before any live change.
3. Confirm `TRADING_LIVE_ENABLED=true` only for an approved live window.
4. Confirm credential presence is OK: `POLYMARKET_PRIVATE_KEY` and `POLY_BUILDER_CODE` are present.
5. Confirm recipe validation is `valid` for the active `scoreboard-side-11-13` recipe pair: home BUY token and away BUY token for the fixture/mode.
6. Confirm the selected mode is intended: default `value90` with cap `<=0.90` and allocation `0.20`, or explicitly selected `volume95` with cap `<=0.95` and allocation `0.10`.
7. Confirm Polymarket pUSD balance is available; the executor uses the recipe allocation context against current balance for each eligible trade.
8. Restart the backend after setting `TRADING_LIVE_ENABLED=true` only after an approved live rollout decision.
9. Recheck `/trading/status` and confirm live readiness before allowing the executor to submit.

Daily stop:

1. Set `TRADING_LIVE_ENABLED=false` and restart the backend.
2. Confirm `/trading/status` returns dry-run mode or live readiness false.
3. Review `/trading/intents`, `/trading/events`, `/trading/exposure`, and `/trading/reconciliation/status`.

## Disarm triggers

Immediately set `TRADING_LIVE_ENABLED=false` and restart the backend for any of these conditions:

1. Bad fixture, team, market, condition, or token mapping.
2. Unexpected duplicate intent or duplicate order indication.
3. Ambiguous submit outcome that cannot be reconciled quickly.
4. Partial fill outside expected risk, stale book, or stale match state.
5. `polymarket:user-updates` disconnect with active submitted intents.
6. Failed credential self-test, auth failure, suspected credential exposure, or vendor account warning.
7. Exposure ledger mismatch, pUSD balance mismatch, or operator uncertainty.

For severe credential or mapping risk, also set `TRADING_LIVE_ENABLED=false` at runtime deployment level and restart in dry-run.

## Dry-run-first rollout checklist

Use this sequence for the first dry-run rollout, for any future promotion after code or model changes, and before any separate live trading decision. Do not claim live readiness from this checklist alone.

1. Start with `TRADING_LIVE_ENABLED=false`.
2. Run dry-run through the `scoreboard-side-11-13` 11.0 to 13.0 chase window and confirm the dry-run adapter path records would-submit state without live `createOrder` calls.
3. Confirm fixture-level one-shot behavior: at most one active-mode intent per fixture/market/side, even if supported side flips token.
4. Confirm both-token recipe seeding for the fixture/mode: home BUY token and away BUY token are present before observer evaluation.
5. Confirm the recipe identity matches the Polymarket market, condition, token, side, max price, allocation, and expiry. Order size is derived at execution time from current pUSD balance.
6. Confirm `/trading/status` shows credential presence only and remains dry-run unless `TRADING_LIVE_ENABLED=true` is deliberately enabled.
7. Confirm `/trading/reconciliation/status` can write and read the `polymarket:user-updates` checkpoint.
8. If a later live rollout is separately approved, set `TRADING_LIVE_ENABLED=true` for the deployment and restart only during the approved match window.
9. Watch `/trading/events` for `detected`, `eligible`, `approved`, `submitted`, and then a venue-derived state.
10. If anything is unclear, disarm first, then reconcile.

## Rollback and disabling

Rollback for this strategy means disabling `scoreboard-side-11-13` observer intent creation or setting the active scoreboard-side mode to a non-trading/disabled state if such a state is available. Keep `TRADING_LIVE_ENABLED=false` until the issue is understood.

After disabling, inspect `/trading/intents`, `/trading/events`, `/trading/exposure`, and `/trading/reconciliation/status` for any affected fixture/market/side. Do not claim that restoring a legacy `eleven-over` runtime path is a rollback option; use the current dry-run controls, fixture-level duplicate protection, and reconciliation process instead.

## Reconciliation rules

Reconciliation is authoritative after any ambiguous venue path. The executor uses `clientOrderId` equal to the intent key, user updates when connected, and REST fallback when user updates are unavailable or disconnected.

The checkpoint key is `polymarket:user-updates`. It stores the last cursor and details about the last reconciliation pass. Use `/trading/reconciliation/status` to confirm checkpoint presence and freshness.

Never blindly retry after timeout, duplicate order, rate limit, network error, or WebSocket disconnect. First reconcile by order id, duplicate order id, client order id, market id, and token id. If the order exists, update execution events and exposure from the venue state. If the order cannot be found, keep the intent pending reconciliation and keep live disarmed until an operator resolves the venue state.

## Incident response

### Bad mapping

Symptoms: recipe token does not match the scoreboard-supported home/away side, market slug points to the wrong match, condition id is wrong, fixture-level one-shot behavior is bypassed, or team mapping is uncertain.

Actions:

1. Set `TRADING_LIVE_ENABLED=false` and restart the backend.
2. Stop treating new `scoreboard-side-11-13` signals as tradable until the recipe or mapping is corrected.
3. Check `/trading/intents` and `/trading/events` for affected fixture, market, condition, token, and side.
4. Reconcile any submitted order before deciding on manual venue action.
5. Record the bad mapping and replacement recipe in the incident notes without credential values.

### Duplicate intent

Symptoms: repeated observer signal, same window, same market, same token, same side, or `INTENT_ALREADY_EXISTS`.

Actions:

1. Do not create a manual second intent.
2. Confirm the existing intent key and status in `/trading/intents`.
3. If a duplicate order response appears, reconcile using the duplicate order id and client order id.
4. Leave live disarmed if more than one live venue order exists for the same intent key.

### Ambiguous submit

Symptoms: submit timeout, network error, rate limit, duplicate order response, or no clear submit response.

Actions:

1. Set `TRADING_LIVE_ENABLED=false` and restart the backend.
2. Do not retry submit.
3. Use user updates if connected, otherwise REST fallback, to search by known order id, duplicate order id, `clientOrderId`, market id, and token id.
4. Update incident notes with order state, trade state, exposure ledger state, and whether the intent remains pending reconciliation.
5. Re-enable live only after `/trading/reconciliation/status` is fresh and the exposure ledger matches the venue state.

### Partial fill

Symptoms: venue state is partially filled, pending notional remains open, or exposure ledger shows both filled exposure and pending order entries.

Actions:

1. Do not auto top-up or replace the remaining size.
2. Confirm the current order and trades through reconciliation.
3. Confirm exposure ledger adjustments match filled and pending notional.
4. If the pending part should be cancelled, perform a manual operator decision outside automatic re-entry and record the reason.
5. Keep live disarmed if exposure cannot be matched to the venue.

### Credential compromise

Symptoms: credential pasted in an unsafe place, unexpected auth failure, vendor security alert, unknown order activity, or suspected private key exposure.

Actions:

1. Set `TRADING_LIVE_ENABLED=false` immediately and restart in dry-run if submit risk remains.
2. Confirm `/trading/status` reports dry-run mode before continuing.
3. Revoke and rotate `POLYMARKET_PRIVATE_KEY`; review and replace `POLY_BUILDER_CODE` only if the builder profile/code itself is compromised or no longer scoped to this app.
4. Review recent `/trading/events`, `/trading/exposure`, venue orders, and venue trades.
5. Remove leaked material from unsafe systems where possible, then record only redacted references in the incident notes.
6. Re-enable live only after rotation, reconciliation, and dry-run verification pass.

## Evidence expectations

For rollout verification, evidence should prove the runbook contains the required gates, exact names, fixture-level one-shot policy, both-token recipe seeding, dry-run adapter behavior, status dry-run blockers, incident coverage, rollback/disabling guidance, and secret safety checks. Evidence must not contain real credentials, auth headers, signed payloads, raw signatures, account identifiers, or funded account details.
