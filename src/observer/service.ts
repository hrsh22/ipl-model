import logger from "../logger.js"
import { config } from "../config.js"
import {
  getCheckpoint,
  getFixture,
  getLiveFixtureByTeams,
  insertSignal,
  listFixtureOdds,
  listFixtureSignals,
  listFixtures,
  listSignals,
  type ObserverFixtureRecord,
  upsertCheckpoint,
  upsertFixture,
  upsertOdd,
} from "./repository.js"

const OPTICODDS_BASE_URL = "https://api.opticodds.com/api/v3"
const POLYMARKET_GAMMA_BASE_URL = "https://gamma-api.polymarket.com"
const POLYMARKET_MARKET_WS_URL =
  "wss://ws-subscriptions-clob.polymarket.com/ws/market"

const IPL_LEAGUE_NAME = "India - IPL"
const MONEYLINE_MARKET = "Moneyline"
const CHECKPOINT_ODDS_STREAM = "opticodds:ipl:moneyline:odds"
const CHECKPOINT_RESULTS_STREAM = "opticodds:ipl:results"

const SIGNAL_THRESHOLD_BPS = 100
const ODDS_STALENESS_MS = 30_000
const FIXTURE_REFRESH_INTERVAL_MS = 120_000
const ACTIVE_FIXTURE_RECONCILIATION_INTERVAL_MS = 30_000
const POLYMARKET_PING_INTERVAL_MS = 10_000
const POLYMARKET_RECONNECT_DELAY_MS = 1_000
const POLYMARKET_CATALOG_TTL_MS = 120_000
const REFERENCE_OUTLIER_BPS = 400
const OPPORTUNITY_PERSISTENCE_MS = 5_000
const SPORTS_TAKER_FEE_RATE = 0.03
const MAPPING_LOOKAHEAD_MS = 24 * 60 * 60 * 1000
const ACTIVE_ODDS_LOOKAHEAD_MS = 90 * 60 * 1000
const MIN_EXECUTABLE_SHARES = 100
const MIN_EXECUTABLE_NOTIONAL_USDC = 25
const READY_MAX_FIXTURE_REFRESH_AGE_SECONDS = 180
const READY_MAX_STREAM_AGE_SECONDS = 45

const getOpticOddsHeaders = () => {
  if (!config.opticOddsApiKey) {
    throw new Error("OPTICODDS_API_KEY is required when OPTICODDS_ENABLED is true")
  }

  return { "X-Api-Key": config.opticOddsApiKey }
}

const OBSERVED_BOOKS = [
  "betfair_exchange",
  "1xbet",
  "parimatch_india_",
  "opticodds_ai",
  "polymarket",
] as const

const PRIMARY_REFERENCE_BOOK = "betfair_exchange"

const SUPPORT_REFERENCE_BOOK_WEIGHTS: Record<string, number> = {
  "1xbet": 3,
  parimatch_india_: 2,
  opticodds_ai: 1,
}

type JsonRecord = Record<string, unknown>
type DeepLink = Record<string, string | null | undefined>
type SourceIds = Record<string, string | number | null | undefined>
type OrderBookLevel = [number, number]

type OpticOddsCompetitor = {
  id: string
  name: string
}

type OpticOddsFixture = {
  id: string
  game_id: string
  start_date: string
  status: string
  is_live: boolean
  home_competitors?: OpticOddsCompetitor[]
  away_competitors?: OpticOddsCompetitor[]
  home_team_display: string
  away_team_display: string
  venue_name?: string | null
  venue_location?: string | null
  sport: {
    id: string
    name: string
  }
  league: {
    id: string
    name: string
  }
  result?: {
    scores?: {
      home?: { total?: number | null }
      away?: { total?: number | null }
    }
    in_play_data?: {
      period?: string | null
      clock?: string | null
    }
  }
}

type OpticOddsOdd = {
  id: string
  fixture_id: string
  sportsbook?: string
  sportsbook_id?: string
  market: string
  market_id?: string
  selection: string
  normalized_selection: string
  name?: string
  price: number
  timestamp: number
  is_main: boolean
  is_live: boolean
  limits?: { max?: number | null; max_stake?: number | null } | null
  order_book?: OrderBookLevel[] | null
  source_ids?: SourceIds | null
  deep_link?: DeepLink | null
}

type OpticOddsFixtureStatusUpdate = {
  fixture_id: string
  new_status?: string | null
  new_start_date?: string | null
  timestamp?: number
}

type OpticOddsResultUpdate = {
  fixture_id: string
  is_live: boolean
  score?: JsonRecord | null
  player_results?: unknown[]
}

type OpticOddsEventEnvelope<T> = {
  entry_id: string
  type?: string
  data: T
}

type PolymarketMarketDetails = {
  eventSlug: string
  marketSlug: string
  conditionId: string | null
  outcomes: string[]
  tokenIds: string[]
}

type PolymarketCatalogEntry = {
  eventSlug: string
  eventDate: string | null
  teams: string[]
  marketSlug: string
  conditionId: string | null
  tokenIds: string[]
}

type PolymarketBookState = {
  tokenId: string
  bestBid: number | null
  bestAsk: number | null
  lastTradePrice: number | null
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  updatedAt: Date
}

type LatestOddState = {
  odd: OpticOddsOdd
  isLocked: boolean
  observedAt: Date
}

type SignalState = {
  edgeToSnapshotBps: number
  edgeToExecutableAskBps: number | null
  feeAdjustedEdgeBps: number | null
  firstObservedAt: number
  observedAt: number
}

type FixtureState = {
  fixture: ObserverFixtureRecord
  oddsByBook: Map<string, Map<string, LatestOddState>>
  tokenToSelection: Map<string, string>
  selectionToToken: Map<string, string>
  polymarketBooks: Map<string, PolymarketBookState>
  lastSignals: Map<string, SignalState>
}

type ObserverStatus = {
  startedAt: string | null
  fixtureRefreshAt: string | null
  oddsStreamConnectedAt: string | null
  resultsStreamConnectedAt: string | null
  polymarketConnectedAt: string | null
  lastOddsEventAt: string | null
  lastResultsEventAt: string | null
  lastPolymarketEventAt: string | null
  trackedFixtures: number
  trackedPolymarketTokens: number
  oddsCheckpoint: string | null
  resultsCheckpoint: string | null
}

type SelectionSummary = {
  selection: string
  referenceProbability: number
  polymarketSnapshotPrice: number
  executableAsk: number | null
  executableBid: number | null
  syntheticAsk: number | null
  syntheticBid: number | null
  directBestBid: number | null
  directBestAsk: number | null
  directBestBidSize: number | null
  directBestAskSize: number | null
  syntheticAskSize: number | null
  syntheticBidSize: number | null
  executableAskSize: number | null
  executableBidSize: number | null
  executableNotional: number | null
  depthSatisfied: boolean
  feePerShare: number | null
  feeAdjustedAsk: number | null
  feeAdjustedEdgeBps: number | null
  snapshotEdgeBps: number
  executableAskEdgeBps: number | null
}

type ReferenceConfidence = "low" | "medium" | "high"

type ReferenceBookContribution = {
  bookId: string
  weight: number
  overround: number
  updatedAt: string
  probabilities: Record<string, number>
}

type ExcludedReferenceBook = {
  bookId: string
  reason: string
}

type ReferenceBlend = {
  source: string
  books: string[]
  probabilities: Map<string, number>
  timestamp: Date
  confidence: ReferenceConfidence
  bookCount: number
  maxDispersionBps: number
  contributions: ReferenceBookContribution[]
  excludedBooks: ExcludedReferenceBook[]
}

type OpportunitySummary = {
  fixtureId: string
  fixture: string
  marketSlug: string | null
  isLive: boolean
  referenceSource: string
  referenceConfidence: ReferenceConfidence
  referenceBookCount: number
  maxDispersionBps: number
  selection: string
  referenceProbability: number
  executableAsk: number
  executableBid: number | null
  executableAskSize: number
  executableBidSize: number | null
  executableNotional: number
  depthSatisfied: boolean
  feePerShare: number
  feeAdjustedAsk: number
  feeAdjustedEdgeBps: number
  executableAskEdgeBps: number
  snapshotEdgeBps: number
  persistenceMs: number
  persistenceSatisfied: boolean
  score: string | null
  period: string | null
  updatedAt: string
}

