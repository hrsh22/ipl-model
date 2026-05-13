import { sql } from "drizzle-orm"
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

const timestampColumns = {
  withTimezone: true,
  mode: "date",
} as const

// Observer tables (existing)
export const observerFixtures = pgTable("observer_fixtures", {
  id: text("id").primaryKey(),
  opticOddsGameId: text("optic_odds_game_id").notNull(),
  sport: text("sport").notNull(),
  league: text("league").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeTeamId: text("home_team_id"),
  awayTeamId: text("away_team_id"),
  startTime: timestamp("start_time", timestampColumns).notNull(),
  status: text("status").notNull(),
  isLive: boolean("is_live").notNull(),
  venueName: text("venue_name"),
  venueLocation: text("venue_location"),
  polymarketEventSlug: text("polymarket_event_slug"),
  polymarketMarketSlug: text("polymarket_market_slug"),
  polymarketConditionId: text("polymarket_condition_id"),
  homeTokenId: text("home_token_id"),
  awayTokenId: text("away_token_id"),
  lastScore: text("last_score"),
  lastPeriod: text("last_period"),
  lastResultPayload: jsonb("last_result_payload"),
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", timestampColumns).defaultNow().notNull(),
})

export const observerOdds = pgTable("observer_odds", {
  id: text("id").primaryKey(),
  fixtureId: text("fixture_id")
    .notNull()
    .references(() => observerFixtures.id),
  sportsbookId: text("sportsbook_id").notNull(),
  sportsbook: text("sportsbook").notNull(),
  marketId: text("market_id").notNull(),
  market: text("market").notNull(),
  selection: text("selection").notNull(),
  normalizedSelection: text("normalized_selection").notNull(),
  priceProbability: doublePrecision("price_probability").notNull(),
  isMain: boolean("is_main").notNull(),
  isLive: boolean("is_live").notNull(),
  isLocked: boolean("is_locked").notNull(),
  maxStake: doublePrecision("max_stake"),
  oddsTimestamp: timestamp("odds_timestamp", timestampColumns).notNull(),
  sourceIds: jsonb("source_ids"),
  orderBook: jsonb("order_book"),
  deepLink: jsonb("deep_link"),
  updatedAt: timestamp("updated_at", timestampColumns).defaultNow().notNull(),
})

export const observerSignals = pgTable("observer_signals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fixtureId: text("fixture_id")
    .notNull()
    .references(() => observerFixtures.id),
  marketSlug: text("market_slug"),
  selection: text("selection").notNull(),
  referenceSource: text("reference_source").notNull(),
  referenceProbability: doublePrecision("reference_probability").notNull(),
  referenceTimestamp: timestamp("reference_timestamp", timestampColumns).notNull(),
  polymarketPrice: doublePrecision("polymarket_price").notNull(),
  polymarketBestLevel: doublePrecision("polymarket_best_level"),
  polymarketTimestamp: timestamp("polymarket_timestamp", timestampColumns).notNull(),
  edgeToPriceBps: integer("edge_to_price_bps").notNull(),
  edgeToBestLevelBps: integer("edge_to_best_level_bps"),
  details: jsonb("details").notNull(),
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
})

export const observerLiveModelSnapshots = pgTable("observer_live_model_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fixtureId: text("fixture_id")
    .notNull()
    .references(() => observerFixtures.id),
  sourceEvent: text("source_event").notNull(),
  modelVersion: text("model_version").notNull(),
  innings: integer("innings"),
  battingTeam: text("batting_team"),
  bowlingTeam: text("bowling_team"),
  scoreRuns: integer("score_runs"),
  scoreWickets: integer("score_wickets"),
  overs: doublePrecision("overs"),
  balls: integer("balls"),
  targetRuns: integer("target_runs"),
  expectedRunsNow: doublePrecision("expected_runs_now"),
  expectedWicketsNow: doublePrecision("expected_wickets_now"),
  runsDelta: doublePrecision("runs_delta"),
  wicketsDelta: doublePrecision("wickets_delta"),
  projectedScore: doublePrecision("projected_score"),
  homeModelProbability: doublePrecision("home_model_probability"),
  awayModelProbability: doublePrecision("away_model_probability"),
  homePolymarketProbability: doublePrecision("home_polymarket_probability"),
  awayPolymarketProbability: doublePrecision("away_polymarket_probability"),
  homeReferenceProbability: doublePrecision("home_reference_probability"),
  awayReferenceProbability: doublePrecision("away_reference_probability"),
  edgeHomeVsPolymarketBps: integer("edge_home_vs_polymarket_bps"),
  edgeAwayVsPolymarketBps: integer("edge_away_vs_polymarket_bps"),
  confidence: text("confidence").notNull(),
  details: jsonb("details").notNull(),
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
})

