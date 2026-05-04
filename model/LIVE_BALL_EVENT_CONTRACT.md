# Experimental live ball-event contract

This contract is for the experimental live ball-by-ball model only. It must not
be treated as production predictor input until a separate promotion decision is
made.

## Isolation boundary

- Capture script: `model/capture_live_ball_events.py`
- Public-page ESPNcricinfo scraper: `model/scrape_espncricinfo_ball_events.py`
- Snapshot converter: `model/build_live_event_snapshots.py`
- Live payload builder: `model/build_live_payload_from_events.py`
- No-paid pipeline runner: `model/run_no_paid_ball_state_live.py`
- Default output directory: `model/experiments/ball-state/live-events/`
- Append-only journals:
  - `raw_provider_payloads.jsonl`
  - `normalized_ball_events.jsonl`
- Derived snapshot history:
  - `live_model_snapshots_from_events.json`
  - `live_model_snapshots_from_events.jsonl`
- Do not write these trial events into:
  - `model/final_models/`
  - `model/predict_fixture.py`
  - `model/data/live/`

`model/experiments/` is ignored by git, so provider payload trials remain local
experiment artifacts.

## Preferred live source shape

Arrange a provider that can send one authoritative record per delivery. The
minimum useful fields are:

| Field | Why it matters |
| --- | --- |
| `fixture_id` / `match_id` | Joins live events to observer fixtures and later historical rows. |
| `innings` | Separates first-innings projection from chase-state modeling. |
| `over`, `ball`, `delivery_sequence_key` | Defines canonical event order and handles corrections/replays. |
| `event_timestamp` | Lets us audit feed latency and ordering. |
| `batting_team`, `bowling_team` | Required live model state. |
| `striker`, `non_striker`, `bowler` | Enables player-form, matchup, and fatigue features. |
| `runs_bat`, `extras`, `total_runs`, `extra_type` | Reconstructs legal-ball score progression and run components. |
| `is_legal_delivery` | Keeps legal-ball count correct for wides/no-balls. |
| `is_wicket`, `wicket_type`, `dismissed_player`, `fielder` | Reconstructs wicket pressure and wicket trajectory windows. |
| `score_after`, `wickets_after` | Provider-side checksum for reconstructed state. |
| `commentary` | Useful for auditing provider quirks and corrections. |

Public docs checked during planning suggest OpticOdds exposes match/result
snapshots rather than a documented cricket delivery log. Roanuz and SportMonks
are better public fits for true ball-by-ball cricket data; Cricsheet remains a
strong historical, non-live reference shape.

## Append-only rule during a match

During a live match, append every provider payload and every normalized event.
Do not overwrite prior events. Corrections should be appended as new rows with a
stable `delivery_sequence_key` or provider event id so downstream builders can
deduplicate deterministically.

The experimental model should read a resolved view from the journal, not mutate
the journal itself.

## Experimental scoring workflow

1. Capture provider payloads into append-only journals:

   ```bash
   pnpm model:capture:ball-events -- --provider canonical --input-json provider-payload.json
   ```

2. Convert normalized events into live-model snapshot history:

   ```bash
   pnpm model:events:to-snapshots
   ```

3. Use that derived snapshot history with the existing parity/shadow tools when
   testing trajectory-capable candidates:

   ```bash
   pnpm model:validate:ball-state-live -- --feature-mode live_compatible_selected_trajectory --json live-model-payload.json --snapshots-json model/experiments/ball-state/live-events/live_model_snapshots_from_events.json
   pnpm model:shadow:ball-state-live -- --input-json live-model-payload.json --snapshots-json model/experiments/ball-state/live-events/live_model_snapshots_from_events.json
   ```

The converter emits `balls=0` baseline snapshots per fixture/innings by default.
That baseline is important because the trajectory builder computes each ball from
the delta between consecutive snapshots.

Wides/no-balls are preserved as score-only snapshots with the same legal-ball
count. That keeps legal-ball trajectory deltas aligned with the training matrix:
illegal-delivery runs update the cumulative score before the next legal ball,
but do not get folded into that legal ball's `runs_last_ball` feature.

For a one-command no-paid validation loop, run:

```bash
pnpm model:live:no-paid -- \
  --input-html saved-espn-page.html \
  --context-json fixture-context.json
```

Use `--shadow` on the same command to also run the selected experimental shadow
scorer after feature parity validation.

## Free/public-page scraping option

If paid APIs are off limits, the lowest-risk public-page route currently explored
is ESPNcricinfo match/commentary pages. The experiment scraper parses the
page-embedded `script#__NEXT_DATA__` JSON and maps `content.comments[]` rows into
the same `live-ball-event-v0` journal:

```bash
pnpm model:scrape:espn-ball-events -- --url "https://www.espncricinfo.com/.../ball-by-ball-commentary"
```