type OpportunitiesOptions = {
  minEdgeBps?: number
  minConfidence?: ReferenceConfidence
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const toAgeSeconds = (value: string | null) => {
  if (!value) {
    return null
  }

  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
}

const toDateFromUnixSeconds = (value: number) => new Date(value * 1000)

const requiresMappingCoverage = (fixture: ObserverFixtureRecord) =>
  fixture.isLive || fixture.startTime.getTime() - Date.now() <= MAPPING_LOOKAHEAD_MS

const requiresActiveOddsCoverage = (fixture: ObserverFixtureRecord) =>
  fixture.isLive || fixture.startTime.getTime() - Date.now() <= ACTIVE_ODDS_LOOKAHEAD_MS

const normalizeBookId = (odd: OpticOddsOdd) =>
  odd.sportsbook_id ?? odd.sportsbook?.trim().toLowerCase().replace(/\s+/g, "_") ?? "unknown"

const parseScoreSummary = (fixture: OpticOddsFixture) => {
  const homeScore = fixture.result?.scores?.home?.total
  const awayScore = fixture.result?.scores?.away?.total

  if (typeof homeScore !== "number" || typeof awayScore !== "number") {
    return null
  }

  return `${homeScore}-${awayScore}`
}

const parsePeriodSummary = (fixture: OpticOddsFixture) => {
  const period = fixture.result?.in_play_data?.period
  const clock = fixture.result?.in_play_data?.clock

  if (!period && !clock) {
    return null
  }

  return [period, clock].filter(Boolean).join(" ")
}

const getBestAvailableLevel = (odd: OpticOddsOdd) => odd.order_book?.[0]?.[0] ?? null

const getMaxStake = (odd: OpticOddsOdd) => odd.limits?.max ?? odd.limits?.max_stake ?? null

const parseMarketSlugFromDeepLink = (deepLink?: DeepLink | null) => {
  const desktopLink = deepLink?.desktop

  if (!desktopLink) {
    return null
  }

  try {
    const url = new URL(desktopLink)
    return url.searchParams.get("marketSlug")
  } catch {
    return null
  }
}

const parseTokenIdFromSourceIds = (sourceIds?: SourceIds | null) => {
  const tokenId = sourceIds?.selection_id

  return typeof tokenId === "string" || typeof tokenId === "number"
    ? String(tokenId)
    : null
}

const parseBookLevels = (value: unknown): OrderBookLevel[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((level) => {
    if (Array.isArray(level) && level.length >= 2) {
      const price = Number(level[0])
      const size = Number(level[1])

      if (Number.isFinite(price) && Number.isFinite(size)) {
        return [[price, size] satisfies OrderBookLevel]
      }
    }

    if (typeof level === "object" && level !== null) {
      const record = level as JsonRecord
      const price = Number(record.price)
      const size = Number(record.size)

      if (Number.isFinite(price) && Number.isFinite(size)) {
        return [[price, size] satisfies OrderBookLevel]
      }
    }

    return []
  })
}

const sortBidLevels = (levels: OrderBookLevel[]) => [...levels].sort((left, right) => right[0] - left[0])

const sortAskLevels = (levels: OrderBookLevel[]) => [...levels].sort((left, right) => left[0] - right[0])

const getBestBidFromLevels = (levels: OrderBookLevel[]) => sortBidLevels(levels)[0]?.[0] ?? null

const getBestAskFromLevels = (levels: OrderBookLevel[]) => sortAskLevels(levels)[0]?.[0] ?? null

const getBestBidSizeFromLevels = (levels: OrderBookLevel[]) => sortBidLevels(levels)[0]?.[1] ?? null

const getBestAskSizeFromLevels = (levels: OrderBookLevel[]) => sortAskLevels(levels)[0]?.[1] ?? null

const isUsablePolymarketAsk = (value: number | null) => value !== null && value > 0 && value < 1

const isUsablePolymarketBid = (value: number | null) => value !== null && value > 0 && value < 1

const clampProbability = (value: number) => Math.max(0, Math.min(1, value))

const estimateSportsTakerFeePerShare = (price: number) =>
  SPORTS_TAKER_FEE_RATE * price * (1 - price)

const minNullable = (...values: Array<number | null>) => {
  const present = values.filter((value): value is number => value !== null)
  return present.length > 0 ? Math.min(...present) : null
}

const maxNullable = (...values: Array<number | null>) => {
  const present = values.filter((value): value is number => value !== null)
  return present.length > 0 ? Math.max(...present) : null
}

const toJsonRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null

const parseEventBlocks = (chunk: string) => chunk.split("\n\n")

const parseSseEvent = (block: string) => {
  const lines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

  let event = "message"
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim()
      continue
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim())
    }
  }

  return {
    event,
    data: dataLines.join("\n"),
  }
}

const normaliseProbability = (value: number) => (value > 1 ? value / 100 : value)

class IplObserverService {
  private started = false

  private readonly fixtures = new Map<string, FixtureState>()

  private readonly tokenToFixture = new Map<string, string>()

  private readonly trackedTokenIds = new Set<string>()

  private readonly subscribedTokenIds = new Set<string>()

  private readonly marketDetailsCache = new Map<string, PolymarketMarketDetails>()

  private polymarketCatalog: PolymarketCatalogEntry[] = []

  private polymarketCatalogUpdatedAt = 0

  private refreshTimer: NodeJS.Timeout | null = null

  private activeCoverageTimer: NodeJS.Timeout | null = null

  private polymarketSocket: WebSocket | null = null

  private polymarketPingTimer: NodeJS.Timeout | null = null

  private oddsCheckpoint: string | null = null

  private resultsCheckpoint: string | null = null

  private readonly status: ObserverStatus = {
    startedAt: null,
    fixtureRefreshAt: null,
    oddsStreamConnectedAt: null,
    resultsStreamConnectedAt: null,
    polymarketConnectedAt: null,
    lastOddsEventAt: null,
    lastResultsEventAt: null,
    lastPolymarketEventAt: null,
    trackedFixtures: 0,
    trackedPolymarketTokens: 0,
    oddsCheckpoint: null,
    resultsCheckpoint: null,
  }