export const observerLiveModelSignals = pgTable("observer_live_model_signals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fixtureId: text("fixture_id")
    .notNull()
    .references(() => observerFixtures.id),
  snapshotId: integer("snapshot_id").references(() => observerLiveModelSnapshots.id),
  selection: text("selection").notNull(),
  modelProbability: doublePrecision("model_probability").notNull(),
  polymarketProbability: doublePrecision("polymarket_probability"),
  referenceProbability: doublePrecision("reference_probability"),
  edgeVsPolymarketBps: integer("edge_vs_polymarket_bps"),
  reason: text("reason").notNull(),
  confidence: text("confidence").notNull(),
  scoreContext: jsonb("score_context").notNull(),
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
})

export const observerCheckpoints = pgTable("observer_checkpoints", {
  streamKey: text("stream_key").primaryKey(),
  lastEntryId: text("last_entry_id").notNull(),
  updatedAt: timestamp("updated_at", timestampColumns).defaultNow().notNull(),
})

// Trading persistence tables
export const tradingRuntimeFlags = pgTable("trading_runtime_flags", {
  flagKey: text("flag_key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  reason: text("reason"),
  updatedBy: text("updated_by"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", timestampColumns).defaultNow().notNull(),
})

export const tradingRecipes = pgTable("trading_recipes", {
  recipeKey: text("recipe_key").primaryKey(),
  strategyKey: text("strategy_key").notNull(),
  recipeVersion: text("recipe_version").notNull(),
  windowKey: text("window_key").notNull(),
  fixtureId: text("fixture_id")
    .notNull()
    .references(() => observerFixtures.id),
  marketId: text("market_id").notNull(),
  conditionId: text("condition_id").notNull(),
  tokenId: text("token_id").notNull(),
  side: text("side").notNull(),
  orderStyle: text("order_style").notNull(),
  maxPrice: doublePrecision("max_price").notNull(),
  size: doublePrecision("size").notNull(),
  expiryTime: timestamp("expiry_time", timestampColumns).notNull(),
  context: jsonb("context"),
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", timestampColumns).defaultNow().notNull(),
})

export const tradingTradeIntents = pgTable(
  "trading_trade_intents",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    intentKey: text("intent_key").notNull(),
    recipeKey: text("recipe_key")
      .notNull()
      .references(() => tradingRecipes.recipeKey),
    strategyKey: text("strategy_key").notNull(),
    recipeVersion: text("recipe_version").notNull(),
    windowKey: text("window_key").notNull(),
    fixtureId: text("fixture_id")
      .notNull()
      .references(() => observerFixtures.id),
    marketId: text("market_id").notNull(),
    conditionId: text("condition_id").notNull(),
    tokenId: text("token_id").notNull(),
    side: text("side").notNull(),
    status: text("status").notNull(),
    claimCount: integer("claim_count").default(0).notNull(),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", timestampColumns),
    claimExpiresAt: timestamp("claim_expires_at", timestampColumns),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    context: jsonb("context"),
    createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", timestampColumns).defaultNow().notNull(),
  },
  (table) => ({
    intentKeyIdx: uniqueIndex("trading_trade_intents_intent_key_idx").on(table.intentKey),
    fixtureScopeIdx: uniqueIndex("trading_trade_intents_fixture_scope_idx").on(
      table.strategyKey,
      table.windowKey,
      table.fixtureId,
      table.marketId,
      table.side,
    ).where(sql`${table.strategyKey} = 'scoreboard-side-11-13'`),
    claimQueueIdx: index("trading_trade_intents_claim_queue_idx").on(
      table.status,
      table.claimExpiresAt,
      table.createdAt,
    ),
  }),
)

export const tradingExecutionEvents = pgTable(
  "trading_execution_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    intentId: integer("intent_id")
      .notNull()
      .references(() => tradingTradeIntents.id),
    eventType: text("event_type").notNull(),
    eventTime: timestamp("event_time", timestampColumns).notNull(),
    processedAt: timestamp("processed_at", timestampColumns).notNull(),
    executorId: text("executor_id"),
    details: jsonb("details").notNull(),
    createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
  },
  (table) => ({
    intentEventIdx: index("trading_execution_events_intent_event_idx").on(
      table.intentId,
      table.eventTime,
    ),
  }),
)