If direct script fetch is blocked but the page is publicly visible in a browser,
save the page HTML and parse it offline instead:

```bash
pnpm model:scrape:espn-ball-events -- --input-html saved-espn-page.html
```

Repeat that capture during the match, then convert the accumulated journal:

```bash
pnpm model:events:to-snapshots
```

For repeatable local validation, the repository includes a small ESPN bootstrap
fixture at `model/espncricinfo_next_data_sample.html` and matching context at
`model/no_paid_live_context_sample.json`.

That fixture can be tested with:

```bash
pnpm model:live:no-paid -- \
  --input-html model/espncricinfo_next_data_sample.html \
  --output-dir model/experiments/ball-state/live-events-sample-test \
  --context-json model/no_paid_live_context_sample.json
```

For multiple saved captures, place `.html` files in a folder and run:

```bash
pnpm model:live:no-paid -- \
  --input-html-dir saved-espn-captures/ \
  --context-json fixture-context.json \
  --shadow
```

## Live match checklist for future sessions

When an IPL match is live, check these items before trusting experimental
ball-state outputs:

1. **Context file is correct**
   - `fixture_id` matches the ESPN match/page id.
   - `start_time`, `venue_name`, `venue_location`, `home_team`, and `away_team`
     are filled.
   - `batting_team` / `bowling_team` match the current innings.
   - For innings 2, `target_runs` is present or first-innings snapshots are
     available so the target can be inferred.

2. **Capture cadence is frequent enough**
   - Save/fetch ESPN commentary HTML repeatedly during play, not just once late.
   - Keep captures in a folder such as `saved-espn-captures/` and run the
     no-paid pipeline with `--input-html-dir`.
   - If ESPN direct fetch returns 403, use saved public HTML via `--input-html`
     or the saved-capture folder. Do not bypass access controls.

3. **Event journal quality**
   - `normalized_ball_events.jsonl` should grow as the match progresses.
   - `delivery_sequence_key` values should be stable and deduplicated by
     fixture/innings/delivery.
   - Check that `is_legal_delivery`, `total_runs`, `score_after`, and
     `wickets_after` match the visible scorecard/commentary.
    - Confirm wides/no-balls do not increment legal-ball snapshots.
    - Confirm wides/no-balls still appear as score-only snapshots when they change
      the visible score.

4. **Snapshot coverage**
   - `live_model_snapshots_from_events.json` should include a `balls=0` baseline
     plus contiguous legal-ball snapshots for the current innings window.
   - In `live_feature_parity_report.json`, inspect:
     - `missing_core_features` should be empty.
     - `missing_event_trajectory_features` should be empty for selected
       trajectory mode.
     - `snapshot_exact_coverage_balls` should be at least the size of the recent
       window being used; 6+ balls is the minimum useful signal, 24+ is better.
     - `ready_for_inference` should be `true`.

5. **Shadow scoring sanity**
   - With `--shadow`, inspect `shadow-run/summary.json`.
   - First innings should score the four regression targets and skip
     `chase_success`.
   - Second innings should also score `chase_success` if `target_runs` and core
     chase fields are available.
   - Any rejection should explain missing core/trajectory fields rather than
     crashing.

6. **Innings transition handling**
   - When innings changes, update context `batting_team`, `bowling_team`, and
     `innings` if needed.
   - For innings 2, verify target = first-innings final score + 1.
   - Keep first-innings and second-innings captures in the same event journal so
     target inference and audit remain possible.

7. **Do not promote during live testing**
   - Keep outputs under `model/experiments/ball-state/live-events/`.
   - Do not write scraped live events into `model/data/live/` or staged training
     data during the match.
   - Do not touch `model/final_models/` or `model/predict_fixture.py`.

Caveats:

- Use this politely and respect site terms/robots.
- The scraper does not log in, call paid APIs, or bypass access controls.
- The embedded ESPN commentary payload may contain only a recent/live window,
  not the full innings replay. For live tracking, poll and append events during
  the match rather than expecting one late fetch to recover everything.
- Cricbuzz exposes useful JSON technically, but its robots policy is restrictive;
  do not target it without explicit permission.

## How live data should join existing data later

While the match is live, these events are **inference-time context only**. They
should improve current ball-state features such as recent-run windows,
current-over state, wickets, partnership, and player matchup state.

After the match is completed and audited:

1. Keep the raw provider journal as evidence.
2. Build a resolved delivery table by sorting/deduplicating on
   `fixture_id + innings + delivery_sequence_key`.
3. Reconcile final score/wickets against an authoritative completed-score source.
4. Only then promote the match into historical training/staging data.
5. Regenerate derived features from the historical tables, so future rows see
   this match only as prior history.

This separation avoids leakage: live events can affect the current match only as
state observed up to that ball, and completed matches affect future matches only
after they become historical records.