  public async start() {
    if (this.started) {
      return
    }

    this.started = true
    this.status.startedAt = new Date().toISOString()

    this.oddsCheckpoint = (await getCheckpoint(CHECKPOINT_ODDS_STREAM))?.lastEntryId ?? null
    this.resultsCheckpoint =
      (await getCheckpoint(CHECKPOINT_RESULTS_STREAM))?.lastEntryId ?? null

    this.status.oddsCheckpoint = this.oddsCheckpoint
    this.status.resultsCheckpoint = this.resultsCheckpoint

    if (!config.opticOddsEnabled) {
      logger.warn("Started IPL observer with OpticOdds disabled; live fixture and odds streams are inactive")
      return
    }

    await this.refreshFixtures()

    this.refreshTimer = setInterval(() => {
      void this.refreshFixtures().catch((error) => {
        logger.warn("IPL observer fixture refresh failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, FIXTURE_REFRESH_INTERVAL_MS)

    this.activeCoverageTimer = setInterval(() => {
      void this.reconcileActiveCoverageFixtures().catch((error) => {
        logger.warn("IPL observer active fixture reconciliation failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, ACTIVE_FIXTURE_RECONCILIATION_INTERVAL_MS)

    void this.runOddsStream()
    void this.runResultsStream()

    logger.info("Started IPL observer service", {
      fixtures: this.fixtures.size,
      trackedTokens: this.trackedTokenIds.size,
    })
  }

  public getStatus() {
    return { ...this.status }
  }

  public async getRecentFixtures(limit = 20) {
    return listFixtures(limit)
  }

  public async getRecentSignals(limit = 50) {
    return listSignals(limit)
  }

  public getDiagnostics() {
    const fixtureStates = Array.from(this.fixtures.values())
    const liveFixtures = fixtureStates.filter((fixtureState) => fixtureState.fixture.isLive)
    const monitoring = fixtureStates.map((fixtureState) => {
      const state = this.buildFixtureMonitoringState(fixtureState.fixture, fixtureState)
      return {
        fixtureId: fixtureState.fixture.id,
        fixture: `${fixtureState.fixture.homeTeam} vs ${fixtureState.fixture.awayTeam}`,
        isLive: fixtureState.fixture.isLive,
        mode: state.mode,
        startsInSeconds: state.startsInSeconds,
        reasons: state.reasons,
      }
    })

    return {
      totals: {
        fixtures: fixtureStates.length,
        liveFixtures: liveFixtures.length,
        activeCoverageFixtures: fixtureStates.filter((fixtureState) =>
          requiresActiveOddsCoverage(fixtureState.fixture),
        ).length,
        mappedFixtures: fixtureStates.filter(
          (fixtureState) =>
            Boolean(
              fixtureState.fixture.polymarketMarketSlug &&
                fixtureState.fixture.homeTokenId &&
                fixtureState.fixture.awayTokenId,
            ),
        ).length,
        futureFixturesAwaitingMarkets: fixtureStates.filter(
          (fixtureState) =>
            !requiresMappingCoverage(fixtureState.fixture) &&
            !fixtureState.fixture.polymarketMarketSlug,
        ).length,
        fixturesWithPolymarketBook: fixtureStates.filter(
          (fixtureState) => fixtureState.polymarketBooks.size > 0,
        ).length,
        fixturesWithReferenceBlend: fixtureStates.filter((fixtureState) =>
          Boolean(this.buildReferenceProbabilities(fixtureState)),
        ).length,
      },
      opportunities: {
        low: this.getLiveOpportunities({ minConfidence: "low" }).length,
        medium: this.getLiveOpportunities({ minConfidence: "medium" }).length,
        high: this.getLiveOpportunities({ minConfidence: "high" }).length,
      },
      attentionFixtures: monitoring.filter((fixture) => fixture.reasons.length > 0).length,
      fixturesNeedingAttention: monitoring
        .filter((fixture) => fixture.reasons.length > 0)
        .sort((left, right) => Number(right.isLive) - Number(left.isLive))
        .slice(0, 20),
    }
  }

  public getLiveOpportunities(options: OpportunitiesOptions = {}) {
    const minEdgeBps = options.minEdgeBps ?? SIGNAL_THRESHOLD_BPS
    const minConfidence = options.minConfidence ?? "medium"

    return Array.from(this.fixtures.values())
      .flatMap((fixtureState) =>
        this.buildFixtureOpportunities(fixtureState, minEdgeBps, minConfidence),
      )
      .sort(
        (left, right) =>
          (right.feeAdjustedEdgeBps ?? 0) - (left.feeAdjustedEdgeBps ?? 0),
      )
  }

  public getOpportunityDiagnostics(minEdgeBps = SIGNAL_THRESHOLD_BPS) {
    return {
      actionable: this.getLiveOpportunities({
        minEdgeBps,
        minConfidence: "medium",
      }),
      provisional: this.getLiveOpportunities({
        minEdgeBps,
        minConfidence: "low",
      }).filter((opportunity) => opportunity.referenceConfidence === "low"),
      summary: {
        minEdgeBps,
        actionableCount: this.getLiveOpportunities({
          minEdgeBps,
          minConfidence: "medium",
        }).length,
        provisionalCount: this.getLiveOpportunities({
          minEdgeBps,
          minConfidence: "low",
        }).filter((opportunity) => opportunity.referenceConfidence === "low").length,
      },
    }
  }

  public getLiveFixtures() {
    return Array.from(this.fixtures.values())
      .filter((fixtureState) => fixtureState.fixture.isLive)
      .map((fixtureState) => ({
        fixture: this.buildPublicFixture(fixtureState.fixture),
        monitoring: this.buildFixtureMonitoringState(fixtureState.fixture, fixtureState),
        summary: this.buildFixtureSummary(fixtureState),
      }))
      .sort(
        (left, right) =>
          new Date(right.fixture.updatedAt).getTime() - new Date(left.fixture.updatedAt).getTime(),
      )
  }

  public getMetrics() {
    const diagnostics = this.getDiagnostics()
    const oddsAge = toAgeSeconds(this.status.lastOddsEventAt)
    const resultsAge = toAgeSeconds(this.status.lastResultsEventAt)
    const polymarketAge = toAgeSeconds(this.status.lastPolymarketEventAt)
    const refreshAge = toAgeSeconds(this.status.fixtureRefreshAt)

    return {
      observer_started: Number(Boolean(this.status.startedAt)),
      tracked_fixtures: diagnostics.totals.fixtures,
      live_fixtures: diagnostics.totals.liveFixtures,
      active_coverage_fixtures: diagnostics.totals.activeCoverageFixtures,
      mapped_fixtures: diagnostics.totals.mappedFixtures,
      future_fixtures_awaiting_markets: diagnostics.totals.futureFixturesAwaitingMarkets,
      fixtures_with_polymarket_book: diagnostics.totals.fixturesWithPolymarketBook,
      fixtures_with_reference_blend: diagnostics.totals.fixturesWithReferenceBlend,
      tracked_polymarket_tokens: this.status.trackedPolymarketTokens,
      opportunity_count_low: diagnostics.opportunities.low,
      opportunity_count_medium: diagnostics.opportunities.medium,
      opportunity_count_high: diagnostics.opportunities.high,
      attention_fixture_count: diagnostics.attentionFixtures,
      odds_last_event_age_seconds: oddsAge,
      results_last_event_age_seconds: resultsAge,
      polymarket_last_event_age_seconds: polymarketAge,
      fixture_refresh_age_seconds: refreshAge,
    }
  }

  public getLiveTape() {
    return this.getLiveFixtures().flatMap((entry) => {
      const summary = entry.summary

      if (!summary) {
        return []
      }

      return summary.selections.map((selection) => ({
        fixtureId: entry.fixture.id,
        fixture: `${entry.fixture.homeTeam} vs ${entry.fixture.awayTeam}`,
        selection: selection.selection,
        confidence: summary.referenceConfidence,
        referenceSource: summary.referenceSource,
        feeAdjustedEdgeBps: selection.feeAdjustedEdgeBps,
        executableAsk: selection.executableAsk,
        referenceProbability: selection.referenceProbability,
        score: entry.fixture.score,
        period: entry.fixture.period,
        updatedAt: entry.fixture.updatedAt,
      }))
    })
      .sort(
        (left, right) =>
          Math.abs(right.feeAdjustedEdgeBps ?? 0) - Math.abs(left.feeAdjustedEdgeBps ?? 0),
      )
      .slice(0, 10)
  }

  public getReadiness() {
    if (!config.opticOddsEnabled) {
      return {
        ready: this.started,
        reasons: this.started ? [] : ["observer-not-started"],
        fixtureRefreshAgeSeconds: null,
        oddsStreamAgeSeconds: null,
        polymarketStreamAgeSeconds: null,
        trackedFixtures: this.fixtures.size,
        trackedPolymarketTokens: this.status.trackedPolymarketTokens,
      }
    }

    const reasons: string[] = []
    const fixtureRefreshAge = toAgeSeconds(this.status.fixtureRefreshAt)
    const oddsStreamAge = toAgeSeconds(this.status.lastOddsEventAt)
    const polymarketStreamAge = toAgeSeconds(this.status.lastPolymarketEventAt)

    if (!this.started) {
      reasons.push("observer-not-started")
    }

    if (fixtureRefreshAge === null || fixtureRefreshAge > READY_MAX_FIXTURE_REFRESH_AGE_SECONDS) {
      reasons.push("fixture-refresh-stale")
    }

    if (oddsStreamAge === null || oddsStreamAge > READY_MAX_STREAM_AGE_SECONDS) {
      reasons.push("odds-stream-stale")
    }

    if (this.status.trackedPolymarketTokens > 0) {
      if (polymarketStreamAge === null || polymarketStreamAge > READY_MAX_STREAM_AGE_SECONDS) {
        reasons.push("polymarket-stream-stale")
      }
    }

    if (this.fixtures.size === 0) {
      reasons.push("no-fixtures-loaded")
    }

    return {
      ready: reasons.length === 0,
      reasons,
      fixtureRefreshAgeSeconds: fixtureRefreshAge,
      oddsStreamAgeSeconds: oddsStreamAge,
      polymarketStreamAgeSeconds: polymarketStreamAge,
      trackedFixtures: this.fixtures.size,
      trackedPolymarketTokens: this.status.trackedPolymarketTokens,
    }
  }

  public async getFixtureDetail(fixtureId: string) {
    const fixture = await getFixture(fixtureId)

    if (!fixture) {
      return null
    }

    const [odds, signals] = await Promise.all([
      listFixtureOdds(fixtureId),
      listFixtureSignals(fixtureId, 20),
    ])

    const liveState = this.fixtures.get(fixtureId)

    return {
      fixture: this.buildPublicFixture(fixture),
      books: this.buildBookViews(odds),
      signals,
      monitoring: this.buildFixtureMonitoringState(fixture, liveState),
      summary: liveState ? this.buildFixtureSummary(liveState) : null,
    }
  }

  public async getCurrentLiveFixtureDetail(homeTeam: string, awayTeam: string) {
    const fixture = await getLiveFixtureByTeams(homeTeam, awayTeam)

    return fixture ? this.getFixtureDetail(fixture.id) : null
  }

  private async refreshFixtures() {
    const fixtures = await this.fetchActiveFixtures()

    await Promise.all(
      fixtures.map(async (fixture) => {
        await this.registerFixture(fixture)
        const fixtureState = this.fixtures.get(fixture.id)

        if (fixtureState && requiresMappingCoverage(fixtureState.fixture)) {
          try {
            await this.ensureFixturePolymarketMapping(fixtureState)
          } catch (error) {
            logger.warn("Failed to map Polymarket fixture during refresh", {
              fixtureId: fixture.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        if (fixtureState && requiresActiveOddsCoverage(fixtureState.fixture)) {
          try {
            await this.hydrateFixtureOdds(fixture.id)
          } catch (error) {
            logger.warn("Failed to hydrate fixture odds during refresh", {
              fixtureId: fixture.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }),
    )

    this.status.fixtureRefreshAt = new Date().toISOString()
    this.status.trackedFixtures = this.fixtures.size
    this.status.trackedPolymarketTokens = this.trackedTokenIds.size

    if (this.trackedTokenIds.size > 0) {
      this.ensurePolymarketSocket()
    }
  }

  private async reconcileActiveCoverageFixtures() {
    const activeFixtureIds = Array.from(this.fixtures.values())
      .filter((fixtureState) => requiresActiveOddsCoverage(fixtureState.fixture))
      .map((fixtureState) => fixtureState.fixture.id)

    await Promise.all(
      activeFixtureIds.map(async (fixtureId) => {
        try {
          await this.hydrateFixtureOdds(fixtureId)
        } catch (error) {
          logger.warn("Failed to reconcile active fixture odds", {
            fixtureId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }),
    )
  }

  private async fetchActiveFixtures() {
    const url = new URL(`${OPTICODDS_BASE_URL}/fixtures/active`)
    url.searchParams.append("sport", "cricket")
    url.searchParams.append("league", IPL_LEAGUE_NAME)

    const response = await fetch(url, {
      headers: getOpticOddsHeaders(),
    })

    if (!response.ok) {
      throw new Error(`OpticOdds fixtures request failed with ${response.status}`)
    }

    const payload = (await response.json()) as { data?: OpticOddsFixture[] }

    return (payload.data ?? []).filter((fixture) => fixture.league.name === IPL_LEAGUE_NAME)
  }

  private async registerFixture(fixture: OpticOddsFixture) {
    const record = {
      id: fixture.id,
      opticOddsGameId: fixture.game_id,
      sport: fixture.sport.name,
      league: fixture.league.name,
      homeTeam: fixture.home_team_display,
      awayTeam: fixture.away_team_display,
      homeTeamId: fixture.home_competitors?.[0]?.id ?? null,
      awayTeamId: fixture.away_competitors?.[0]?.id ?? null,
      startTime: new Date(fixture.start_date),
      status: fixture.status,
      isLive: fixture.is_live,
      venueName: fixture.venue_name ?? null,
      venueLocation: fixture.venue_location ?? null,
      polymarketEventSlug: this.fixtures.get(fixture.id)?.fixture.polymarketEventSlug ?? null,
      polymarketMarketSlug: this.fixtures.get(fixture.id)?.fixture.polymarketMarketSlug ?? null,
      polymarketConditionId:
        this.fixtures.get(fixture.id)?.fixture.polymarketConditionId ?? null,
      homeTokenId: this.fixtures.get(fixture.id)?.fixture.homeTokenId ?? null,
      awayTokenId: this.fixtures.get(fixture.id)?.fixture.awayTokenId ?? null,
      lastScore: parseScoreSummary(fixture),
      lastPeriod: parsePeriodSummary(fixture),
      lastResultPayload: fixture.result ?? null,
    } satisfies Omit<ObserverFixtureRecord, "createdAt" | "updatedAt"> & {
      createdAt?: Date
      updatedAt?: Date
    }

    await upsertFixture(record)

    const existingState = this.fixtures.get(fixture.id)
    const existingFixture = existingState?.fixture

    this.fixtures.set(fixture.id, {
      fixture: {
        ...existingFixture,
        ...record,
        createdAt: existingFixture?.createdAt ?? new Date(),
        updatedAt: new Date(),
      },
      oddsByBook: existingState?.oddsByBook ?? new Map(),
      tokenToSelection: existingState?.tokenToSelection ?? new Map(),
      selectionToToken: existingState?.selectionToToken ?? new Map(),
      polymarketBooks: existingState?.polymarketBooks ?? new Map(),
      lastSignals: existingState?.lastSignals ?? new Map(),
    })
  }

  private async hydrateFixtureOdds(fixtureId: string) {
    const url = new URL(`${OPTICODDS_BASE_URL}/fixtures/odds`)
    url.searchParams.append("sport", "cricket")
    url.searchParams.append("fixture_id", fixtureId)
    url.searchParams.append("market", MONEYLINE_MARKET)
    url.searchParams.append("odds_format", "PROBABILITY")
    url.searchParams.append("exclude_fees", "true")

    for (const sportsbook of OBSERVED_BOOKS) {
      url.searchParams.append("sportsbook", sportsbook)
    }

    const response = await fetch(url, {
      headers: getOpticOddsHeaders(),
    })

    if (!response.ok) {
      throw new Error(
        `OpticOdds fixture odds request failed for ${fixtureId} with ${response.status}`,
      )
    }

    const payload = (await response.json()) as {
      data?: Array<{ id: string; odds?: OpticOddsOdd[] }>
    }

    const fixture = payload.data?.find((entry) => entry.id === fixtureId)

    for (const odd of fixture?.odds ?? []) {
      await this.applyOddsUpdate(odd, false)
    }
  }

  private async fetchPolymarketMarketDetails(slug: string) {
    const cached = this.marketDetailsCache.get(slug)

    if (cached) {
      return cached
    }

    const response = await fetch(
      `${POLYMARKET_GAMMA_BASE_URL}/markets/slug/${encodeURIComponent(slug)}`,
    )

    if (!response.ok) {
      throw new Error(
        `Polymarket market lookup failed for ${slug} with ${response.status}`,
      )
    }

    const payload = (await response.json()) as {
      slug?: string
      conditionId?: string
      outcomes?: string | string[]
      clobTokenIds?: string | string[]
      events?: Array<{ slug?: string }>
    }

    const details = {
      eventSlug: payload.events?.[0]?.slug ?? payload.slug ?? slug,
      marketSlug: payload.slug ?? slug,
      conditionId: payload.conditionId ?? null,
      outcomes: parseStringList(payload.outcomes),
      tokenIds: parseTokenIdList(payload.clobTokenIds),
    } satisfies PolymarketMarketDetails

    this.marketDetailsCache.set(slug, details)
    return details
  }

  private async getPolymarketCatalog() {
    if (
      this.polymarketCatalog.length > 0 &&
      Date.now() - this.polymarketCatalogUpdatedAt < POLYMARKET_CATALOG_TTL_MS
    ) {
      return this.polymarketCatalog
    }

    const url = new URL(`${POLYMARKET_GAMMA_BASE_URL}/events`)
    url.searchParams.append("tag_id", "101988")
    url.searchParams.append("active", "true")
    url.searchParams.append("closed", "false")
    url.searchParams.append("limit", "200")

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Polymarket event catalog failed with ${response.status}`)
    }

    const payload = (await response.json()) as Array<{
      slug?: string
      eventDate?: string
      startTime?: string
      teams?: Array<{ name?: string }>
      markets?: Array<{
        slug?: string
        conditionId?: string
        sportsMarketType?: string
        clobTokenIds?: string | string[]
      }>
    }>

    this.polymarketCatalog = payload.flatMap((event) => {
      const moneylineMarket = event.markets?.find(
        (market) => market.sportsMarketType === "moneyline",
      )

      if (!event.slug || !moneylineMarket?.slug) {
        return []
      }

      return [
        {
          eventSlug: event.slug,
          eventDate: event.eventDate ?? event.startTime?.slice(0, 10) ?? null,
          teams: (event.teams ?? []).flatMap((team) => (team.name ? [team.name] : [])),
          marketSlug: moneylineMarket.slug,
          conditionId: moneylineMarket.conditionId ?? null,
          tokenIds: parseTokenIdList(moneylineMarket.clobTokenIds),
        } satisfies PolymarketCatalogEntry,
      ]
    })

    this.polymarketCatalogUpdatedAt = Date.now()
    return this.polymarketCatalog
  }

  private async resolvePolymarketMarket(
    fixtureState: FixtureState,
    homeTokenId?: string | null,
    awayTokenId?: string | null,
  ) {
    const catalog = await this.getPolymarketCatalog()
    const fixtureDate = fixtureState.fixture.startTime.toISOString().slice(0, 10)
    const expectedTeams = [fixtureState.fixture.homeTeam, fixtureState.fixture.awayTeam]

    const tokenMatch = homeTokenId && awayTokenId
      ? catalog.find((entry) => {
          const tokenSet = new Set(entry.tokenIds)
          return tokenSet.has(homeTokenId) && tokenSet.has(awayTokenId)
        })
      : null

    if (tokenMatch) {
      return this.fetchPolymarketMarketDetails(tokenMatch.marketSlug)
    }

    const teamMatch = catalog.find((entry) => {
      const teamSet = new Set(entry.teams)
      return (
        entry.eventDate === fixtureDate &&
        expectedTeams.every((team) => teamSet.has(team))
      )
    })

    if (!teamMatch) {
      return null
    }

    return this.fetchPolymarketMarketDetails(teamMatch.marketSlug)
  }

  private async runOddsStream() {
    let reconnectDelay = 1_000

    while (this.started) {
      const url = new URL(`${OPTICODDS_BASE_URL}/stream/odds/cricket`)
      url.searchParams.append("odds_format", "PROBABILITY")
      url.searchParams.append("exclude_fees", "true")
      url.searchParams.append("league", IPL_LEAGUE_NAME)
      url.searchParams.append("market", MONEYLINE_MARKET)
      url.searchParams.append("include_fixture_updates", "true")

      for (const sportsbook of OBSERVED_BOOKS) {
        url.searchParams.append("sportsbook", sportsbook)
      }

      if (this.oddsCheckpoint) {
        url.searchParams.append("last_entry_id", this.oddsCheckpoint)
      }

      try {
        const response = await fetch(url, {
          headers: getOpticOddsHeaders(),
        })

        if (!response.ok || !response.body) {
          throw new Error(`OpticOdds odds stream failed with ${response.status}`)
        }

        this.status.oddsStreamConnectedAt = new Date().toISOString()
        reconnectDelay = 1_000

        await this.consumeSse(response, async (eventName, eventData) => {
          if (eventName === "ping" || eventName === "connected") {
            return
          }

          if (eventName === "odds" || eventName === "locked-odds") {
            const envelope = JSON.parse(eventData) as OpticOddsEventEnvelope<OpticOddsOdd[]>
            this.oddsCheckpoint = envelope.entry_id
            this.status.oddsCheckpoint = envelope.entry_id
            this.status.lastOddsEventAt = new Date().toISOString()
            await upsertCheckpoint(CHECKPOINT_ODDS_STREAM, envelope.entry_id)

            for (const odd of envelope.data) {
              await this.applyOddsUpdate(odd, eventName === "locked-odds")
            }

            return
          }

          if (eventName === "fixture-status") {
            const envelope = JSON.parse(eventData) as OpticOddsEventEnvelope<OpticOddsFixtureStatusUpdate>
            this.oddsCheckpoint = envelope.entry_id
            this.status.oddsCheckpoint = envelope.entry_id
            this.status.lastOddsEventAt = new Date().toISOString()
            await upsertCheckpoint(CHECKPOINT_ODDS_STREAM, envelope.entry_id)
            await this.applyFixtureStatusUpdate(envelope.data)
          }
        })
      } catch (error) {
        logger.warn("OpticOdds odds stream disconnected", {
          error: error instanceof Error ? error.message : String(error),
          reconnectDelay,
        })

        await sleep(reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 60_000)
      }
    }
  }

  private async runResultsStream() {
    let reconnectDelay = 1_000

    while (this.started) {
      const url = new URL(`${OPTICODDS_BASE_URL}/stream/results/cricket`)
      url.searchParams.append("league", IPL_LEAGUE_NAME)

      if (this.resultsCheckpoint) {
        url.searchParams.append("last_entry_id", this.resultsCheckpoint)
      }

      try {
        const response = await fetch(url, {
          headers: getOpticOddsHeaders(),
        })

        if (!response.ok || !response.body) {
          throw new Error(`OpticOdds results stream failed with ${response.status}`)
        }

        this.status.resultsStreamConnectedAt = new Date().toISOString()
        reconnectDelay = 1_000

        await this.consumeSse(response, async (eventName, eventData) => {
          if (eventName === "ping" || eventName === "connected") {
            return
          }

          if (eventName === "fixture-results") {
            const envelope = JSON.parse(eventData) as OpticOddsEventEnvelope<OpticOddsResultUpdate>
            this.resultsCheckpoint = envelope.entry_id
            this.status.resultsCheckpoint = envelope.entry_id
            this.status.lastResultsEventAt = new Date().toISOString()
            await upsertCheckpoint(CHECKPOINT_RESULTS_STREAM, envelope.entry_id)
            await this.applyFixtureResultsUpdate(envelope.data)
          }
        })
      } catch (error) {
        logger.warn("OpticOdds results stream disconnected", {
          error: error instanceof Error ? error.message : String(error),
          reconnectDelay,
        })

        await sleep(reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 60_000)
      }
    }
  }

  private async consumeSse(
    response: Response,
    onEvent: (eventName: string, eventData: string) => Promise<void>,
  ) {
    const reader = response.body?.getReader()

    if (!reader) {
      throw new Error("Missing SSE response body reader")
    }

    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const blocks = parseEventBlocks(buffer)
      buffer = blocks.pop() ?? ""

      for (const block of blocks) {
        const trimmed = block.trim()

        if (!trimmed) {
          continue
        }

        const parsed = parseSseEvent(trimmed)
        await onEvent(parsed.event, parsed.data)
      }
    }
  }

  private async applyOddsUpdate(odd: OpticOddsOdd, isLocked: boolean) {
    if (odd.market !== MONEYLINE_MARKET) {
      return
    }

    const fixtureState = this.fixtures.get(odd.fixture_id)

    if (!fixtureState) {
      return
    }

    const sportsbookId = normalizeBookId(odd)
    const bookSelections =
      fixtureState.oddsByBook.get(sportsbookId) ?? new Map<string, LatestOddState>()

    bookSelections.set(odd.normalized_selection, {
      odd,
      isLocked,
      observedAt: new Date(),
    })
    fixtureState.oddsByBook.set(sportsbookId, bookSelections)

    await upsertOdd({
      id: odd.id,
      fixtureId: odd.fixture_id,
      sportsbookId,
      sportsbook: odd.sportsbook ?? sportsbookId,
      marketId: odd.market_id ?? odd.market.toLowerCase().replace(/\s+/g, "_"),
      market: odd.market,
      selection: odd.selection,
      normalizedSelection: odd.normalized_selection,
      priceProbability: normaliseProbability(odd.price),
      isMain: odd.is_main,
      isLive: odd.is_live,
      isLocked,
      maxStake: getMaxStake(odd),
      oddsTimestamp: toDateFromUnixSeconds(odd.timestamp),
      sourceIds: odd.source_ids ?? null,
      orderBook: odd.order_book ?? null,
      deepLink: odd.deep_link ?? null,
    })

    if (sportsbookId === "polymarket") {
      await this.updatePolymarketMappingFromOdd(fixtureState, odd)
    }

    await this.evaluateSignals(fixtureState)
  }

  private async updatePolymarketMappingFromOdd(
    fixtureState: FixtureState,
    odd: OpticOddsOdd,
  ) {
    const tokenId = parseTokenIdFromSourceIds(odd.source_ids)

    if (!tokenId) {
      return
    }

    fixtureState.selectionToToken.set(odd.normalized_selection, tokenId)
    fixtureState.tokenToSelection.set(tokenId, odd.normalized_selection)
    this.tokenToFixture.set(tokenId, fixtureState.fixture.id)
    this.trackedTokenIds.add(tokenId)

    const homeTokenId =
      fixtureState.selectionToToken.get(normalizeSelection(fixtureState.fixture.homeTeam)) ?? null
    const awayTokenId =
      fixtureState.selectionToToken.get(normalizeSelection(fixtureState.fixture.awayTeam)) ?? null

    if (!homeTokenId || !awayTokenId) {
      return
    }

    const linkedMarketSlug = parseMarketSlugFromDeepLink(odd.deep_link)
    const resolvedMarket = linkedMarketSlug
      ? await this.fetchPolymarketMarketDetails(linkedMarketSlug)
      : await this.resolvePolymarketMarket(fixtureState, homeTokenId, awayTokenId)

    if (!resolvedMarket) {
      return
    }

    await this.applyResolvedPolymarketMapping(
      fixtureState,
      resolvedMarket,
      homeTokenId,
      awayTokenId,
    )
  }

  private async ensureFixturePolymarketMapping(fixtureState: FixtureState) {
    if (
      fixtureState.fixture.polymarketMarketSlug &&
      fixtureState.fixture.homeTokenId &&
      fixtureState.fixture.awayTokenId
    ) {
      this.trackFixtureTokens(
        fixtureState,
        fixtureState.fixture.homeTokenId,
        normalizeSelection(fixtureState.fixture.homeTeam),
      )
      this.trackFixtureTokens(
        fixtureState,
        fixtureState.fixture.awayTokenId,
        normalizeSelection(fixtureState.fixture.awayTeam),
      )
      this.status.trackedPolymarketTokens = this.trackedTokenIds.size
      this.ensurePolymarketSocket()
      this.subscribePolymarketTokens()
      return
    }

    const resolvedMarket = await this.resolvePolymarketMarket(fixtureState)

    if (!resolvedMarket) {
      return
    }

    const homeSelection = normalizeSelection(fixtureState.fixture.homeTeam)
    const awaySelection = normalizeSelection(fixtureState.fixture.awayTeam)
    const homeIndex = resolvedMarket.outcomes.findIndex(
      (outcome) => normalizeSelection(outcome) === homeSelection,
    )
    const awayIndex = resolvedMarket.outcomes.findIndex(
      (outcome) => normalizeSelection(outcome) === awaySelection,
    )

    const homeTokenId = homeIndex >= 0 ? resolvedMarket.tokenIds[homeIndex] ?? null : null
    const awayTokenId = awayIndex >= 0 ? resolvedMarket.tokenIds[awayIndex] ?? null : null

    if (!homeTokenId || !awayTokenId) {
      return
    }

    await this.applyResolvedPolymarketMapping(
      fixtureState,
      resolvedMarket,
      homeTokenId,
      awayTokenId,
    )
  }

  private trackFixtureTokens(
    fixtureState: FixtureState,
    tokenId: string,
    normalizedSelection: string,
  ) {
    fixtureState.selectionToToken.set(normalizedSelection, tokenId)
    fixtureState.tokenToSelection.set(tokenId, normalizedSelection)
    this.tokenToFixture.set(tokenId, fixtureState.fixture.id)
    this.trackedTokenIds.add(tokenId)
  }

  private async applyResolvedPolymarketMapping(
    fixtureState: FixtureState,
    resolvedMarket: PolymarketMarketDetails,
    homeTokenId: string,
    awayTokenId: string,
  ) {
    this.trackFixtureTokens(
      fixtureState,
      homeTokenId,
      normalizeSelection(fixtureState.fixture.homeTeam),
    )
    this.trackFixtureTokens(
      fixtureState,
      awayTokenId,
      normalizeSelection(fixtureState.fixture.awayTeam),
    )

    if (
      fixtureState.fixture.polymarketEventSlug === resolvedMarket.eventSlug &&
      fixtureState.fixture.polymarketMarketSlug === resolvedMarket.marketSlug &&
      fixtureState.fixture.homeTokenId === homeTokenId &&
      fixtureState.fixture.awayTokenId === awayTokenId
    ) {
      this.status.trackedPolymarketTokens = this.trackedTokenIds.size
      this.subscribePolymarketTokens()
      return
    }

    fixtureState.fixture = {
      ...fixtureState.fixture,
      polymarketEventSlug: resolvedMarket.eventSlug,
      polymarketMarketSlug: resolvedMarket.marketSlug,
      polymarketConditionId: resolvedMarket.conditionId,
      homeTokenId,
      awayTokenId,
      updatedAt: new Date(),
    }

    await upsertFixture({
      id: fixtureState.fixture.id,
      opticOddsGameId: fixtureState.fixture.opticOddsGameId,
      sport: fixtureState.fixture.sport,
      league: fixtureState.fixture.league,
      homeTeam: fixtureState.fixture.homeTeam,
      awayTeam: fixtureState.fixture.awayTeam,
      homeTeamId: fixtureState.fixture.homeTeamId,
      awayTeamId: fixtureState.fixture.awayTeamId,
      startTime: fixtureState.fixture.startTime,
      status: fixtureState.fixture.status,
      isLive: fixtureState.fixture.isLive,
      venueName: fixtureState.fixture.venueName,
      venueLocation: fixtureState.fixture.venueLocation,
      polymarketEventSlug: fixtureState.fixture.polymarketEventSlug,
      polymarketMarketSlug: fixtureState.fixture.polymarketMarketSlug,
      polymarketConditionId: fixtureState.fixture.polymarketConditionId,
      homeTokenId: fixtureState.fixture.homeTokenId,
      awayTokenId: fixtureState.fixture.awayTokenId,
      lastScore: fixtureState.fixture.lastScore,
      lastPeriod: fixtureState.fixture.lastPeriod,
      lastResultPayload: fixtureState.fixture.lastResultPayload,
    })

    this.status.trackedPolymarketTokens = this.trackedTokenIds.size
    this.ensurePolymarketSocket()
    this.subscribePolymarketTokens()
  }

  private async applyFixtureStatusUpdate(update: OpticOddsFixtureStatusUpdate) {
    const fixtureState = this.fixtures.get(update.fixture_id)

    if (!fixtureState) {
      return
    }

    fixtureState.fixture = {
      ...fixtureState.fixture,
      status: update.new_status ?? fixtureState.fixture.status,
      startTime: update.new_start_date
        ? new Date(update.new_start_date)
        : fixtureState.fixture.startTime,
      updatedAt: new Date(),
    }

    await upsertFixture({
      id: fixtureState.fixture.id,
      opticOddsGameId: fixtureState.fixture.opticOddsGameId,
      sport: fixtureState.fixture.sport,
      league: fixtureState.fixture.league,
      homeTeam: fixtureState.fixture.homeTeam,
      awayTeam: fixtureState.fixture.awayTeam,
      homeTeamId: fixtureState.fixture.homeTeamId,
      awayTeamId: fixtureState.fixture.awayTeamId,
      startTime: fixtureState.fixture.startTime,
      status: fixtureState.fixture.status,
      isLive: fixtureState.fixture.isLive,
      venueName: fixtureState.fixture.venueName,
      venueLocation: fixtureState.fixture.venueLocation,
      polymarketEventSlug: fixtureState.fixture.polymarketEventSlug,
      polymarketMarketSlug: fixtureState.fixture.polymarketMarketSlug,
      polymarketConditionId: fixtureState.fixture.polymarketConditionId,
      homeTokenId: fixtureState.fixture.homeTokenId,
      awayTokenId: fixtureState.fixture.awayTokenId,
      lastScore: fixtureState.fixture.lastScore,
      lastPeriod: fixtureState.fixture.lastPeriod,
      lastResultPayload: fixtureState.fixture.lastResultPayload,
    })
  }

  private async applyFixtureResultsUpdate(update: OpticOddsResultUpdate) {
    const fixtureState = this.fixtures.get(update.fixture_id)

    if (!fixtureState) {
      return
    }

    fixtureState.fixture = {
      ...fixtureState.fixture,
      isLive: update.is_live,
      lastScore: stringifyScore(update.score),
      lastPeriod: stringifyPeriod(update.score) ?? fixtureState.fixture.lastPeriod,
      lastResultPayload: {
        score: update.score,
        player_results: update.player_results ?? [],
      },
      updatedAt: new Date(),
    }

    await upsertFixture({
      id: fixtureState.fixture.id,
      opticOddsGameId: fixtureState.fixture.opticOddsGameId,
      sport: fixtureState.fixture.sport,
      league: fixtureState.fixture.league,
      homeTeam: fixtureState.fixture.homeTeam,
      awayTeam: fixtureState.fixture.awayTeam,
      homeTeamId: fixtureState.fixture.homeTeamId,
      awayTeamId: fixtureState.fixture.awayTeamId,
      startTime: fixtureState.fixture.startTime,
      status: fixtureState.fixture.status,
      isLive: fixtureState.fixture.isLive,
      venueName: fixtureState.fixture.venueName,
      venueLocation: fixtureState.fixture.venueLocation,
      polymarketEventSlug: fixtureState.fixture.polymarketEventSlug,
      polymarketMarketSlug: fixtureState.fixture.polymarketMarketSlug,
      polymarketConditionId: fixtureState.fixture.polymarketConditionId,
      homeTokenId: fixtureState.fixture.homeTokenId,
      awayTokenId: fixtureState.fixture.awayTokenId,
      lastScore: fixtureState.fixture.lastScore,
      lastPeriod: fixtureState.fixture.lastPeriod,
      lastResultPayload: fixtureState.fixture.lastResultPayload,
    })
  }

  private ensurePolymarketSocket() {
    if (
      this.polymarketSocket &&
      (this.polymarketSocket.readyState === WebSocket.OPEN ||
        this.polymarketSocket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    const socket = new WebSocket(POLYMARKET_MARKET_WS_URL)

    socket.addEventListener("open", () => {
      this.status.polymarketConnectedAt = new Date().toISOString()
      this.subscribedTokenIds.clear()
      this.subscribePolymarketTokens(true)

      this.polymarketPingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send("PING")
        }
      }, POLYMARKET_PING_INTERVAL_MS)
    })

    socket.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : String(event.data)

      if (data === "PONG") {
        return
      }

      void this.handlePolymarketMessage(data)
    })

    socket.addEventListener("close", () => {
      if (this.polymarketPingTimer) {
        clearInterval(this.polymarketPingTimer)
        this.polymarketPingTimer = null
      }

      this.polymarketSocket = null

      if (this.started) {
        setTimeout(() => {
          this.ensurePolymarketSocket()
        }, POLYMARKET_RECONNECT_DELAY_MS)
      }
    })

    socket.addEventListener("error", (event) => {
      logger.warn("Polymarket market socket error", { event })
    })

    this.polymarketSocket = socket
  }

  private subscribePolymarketTokens(initial = false) {
    if (!this.polymarketSocket || this.polymarketSocket.readyState !== WebSocket.OPEN) {
      return
    }

    const tokens = Array.from(this.trackedTokenIds)

    if (tokens.length === 0) {
      return
    }

    if (initial) {
      this.polymarketSocket.send(
        JSON.stringify({
          assets_ids: tokens,
          type: "market",
          custom_feature_enabled: true,
        }),
      )

      for (const token of tokens) {
        this.subscribedTokenIds.add(token)
      }

      return
    }

    const newTokens = tokens.filter((token) => !this.subscribedTokenIds.has(token))

    if (newTokens.length === 0) {
      return
    }

    this.polymarketSocket.send(
      JSON.stringify({
        assets_ids: newTokens,
        operation: "subscribe",
        custom_feature_enabled: true,
      }),
    )

    for (const token of newTokens) {
      this.subscribedTokenIds.add(token)
    }
  }

  private async handlePolymarketMessage(rawMessage: string) {
    const parsed = JSON.parse(rawMessage) as unknown
    const messages = Array.isArray(parsed) ? parsed : [parsed]

    for (const message of messages) {
      const event = toJsonRecord(message)

      if (!event) {
        continue
      }

      const eventType = readText(event.event_type) ?? readText(event.type) ?? readText(event.event)

      if (!eventType) {
        continue
      }

      if (
        eventType !== "book" &&
        eventType !== "price_change" &&
        eventType !== "best_bid_ask" &&
        eventType !== "last_trade_price"
      ) {
        continue
      }

      this.status.lastPolymarketEventAt = new Date().toISOString()

      if (eventType === "price_change") {
        const priceChanges = Array.isArray(event.price_changes)
          ? event.price_changes
              .map((entry) => toJsonRecord(entry))
              .filter((entry): entry is JsonRecord => entry !== null)
          : []

        for (const change of priceChanges) {
          const tokenId =
            readText(change.asset_id) ?? readText(change.assetId) ?? readText(change.token_id)

          if (!tokenId) {
            continue
          }

          const fixtureId = this.tokenToFixture.get(tokenId)

          if (!fixtureId) {
            continue
          }

          const fixtureState = this.fixtures.get(fixtureId)

          if (!fixtureState) {
            continue
          }

          const existingBook = fixtureState.polymarketBooks.get(tokenId) ?? {
            tokenId,
            bestBid: null,
            bestAsk: null,
            lastTradePrice: null,
            bids: [],
            asks: [],
            updatedAt: new Date(),
          }

          existingBook.bestBid = readNumber(change.best_bid) ?? existingBook.bestBid
          existingBook.bestAsk = readNumber(change.best_ask) ?? existingBook.bestAsk
          existingBook.updatedAt = new Date()

          fixtureState.polymarketBooks.set(tokenId, existingBook)
          await this.evaluateSignals(fixtureState)
        }

        continue
      }

      const tokenId =
        readText(event.asset_id) ?? readText(event.assetId) ?? readText(event.token_id)

      if (!tokenId) {
        continue
      }

      const fixtureId = this.tokenToFixture.get(tokenId)

      if (!fixtureId) {
        continue
      }

      const fixtureState = this.fixtures.get(fixtureId)

      if (!fixtureState) {
        continue
      }

      const existingBook = fixtureState.polymarketBooks.get(tokenId) ?? {
        tokenId,
        bestBid: null,
        bestAsk: null,
        lastTradePrice: null,
        bids: [],
        asks: [],
        updatedAt: new Date(),
      }

      if (eventType === "book") {
        existingBook.bids = sortBidLevels(parseBookLevels(event.bids))
        existingBook.asks = sortAskLevels(parseBookLevels(event.asks))
        existingBook.bestBid = getBestBidFromLevels(existingBook.bids) ?? existingBook.bestBid
        existingBook.bestAsk = getBestAskFromLevels(existingBook.asks) ?? existingBook.bestAsk
      }

      if (eventType === "best_bid_ask") {
        existingBook.bestBid = readNumber(event.best_bid) ?? existingBook.bestBid
        existingBook.bestAsk = readNumber(event.best_ask) ?? existingBook.bestAsk
      }

      if (eventType === "last_trade_price") {
        existingBook.lastTradePrice =
          readNumber(event.price) ?? readNumber(event.last_trade_price) ?? existingBook.lastTradePrice
      }

      existingBook.updatedAt = new Date()
      fixtureState.polymarketBooks.set(tokenId, existingBook)
      await this.evaluateSignals(fixtureState)
    }
  }

  private async evaluateSignals(fixtureState: FixtureState) {
    const reference = this.buildReferenceProbabilities(fixtureState)

    if (!reference) {
      return
    }

    const polymarketBook = fixtureState.oddsByBook.get("polymarket")

    if (!polymarketBook) {
      return
    }

    for (const [selection, referenceProbability] of reference.probabilities.entries()) {
      const selectionSummary = this.buildSelectionSummary(
        fixtureState,
        referenceProbability,
        selection,
      )

      if (
        !selectionSummary ||
        selectionSummary.feeAdjustedEdgeBps === null ||
        selectionSummary.feeAdjustedEdgeBps < SIGNAL_THRESHOLD_BPS
      ) {
        fixtureState.lastSignals.delete(selection)
        continue
      }

      const now = Date.now()
      const previousSignal = fixtureState.lastSignals.get(selection)
      const currentSignal = {
        edgeToSnapshotBps: selectionSummary.snapshotEdgeBps,
        edgeToExecutableAskBps: selectionSummary.executableAskEdgeBps,
        feeAdjustedEdgeBps: selectionSummary.feeAdjustedEdgeBps,
        firstObservedAt:
          previousSignal && previousSignal.feeAdjustedEdgeBps !== null
            ? previousSignal.firstObservedAt
            : now,
        observedAt: now,
      } satisfies SignalState

      fixtureState.lastSignals.set(selection, currentSignal)

      if (now - currentSignal.firstObservedAt < OPPORTUNITY_PERSISTENCE_MS) {
        continue
      }

      if (
        previousSignal &&
        now - previousSignal.observedAt < 15_000 &&
        Math.abs(previousSignal.edgeToSnapshotBps - selectionSummary.snapshotEdgeBps) < 25 &&
        Math.abs(
          (previousSignal.feeAdjustedEdgeBps ?? 0) - (selectionSummary.feeAdjustedEdgeBps ?? 0),
        ) < 25
      ) {
        continue
      }

      const tokenId = fixtureState.selectionToToken.get(selection) ?? null

      await insertSignal({
        fixtureId: fixtureState.fixture.id,
        marketSlug: fixtureState.fixture.polymarketMarketSlug,
        selection,
        referenceSource: reference.source,
        referenceProbability,
        referenceTimestamp: reference.timestamp,
        polymarketPrice: selectionSummary.polymarketSnapshotPrice,
        polymarketBestLevel: selectionSummary.feeAdjustedAsk,
        polymarketTimestamp: new Date(),
        edgeToPriceBps: selectionSummary.snapshotEdgeBps,
        edgeToBestLevelBps: selectionSummary.feeAdjustedEdgeBps,
        details: {
          books: reference.books,
          referenceConfidence: reference.confidence,
          referenceBookCount: reference.bookCount,
          maxDispersionBps: reference.maxDispersionBps,
          fixture: `${fixtureState.fixture.homeTeam} vs ${fixtureState.fixture.awayTeam}`,
          polymarketTokenId: tokenId,
          directBestBid: selectionSummary.directBestBid,
          directBestAsk: selectionSummary.directBestAsk,
          executableBid: selectionSummary.executableBid,
          executableAsk: selectionSummary.executableAsk,
          feePerShare: selectionSummary.feePerShare,
          feeAdjustedAsk: selectionSummary.feeAdjustedAsk,
          feeAdjustedEdgeBps: selectionSummary.feeAdjustedEdgeBps,
          persistenceMs: now - currentSignal.firstObservedAt,
          syntheticAsk: selectionSummary.syntheticAsk,
          syntheticBid: selectionSummary.syntheticBid,
          opticOddsPolymarketPrice: selectionSummary.polymarketSnapshotPrice,
        },
      })

      logger.debug("Observed IPL signal candidate", {
        fixtureId: fixtureState.fixture.id,
        selection,
        referenceSource: reference.source,
        referenceConfidence: reference.confidence,
        edgeToSnapshotBps: selectionSummary.snapshotEdgeBps,
        edgeToExecutableAskBps: selectionSummary.executableAskEdgeBps,
        feeAdjustedEdgeBps: selectionSummary.feeAdjustedEdgeBps,
      })
    }
  }

  private buildFixtureSummary(fixtureState: FixtureState) {
    const reference = this.buildReferenceProbabilities(fixtureState)

    if (!reference) {
      return null
    }

    return {
      referenceSource: reference.source,
      referenceConfidence: reference.confidence,
      referenceBookCount: reference.bookCount,
      maxDispersionBps: reference.maxDispersionBps,
      contributions: reference.contributions,
      excludedBooks: reference.excludedBooks,
      selections: Array.from(reference.probabilities.entries())
        .map(([selection, referenceProbability]) =>
          this.buildSelectionSummary(fixtureState, referenceProbability, selection),
        )
        .filter((summary): summary is SelectionSummary => summary !== null),
    }
  }

  private buildFixtureOpportunities(
    fixtureState: FixtureState,
    minEdgeBps: number,
    minConfidence: ReferenceConfidence,
  ) {
    if (!fixtureState.fixture.isLive) {
      return []
    }

    const reference = this.buildReferenceProbabilities(fixtureState)

    if (!reference) {
      return []
    }

    if (referenceConfidenceRank(reference.confidence) < referenceConfidenceRank(minConfidence)) {
      return []
    }

    return Array.from(reference.probabilities.entries())
      .map(([selection, referenceProbability]) =>
        this.buildSelectionSummary(fixtureState, referenceProbability, selection),
      )
      .filter((summary): summary is SelectionSummary => summary !== null)
      .filter(
        (summary) =>
          summary.executableAsk !== null &&
          summary.feeAdjustedAsk !== null &&
          summary.feeAdjustedEdgeBps !== null &&
          summary.feeAdjustedEdgeBps >= minEdgeBps,
      )
      .flatMap((summary) => {
        const signalState = fixtureState.lastSignals.get(summary.selection)
        const persistenceMs = signalState ? Date.now() - signalState.firstObservedAt : 0
        const persistenceSatisfied = persistenceMs >= OPPORTUNITY_PERSISTENCE_MS

        if (
          summary.executableAsk === null ||
          summary.feeAdjustedAsk === null ||
          summary.feePerShare === null ||
          summary.feeAdjustedEdgeBps === null ||
          summary.executableAskSize === null ||
          summary.executableNotional === null ||
          !summary.depthSatisfied ||
          !persistenceSatisfied
        ) {
          return []
        }

        return [
          {
            fixtureId: fixtureState.fixture.id,
            fixture: `${fixtureState.fixture.homeTeam} vs ${fixtureState.fixture.awayTeam}`,
            marketSlug: fixtureState.fixture.polymarketMarketSlug,
            isLive: fixtureState.fixture.isLive,
            referenceSource: reference.source,
            referenceConfidence: reference.confidence,
            referenceBookCount: reference.bookCount,
            maxDispersionBps: reference.maxDispersionBps,
            selection: summary.selection,
            referenceProbability: summary.referenceProbability,
            executableAsk: summary.executableAsk,
            executableBid: summary.executableBid,
            executableAskSize: summary.executableAskSize,
            executableBidSize: summary.executableBidSize,
            executableNotional: summary.executableNotional,
            depthSatisfied: summary.depthSatisfied,
            feePerShare: summary.feePerShare,
            feeAdjustedAsk: summary.feeAdjustedAsk,
            feeAdjustedEdgeBps: summary.feeAdjustedEdgeBps,
            executableAskEdgeBps: summary.executableAskEdgeBps ?? summary.feeAdjustedEdgeBps,
            snapshotEdgeBps: summary.snapshotEdgeBps,
            persistenceMs,
            persistenceSatisfied,
            score: fixtureState.fixture.lastScore,
            period: fixtureState.fixture.lastPeriod,
            updatedAt: fixtureState.fixture.updatedAt.toISOString(),
          } satisfies OpportunitySummary,
        ]
      })
  }

  private buildSelectionSummary(
    fixtureState: FixtureState,
    referenceProbability: number,
    selection: string,
  ): SelectionSummary | null {
    const polymarketBook = fixtureState.oddsByBook.get("polymarket")
    const polymarketOddState = polymarketBook?.get(selection)

    const tokenId = fixtureState.selectionToToken.get(selection)
    const directBook = tokenId ? fixtureState.polymarketBooks.get(tokenId) : null

    if (
      (!polymarketOddState || polymarketOddState.isLocked) &&
      (!directBook || Date.now() - directBook.updatedAt.getTime() > ODDS_STALENESS_MS)
    ) {
      return null
    }

    if (
      polymarketOddState &&
      Date.now() - polymarketOddState.observedAt.getTime() > ODDS_STALENESS_MS &&
      (!directBook || Date.now() - directBook.updatedAt.getTime() > ODDS_STALENESS_MS)
    ) {
      return null
    }

    const oppositeSelection = Array.from(fixtureState.selectionToToken.keys()).find(
      (candidate) => candidate !== selection,
    )
    const oppositeTokenId = oppositeSelection
      ? fixtureState.selectionToToken.get(oppositeSelection)
      : null
    const oppositeBook = oppositeTokenId
      ? fixtureState.polymarketBooks.get(oppositeTokenId)
      : null
    const directMidpoint =
      directBook?.bestBid !== null &&
      directBook?.bestBid !== undefined &&
      directBook?.bestAsk !== null &&
      directBook?.bestAsk !== undefined
        ? clampProbability((directBook.bestBid + directBook.bestAsk) / 2)
        : null
    const directBestBidSize = getBestBidSizeFromLevels(directBook?.bids ?? [])
    const directBestAskSize = getBestAskSizeFromLevels(directBook?.asks ?? [])
    const fallbackCandidates = [
      directMidpoint,
      isUsablePolymarketAsk(directBook?.bestAsk ?? null) ? (directBook?.bestAsk ?? null) : null,
      isUsablePolymarketBid(directBook?.bestBid ?? null) ? (directBook?.bestBid ?? null) : null,
      isUsablePolymarketAsk(directBook?.lastTradePrice ?? null)
        ? (directBook?.lastTradePrice ?? null)
        : null,
    ]
    const fallbackSnapshotPrice =
      fallbackCandidates.find((value): value is number => value !== null) ?? null
    const polymarketSnapshotPrice = polymarketOddState
      ? normaliseProbability(polymarketOddState.odd.price)
      : fallbackSnapshotPrice

    if (polymarketSnapshotPrice === null) {
      return null
    }

    const syntheticAsk = isUsablePolymarketBid(oppositeBook?.bestBid ?? null)
      ? clampProbability(1 - (oppositeBook?.bestBid ?? 0))
      : null
    const syntheticAskSize = getBestBidSizeFromLevels(oppositeBook?.bids ?? [])
    const syntheticBid = isUsablePolymarketAsk(oppositeBook?.bestAsk ?? null)
      ? clampProbability(1 - (oppositeBook?.bestAsk ?? 1))
      : null
    const syntheticBidSize = getBestAskSizeFromLevels(oppositeBook?.asks ?? [])
    const opticOddsAsk = polymarketOddState
      ? normaliseProbability(getBestAvailableLevel(polymarketOddState.odd) ?? 0)
      : null
    const executableAsk = minNullable(
      isUsablePolymarketAsk(directBook?.bestAsk ?? null) ? directBook?.bestAsk ?? null : null,
      syntheticAsk,
      opticOddsAsk !== null && opticOddsAsk > 0 && opticOddsAsk < 1 ? opticOddsAsk : null,
    )
    const executableAskSize =
      executableAsk === null
        ? null
        : executableAsk === directBook?.bestAsk
          ? directBestAskSize
          : executableAsk === syntheticAsk
            ? syntheticAskSize
            : MIN_EXECUTABLE_SHARES
    const executableBid = maxNullable(
      isUsablePolymarketBid(directBook?.bestBid ?? null) ? directBook?.bestBid ?? null : null,
      syntheticBid,
    )
    const executableBidSize =
      executableBid === null
        ? null
        : executableBid === directBook?.bestBid
          ? directBestBidSize
          : executableBid === syntheticBid
            ? syntheticBidSize
            : null
    const executableNotional =
      executableAsk !== null && executableAskSize !== null ? executableAsk * executableAskSize : null
    const depthSatisfied =
      executableAskSize !== null &&
      executableNotional !== null &&
      executableAskSize >= MIN_EXECUTABLE_SHARES &&
      executableNotional >= MIN_EXECUTABLE_NOTIONAL_USDC
    const feePerShare =
      executableAsk === null ? null : estimateSportsTakerFeePerShare(executableAsk)
    const feeAdjustedAsk =
      executableAsk === null || feePerShare === null ? null : executableAsk + feePerShare

    return {
      selection,
      referenceProbability,
      polymarketSnapshotPrice,
      executableAsk,
      executableBid,
      syntheticAsk,
      syntheticBid,
      directBestBid: directBook?.bestBid ?? null,
      directBestAsk: directBook?.bestAsk ?? null,
      directBestBidSize,
      directBestAskSize,
      syntheticAskSize,
      syntheticBidSize,
      executableAskSize,
      executableBidSize,
      executableNotional,
      depthSatisfied,
      feePerShare,
      feeAdjustedAsk,
      feeAdjustedEdgeBps:
        feeAdjustedAsk === null ? null : Math.round((referenceProbability - feeAdjustedAsk) * 10_000),
      snapshotEdgeBps: Math.round((referenceProbability - polymarketSnapshotPrice) * 10_000),
      executableAskEdgeBps:
        executableAsk === null
          ? null
          : Math.round((referenceProbability - executableAsk) * 10_000),
    }
  }

  private buildReferenceProbabilities(fixtureState: FixtureState) {
    const { books, excludedBooks } = this.collectReferenceBooks(fixtureState)

    const anchorBook = books.find((book) => book.bookId === PRIMARY_REFERENCE_BOOK)

    if (!anchorBook) {
      return null
    }

    const supportBooks = books.filter((book) => book.bookId !== PRIMARY_REFERENCE_BOOK)
    const usableSupportBooks = supportBooks.filter((book) =>
      Array.from(anchorBook.probabilities.entries()).every(([selection, probability]) => {
        const supportProbability = book.probabilities.get(selection)

        if (supportProbability === undefined) {
          return false
        }

        return Math.abs(supportProbability - probability) * 10_000 <= REFERENCE_OUTLIER_BPS
      }),
    )

    const usableBooks = [anchorBook, ...usableSupportBooks]
    const usableBookIds = new Set(usableBooks.map((book) => book.bookId))
    const allExcludedBooks = [
      ...excludedBooks,
      ...supportBooks
        .filter((book) => !usableBookIds.has(book.bookId))
        .map(
          (book) =>
            ({
              bookId: book.bookId,
              reason: "support-disagrees-with-betfair",
            }) satisfies ExcludedReferenceBook,
        ),
    ]

    const probabilities = new Map(anchorBook.probabilities)
    const latestTimestamp = Math.max(...usableBooks.map((book) => book.updatedAt.getTime()))

    if (probabilities.size < 2) {
      return null
    }

    const maxDispersionBps = this.calculateReferenceDispersionBps(usableBooks)
    const bookIds = usableBooks.map((book) => book.bookId)

    return {
      source: PRIMARY_REFERENCE_BOOK,
      books: bookIds,
      probabilities,
      timestamp: new Date(latestTimestamp),
      confidence: classifyReferenceConfidence(usableSupportBooks.length, maxDispersionBps),
      bookCount: usableBooks.length,
      maxDispersionBps,
      contributions: usableBooks.map((book) => ({
        bookId: book.bookId,
        weight: book.weight,
        overround: Number(book.overround.toFixed(4)),
        updatedAt: book.updatedAt.toISOString(),
        probabilities: mapToRoundedRecord(book.probabilities),
      })),
      excludedBooks: allExcludedBooks,
    } satisfies ReferenceBlend
  }

  private collectReferenceBooks(fixtureState: FixtureState) {
    const excludedBooks: ExcludedReferenceBook[] = []
    const books: Array<{
      bookId: string
      weight: number
      overround: number
      updatedAt: Date
      probabilities: Map<string, number>
    }> = []

    const configuredBooks: Array<[string, number]> = [
      [PRIMARY_REFERENCE_BOOK, 5],
      ...Object.entries(SUPPORT_REFERENCE_BOOK_WEIGHTS),
    ]

    for (const [bookId, bookWeight] of configuredBooks) {
      const selections = fixtureState.oddsByBook.get(bookId)

      if (!selections) {
        excludedBooks.push({ bookId, reason: "missing-book" })
        continue
      }

      const activeSelections = Array.from(selections.values()).filter(
        (entry) =>
          !entry.isLocked && Date.now() - entry.observedAt.getTime() <= ODDS_STALENESS_MS,
      )

      if (activeSelections.length < 2) {
        const hasLockedSelection = Array.from(selections.values()).some((entry) => entry.isLocked)
        const hasFreshSelection = Array.from(selections.values()).some(
          (entry) => Date.now() - entry.observedAt.getTime() <= ODDS_STALENESS_MS,
        )

        excludedBooks.push({
          bookId,
          reason: hasLockedSelection
            ? "locked-market"
            : hasFreshSelection
              ? "incomplete-selections"
              : "stale-book",
        })
        continue
      }

      const normalizedPrices = activeSelections.map((entry) => normaliseProbability(entry.odd.price))
      const overround = normalizedPrices.reduce((sum, probability) => sum + probability, 0)

      if (overround <= 0) {
        excludedBooks.push({ bookId, reason: "invalid-overround" })
        continue
      }

      const probabilities = new Map<string, number>()
      const firstSelection = activeSelections[0]

      if (!firstSelection) {
        continue
      }

      for (const entry of activeSelections) {
        probabilities.set(entry.odd.normalized_selection, normaliseProbability(entry.odd.price) / overround)
      }

      books.push({
        bookId,
        weight: bookWeight,
        overround,
        updatedAt: activeSelections.reduce(
          (latest, entry) =>
            entry.observedAt.getTime() > latest.getTime() ? entry.observedAt : latest,
          firstSelection.observedAt,
        ),
        probabilities,
      })
    }

    return { books, excludedBooks }
  }

  private trimOutlierReferenceBooks(
    books: Array<{
      bookId: string
      weight: number
      overround: number
      updatedAt: Date
      probabilities: Map<string, number>
    }>,
  ) {
    if (books.length < 3) {
      return books
    }

    const selectionNames = Array.from(books[0]?.probabilities.keys() ?? [])
    const medians = new Map<string, number>()

    for (const selection of selectionNames) {
      const values = books
        .map((book) => book.probabilities.get(selection))
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right)

      if (values.length === 0) {
        continue
      }

      const middle = Math.floor(values.length / 2)
      const median =
        values.length % 2 === 0
          ? ((values[middle - 1] ?? values[middle] ?? 0) + (values[middle] ?? 0)) / 2
          : values[middle]

      if (median !== undefined) {
        medians.set(selection, median)
      }
    }

    const filtered = books.filter((book) =>
      selectionNames.every((selection) => {
        const median = medians.get(selection)
        const probability = book.probabilities.get(selection)

        if (median === undefined || probability === undefined) {
          return false
        }

        return Math.abs(probability - median) * 10_000 <= REFERENCE_OUTLIER_BPS
      }),
    )

    return filtered.length >= 2 ? filtered : books
  }

  private calculateReferenceDispersionBps(
    books: Array<{
      bookId: string
      weight: number
      overround: number
      updatedAt: Date
      probabilities: Map<string, number>
    }>,
  ) {
    const selections = Array.from(books[0]?.probabilities.keys() ?? [])
    let maxDispersionBps = 0

    for (const selection of selections) {
      const values = books
        .map((book) => book.probabilities.get(selection))
        .filter((value): value is number => value !== undefined)

      if (values.length < 2) {
        continue
      }

      const dispersionBps = Math.round((Math.max(...values) - Math.min(...values)) * 10_000)
      maxDispersionBps = Math.max(maxDispersionBps, dispersionBps)
    }

    return maxDispersionBps
  }

  private buildPublicFixture(fixture: ObserverFixtureRecord) {
    return {
      id: fixture.id,
      opticOddsGameId: fixture.opticOddsGameId,
      sport: fixture.sport,
      league: fixture.league,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      startTime: fixture.startTime,
      status: fixture.status,
      isLive: fixture.isLive,
      venueName: fixture.venueName,
      venueLocation: fixture.venueLocation,
      score: fixture.lastScore,
      period: fixture.lastPeriod,
      market: {
        eventSlug: fixture.polymarketEventSlug,
        marketSlug: fixture.polymarketMarketSlug,
        conditionId: fixture.polymarketConditionId,
        homeTokenId: fixture.homeTokenId,
        awayTokenId: fixture.awayTokenId,
      },
      updatedAt: fixture.updatedAt,
    }
  }

  private buildFixtureMonitoringState(
    fixture: ObserverFixtureRecord,
    liveState: FixtureState | undefined,
  ) {
    const reasons: string[] = []
    const mappingCoverage = requiresMappingCoverage(fixture)
    const activeOddsCoverage = requiresActiveOddsCoverage(fixture)
    const startsInSeconds = Math.max(
      0,
      Math.round((fixture.startTime.getTime() - Date.now()) / 1000),
    )

    if (!liveState && mappingCoverage) {
      reasons.push("fixture-not-loaded-in-memory")
    }

    if (
      mappingCoverage &&
      (!fixture.polymarketMarketSlug || !fixture.homeTokenId || !fixture.awayTokenId)
    ) {
      reasons.push("missing-polymarket-mapping")
    }

    if (fixture.isLive && liveState && liveState.polymarketBooks.size === 0) {
      reasons.push("no-polymarket-ws-book")
    }

    if (activeOddsCoverage && liveState && !this.buildReferenceProbabilities(liveState)) {
      reasons.push(fixture.isLive ? "no-usable-reference-books" : "reference-market-not-ready-yet")
    }

    return {
      mode: fixture.isLive ? "live" : mappingCoverage ? "upcoming" : "future",
      requiresActiveCoverage: activeOddsCoverage,
      startsInSeconds,
      isTrackedInMemory: Boolean(liveState),
      hasPolymarketMapping: Boolean(
        fixture.polymarketMarketSlug && fixture.homeTokenId && fixture.awayTokenId,
      ),
      hasPolymarketBook: Boolean(liveState && liveState.polymarketBooks.size > 0),
      hasReferenceBlend: Boolean(liveState && this.buildReferenceProbabilities(liveState)),
      reasons,
    }
  }

  private buildBookViews(odds: Awaited<ReturnType<typeof listFixtureOdds>>) {
    type BookView = {
      sportsbookId: string
      sportsbook: string
      isLocked: boolean
      isFresh: boolean
      updatedAt: string
      selections: Array<{
        selection: string
        normalizedSelection: string
        probability: number
        topLevel: number | null
        maxStake: number | null
      }>
    }

    const grouped = new Map<string, BookView>()

    for (const odd of odds) {
      const existing = grouped.get(odd.sportsbookId) ?? {
        sportsbookId: odd.sportsbookId,
        sportsbook: odd.sportsbook,
        isLocked: false,
        isFresh: true,
        updatedAt: odd.updatedAt.toISOString(),
        selections: [],
      }

      existing.isLocked = existing.isLocked || odd.isLocked
      existing.isFresh =
        existing.isFresh && Date.now() - odd.updatedAt.getTime() <= ODDS_STALENESS_MS
      existing.updatedAt =
        new Date(existing.updatedAt).getTime() > odd.updatedAt.getTime()
          ? existing.updatedAt
          : odd.updatedAt.toISOString()
      existing.selections.push({
        selection: odd.selection,
        normalizedSelection: odd.normalizedSelection,
        probability: odd.priceProbability,
        topLevel:
          Array.isArray(odd.orderBook) && odd.orderBook.length > 0
            ? normaliseProbability(Number((odd.orderBook[0] as OrderBookLevel)[0]))
            : null,
        maxStake: odd.maxStake,
      })

      grouped.set(odd.sportsbookId, existing)
    }

    return Array.from(grouped.values())
      .map((book) => ({
        ...book,
        selections: book.selections.sort((left, right) =>
          left.normalizedSelection.localeCompare(right.normalizedSelection),
        ),
      }))
      .sort((left, right) => left.sportsbookId.localeCompare(right.sportsbookId))
  }
}

const normalizeSelection = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_")

const readText = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : null

const readNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const stringifyScore = (score: unknown) => {
  if (!score) {
    return null
  }

  const scoreRecord = toJsonRecord(score)

  if (!scoreRecord) {
    return JSON.stringify(score)
  }

  const nestedScores = toJsonRecord(scoreRecord.scores)

  if (nestedScores) {
    const nestedHomeScore = toJsonRecord(nestedScores.home)?.total
    const nestedAwayScore = toJsonRecord(nestedScores.away)?.total

    if (typeof nestedHomeScore === "number" && typeof nestedAwayScore === "number") {
      return `${nestedHomeScore}-${nestedAwayScore}`
    }
  }

  const homeScore = toJsonRecord(scoreRecord.home)?.total
  const awayScore = toJsonRecord(scoreRecord.away)?.total

  if (typeof homeScore === "number" && typeof awayScore === "number") {
    return `${homeScore}-${awayScore}`
  }

  return JSON.stringify(score)
}

const stringifyPeriod = (score: unknown) => {
  const scoreRecord = toJsonRecord(score)
  const inPlay = scoreRecord ? toJsonRecord(scoreRecord.in_play) : null

  if (!inPlay) {
    return null
  }

  const period = readText(inPlay.period)
  const clock = readText(inPlay.clock)

  if (!period && !clock) {
    return null
  }

  return [period, clock].filter(Boolean).join(" ")
}

const classifyReferenceConfidence = (
  supportBookCount: number,
  maxDispersionBps: number,
): ReferenceConfidence => {
  if (supportBookCount >= 2 && maxDispersionBps <= 250) {
    return "high"
  }

  if (supportBookCount >= 1 && maxDispersionBps <= 300) {
    return "medium"
  }

  return "low"
}

const referenceConfidenceRank = (value: ReferenceConfidence) => {
  switch (value) {
    case "high":
      return 3
    case "medium":
      return 2
    default:
      return 1
  }
}

const mapToRoundedRecord = (map: Map<string, number>) =>
  Object.fromEntries(
    Array.from(map.entries()).map(([key, value]) => [key, Number(value.toFixed(6))]),
  )

const parseTokenIdList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? [item] : []))
  }

  if (typeof value !== "string") {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => (typeof item === "string" ? [item] : []))
      : []
  } catch {
    return []
  }
}

const parseStringList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? [item] : []))
  }

  if (typeof value !== "string") {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => (typeof item === "string" ? [item] : []))
      : []
  } catch {
    return []
  }
}

export const observerService = new IplObserverService()