export const tradingExposureLedger = pgTable(
  "trading_exposure_ledger",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    intentId: integer("intent_id").references(() => tradingTradeIntents.id),
    fixtureId: text("fixture_id")
      .notNull()
      .references(() => observerFixtures.id),
    marketId: text("market_id").notNull(),
    tokenId: text("token_id").notNull(),
    side: text("side").notNull(),
    entryType: text("entry_type").notNull(),
    quantity: doublePrecision("quantity"),
    notionalUsd: doublePrecision("notional_usd").notNull(),
    eventTime: timestamp("event_time", timestampColumns).notNull(),
    processedAt: timestamp("processed_at", timestampColumns).notNull(),
    details: jsonb("details").notNull(),
    createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
  },
  (table) => ({
    fixtureLedgerIdx: index("trading_exposure_ledger_fixture_idx").on(
      table.fixtureId,
      table.eventTime,
    ),
  }),
)

export const tradingReconciliationCheckpoints = pgTable("trading_reconciliation_checkpoints", {
  checkpointKey: text("checkpoint_key").primaryKey(),
  lastCursor: text("last_cursor"),
  lastReconciledAt: timestamp("last_reconciled_at", timestampColumns),
  details: jsonb("details"),
  updatedAt: timestamp("updated_at", timestampColumns).defaultNow().notNull(),
})

// IPL-specific tables (Phase 1)
export const iplMatches = pgTable("ipl_matches", {
  id: text("id").primaryKey(), // match_id from Cricsheet
  season: integer("season").notNull(),
  matchDate: timestamp("match_date", timestampColumns).notNull(),
  venue: text("venue").notNull(),
  city: text("city"),
  team1: text("team1").notNull(),
  team2: text("team2").notNull(),
  tossWinner: text("toss_winner"),
  tossDecision: text("toss_decision"), // bat or field
  winner: text("winner"),
  winnerRuns: integer("winner_runs"),
  winnerWickets: integer("winner_wickets"),
  team1Runs: integer("team1_runs"),
  team1Wickets: integer("team1_wickets"),
  team2Runs: integer("team2_runs"),
  team2Wickets: integer("team2_wickets"),
  playerOfMatch: text("player_of_match"),
  matchMetadata: jsonb("match_metadata"), // Store raw Cricsheet metadata
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
})

export const iplTeams = pgTable("ipl_teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  shortName: text("short_name"),
  city: text("city"),
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
})

export const iplPlayers = pgTable("ipl_players", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  team: text("team").notNull(),
  role: text("role"), // batsman, bowler, all-rounder
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
})

export const iplFeatures = pgTable("ipl_features", {
  id: serial("id").primaryKey(),
  matchId: text("match_id")
    .notNull()
    .references(() => iplMatches.id),
  team: text("team").notNull(),
  opponent: text("opponent").notNull(),
  
  // Team form features
  teamFormEma: doublePrecision("team_form_ema"), // Exponential moving average of recent wins
  teamWinsLast5: integer("team_wins_last_5"),
  teamWinsLast10: integer("team_wins_last_10"),
  
  // Head-to-head
  h2hWins: integer("h2h_wins"),
  h2hLosses: integer("h2h_losses"),
  h2hWinRate: doublePrecision("h2h_win_rate"),
  
  // Venue
  venueWins: integer("venue_wins"),
  venueLosses: integer("venue_losses"),
  venueWinRate: doublePrecision("venue_win_rate"),
  
  // Toss impact
  tossBias: doublePrecision("toss_bias"), // Probability team wins if they win toss
  
  // Bookmaker odds (normalized)
  bookmakersOdds: doublePrecision("bookmakers_odds"),
  bookmakersImpliedProb: doublePrecision("bookmakers_implied_prob"),
  
  // Polymarket odds
  polymarketOdds: doublePrecision("polymarket_odds"),
  polymarketImpliedProb: doublePrecision("polymarket_implied_prob"),
  
  // Divergence
  klDivergence: doublePrecision("kl_divergence"), // KL divergence between bookmakers and Polymarket
  
  // Target
  matchResult: integer("match_result"), // 1 if team won, 0 if lost
  
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
})

export const iplPredictions = pgTable("ipl_predictions", {
  id: serial("id").primaryKey(),
  matchId: text("match_id")
    .notNull()
    .references(() => iplMatches.id),
  team: text("team").notNull(),
  opponent: text("opponent").notNull(),
  
  // Model predictions
  modelProbability: doublePrecision("model_probability").notNull(),
  modelConfidence: text("model_confidence"), // low, medium, high
  
  // Comparison
  bookmakersProb: doublePrecision("bookmakers_prob"),
  polymarketProb: doublePrecision("polymarket_prob"),
  
  // Edge calculation
  edgeVsBookmakers: doublePrecision("edge_vs_bookmakers"), // Model prob - Bookmakers prob
  edgeVsPolymarket: doublePrecision("edge_vs_polymarket"),
  
  // Actual result
  actualResult: integer("actual_result"), // 1 if team won, 0 if lost
  
  createdAt: timestamp("created_at", timestampColumns).defaultNow().notNull(),
})
