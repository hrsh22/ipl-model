import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import logger from "../logger.js"
import { config } from "../config.js"
import { getVenueContextStats } from "./venue-stats.js"
import { normalizeTeamName } from "../model-data/aliases.js"
import {
  getCheckpoint,
  getFixture,
  getLiveFixtureByTeams,
  insertLiveModelSignal,
  insertLiveModelSnapshot,
  insertSignal,
  listFixtureLiveModelSignals,
  listFixtureLiveModelSnapshots,
  listFixtureOdds,
  listFixtureSignals,
  listFixtures,
  listLiveModelSignals,
  listLiveModelSnapshots,
  listSignals,
  type ObserverFixtureRecord,
  upsertCheckpoint,
  upsertFixture,
  upsertOdd,
} from "./repository.js"

const OPTICODDS_BASE_URL = "https://api.opticodds.com/api/v3"
const POLYMARKET_GAMMA_BASE_URL = "https://gamma-api.polymarket.com"
const POLYMARKET_CLOB_BASE_URL = "https://clob.polymarket.com"
const POLYMARKET_MARKET_WS_URL =
  "wss://ws-subscriptions-clob.polymarket.com/ws/market"
const currentDirectory = dirname(fileURLToPath(import.meta.url))
const LOCAL_UPCOMING_FIXTURES_PATH = join(
  currentDirectory,
  "..",
  "..",
  "model",
  "data",
  "live",
  "upcoming_fixtures.json",
)

const IPL_LEAGUE_NAME = "India - IPL"
const MONEYLINE_MARKET = "Moneyline"
const CHECKPOINT_ODDS_STREAM = "opticodds:ipl:moneyline:odds"
const CHECKPOINT_RESULTS_STREAM = "opticodds:ipl:results"

const SIGNAL_THRESHOLD_BPS = 100
const ODDS_STALENESS_MS = 30_000
const LIVE_MODEL_DISPLAY_ODDS_STALENESS_MS = 30 * 60 * 1000
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
const ACTIVE_COVERAGE_POST_START_GRACE_MS = 6 * 60 * 60 * 1000
const LIVE_FIXTURE_STALENESS_MS = 45 * 60 * 1000
const MIN_EXECUTABLE_SHARES = 100
const MIN_EXECUTABLE_NOTIONAL_USDC = 25
const READY_MAX_FIXTURE_REFRESH_AGE_SECONDS = 180
const READY_MAX_STREAM_AGE_SECONDS = 45
const LIVE_MODEL_VERSION = "ball-state-runtime-v1"
const LIVE_MODEL_SNAPSHOT_INTERVAL_MS = 15_000
const LIVE_MODEL_SIGNAL_THRESHOLD_BPS = 500
const OFFICIAL_LIVE_RESULT_HYDRATE_INTERVAL_MS = 5_000
const POLYMARKET_BOOK_HYDRATE_INTERVAL_MS = 5_000
const IPLT20_INNINGS_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{match_id}-Innings{innings}.js"

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
  "polymarket",
] as const

const PRIMARY_REFERENCE_BOOK = "betfair_exchange"

const SUPPORT_REFERENCE_BOOK_WEIGHTS: Record<string, number> = {
  "1xbet": 3,
  parimatch_india_: 2,
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

type LocalFixtureRow = {
  fixture_id?: string | number | null
  opticodds_game_id?: string | number | null
  match_date?: string | null
  status?: string | null
  is_live?: boolean | string | number | null
  official_match_id?: string | number | null
  venue?: string | null
  venue_location?: string | null
  city?: string | null
  team1?: string | null
  team2?: string | null
  inferred_home_team?: string | null
}

type ObserverFixtureCore = Omit<ObserverFixtureRecord, "createdAt" | "updatedAt">

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

type OfficialInningsPayload = {
  OverHistory?: JsonRecord[]
}

type OfficialInningsSummary = {
  innings: 1 | 2
  battingTeam: string | null
  bowlingTeam: string | null
  runs: number
  wickets: number | null
  balls: number
  oversLabel: string
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

type ParsedCricketState = {
  innings: number | null
  battingTeam: string | null
  bowlingTeam: string | null
  scoreRuns: number | null
  scoreWickets: number | null
  overs: number | null
  balls: number | null
  targetRuns: number | null
}

type LiveExpectedState = ParsedCricketState & {
  expectedRunsNow: number | null
  expectedWicketsNow: number | null
  runsDelta: number | null
  wicketsDelta: number | null
  projectedScore: number | null
  expectedRunRate: number | null
  battingTeamWinProbability: number | null
  chaseSuccessProbability: number | null
}

type InningsExpectedState = LiveExpectedState & {
  status: "live" | "frozen" | "pending" | "unavailable"
}

type LiveInningsExpectedStates = {
  activeInnings: number | null
  first: InningsExpectedState
  second: InningsExpectedState
}

type LiveSelectionView = {
  selection: string
  fairProbability: number
  marketProbability: number
  referenceProbability: number
  executableAsk: number | null
  executableBid: number | null
  edgeVsMarketBps: number
  edgeVsExecutableAskBps: number | null
  feeAdjustedEdgeBps: number | null
}

export type BallStateLiveModelOverlay = {
  available: boolean
  currentState: {
    fixtureId: string | null
    innings: number | null
    battingTeam: string | null
    bowlingTeam: string | null
    scoreRuns: number | null
    scoreWickets: number | null
    balls: number | null
  }
  predictions: {
    expectedRunsNow: number | null
    expectedWicketsNow: number | null
    runsDelta: number | null
    wicketsDelta: number | null
    finalInningsRuns: number | null
    battingTeamMatchWinProbability: number | null
    chaseSuccessProbability: number | null
  }
}

type BallStateLiveModelOverlayInput = BallStateLiveModelOverlay | BallStateLiveModelOverlay[]

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

const isWithinActiveCoverageWindow = (fixture: ObserverFixtureRecord, lookaheadMs: number) => {
  const startsInMs = fixture.startTime.getTime() - Date.now()
  return startsInMs <= lookaheadMs && startsInMs >= -ACTIVE_COVERAGE_POST_START_GRACE_MS
}

const isFreshLiveFixture = (fixture: ObserverFixtureRecord) =>
  Date.now() - fixture.updatedAt.getTime() <= LIVE_FIXTURE_STALENESS_MS

const requiresMappingCoverage = (fixture: ObserverFixtureRecord) =>
  fixture.isLive || isWithinActiveCoverageWindow(fixture, MAPPING_LOOKAHEAD_MS)

const requiresActiveOddsCoverage = (fixture: ObserverFixtureRecord) =>
  fixture.isLive || isWithinActiveCoverageWindow(fixture, ACTIVE_ODDS_LOOKAHEAD_MS)

const requiresLiveModelCoverage = (fixture: ObserverFixtureRecord) =>
  fixture.isLive ? isFreshLiveFixture(fixture) : requiresActiveOddsCoverage(fixture)

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

const cleanLocalValue = (value: string | number | null | undefined) => String(value ?? "").trim()

const parseLocalBoolean = (value: boolean | string | number | null | undefined) => {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    return value !== 0
  }

  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase())
}

const buildSyntheticFixtureSourceId = (fixtureId: string, officialMatchId: string) =>
  `ipl-official:${officialMatchId || fixtureId}`

class IplObserverService {
  private started = false

  private readonly fixtures = new Map<string, FixtureState>()

  private readonly tokenToFixture = new Map<string, string>()

  private readonly trackedTokenIds = new Set<string>()

  private readonly subscribedTokenIds = new Set<string>()

  private readonly lastLiveModelSnapshotAt = new Map<string, number>()

  private readonly lastLiveModelSignalAt = new Map<string, { edgeBps: number; observedAt: number }>()

  private readonly officialLiveResultHydratedAt = new Map<string, number>()

  private readonly polymarketBookHydratedAt = new Map<string, number>()

  private liveModelPersistenceDisabledReason: string | null = null

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

    await this.refreshFixtures()

    this.refreshTimer = setInterval(() => {
      void this.refreshFixtures().catch((error) => {
        logger.warn("IPL observer fixture refresh failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, FIXTURE_REFRESH_INTERVAL_MS)

    if (config.opticOddsEnabled) {
      this.activeCoverageTimer = setInterval(() => {
        void this.reconcileActiveCoverageFixtures().catch((error) => {
          logger.warn("IPL observer active fixture reconciliation failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }, ACTIVE_FIXTURE_RECONCILIATION_INTERVAL_MS)

      void this.runOddsStream()
      void this.runResultsStream()
    } else {
      logger.warn("Started IPL observer with OpticOdds disabled; bootstrapping fixtures from local official IPL data")
    }

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

  public async getRecentLiveModelSnapshots(limit = 50) {
    try {
      return await listLiveModelSnapshots(limit)
    } catch (error) {
      this.disableLiveModelPersistence(error)
      return []
    }
  }

  public async getRecentLiveModelSignals(limit = 50) {
    try {
      return (await listLiveModelSignals(Math.max(limit * 5, 50)))
        .filter(isMeaningfulLiveModelSignal)
        .filter(dedupeLiveModelSignalRecord)
        .slice(0, limit)
    } catch (error) {
      this.disableLiveModelPersistence(error)
      return []
    }
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
      .filter((fixtureState) => fixtureState.fixture.isLive && isFreshLiveFixture(fixtureState.fixture))
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

  public async getLiveModelFixtures(ballStateOverlay?: BallStateLiveModelOverlayInput) {
    await this.hydrateOfficialLiveResultsForLiveModel()
    await this.hydratePolymarketBooksForLiveModel()

    return Array.from(this.fixtures.values())
      .filter((fixtureState) => requiresLiveModelCoverage(fixtureState.fixture))
      .map((fixtureState) => this.buildLiveModelView(fixtureState, "api-read", ballStateOverlay))
      .sort(
        (left, right) =>
          new Date(right.fixture.updatedAt).getTime() - new Date(left.fixture.updatedAt).getTime(),
      )
  }

  public async recordRuntimeLiveModelSnapshots(ballStateOverlay?: BallStateLiveModelOverlayInput) {
    if (!ballStateOverlay) {
      return
    }

    const overlays = Array.isArray(ballStateOverlay) ? ballStateOverlay : [ballStateOverlay]
    await Promise.all(overlays.map(async (overlay) => {
      const fixtureState = Array.from(this.fixtures.values())
        .find((candidate) => getMatchingBallStateOverlay(candidate.fixture, overlay) !== null)
      if (fixtureState) {
        await this.recordLiveModelSnapshot(fixtureState, "ball-state-runtime", overlay)
      }
    }))
  }

  private async hydrateOfficialLiveResultsForLiveModel() {
    const liveOfficialFixtures = Array.from(this.fixtures.values())
      .filter((fixtureState) => fixtureState.fixture.isLive)
      .flatMap((fixtureState) => {
        const officialMatchId = getOfficialMatchId(fixtureState.fixture.lastResultPayload)
        return officialMatchId ? [{ fixtureState, officialMatchId }] : []
      })

    await Promise.all(liveOfficialFixtures.map(async ({ fixtureState, officialMatchId }) => {
      const previousHydratedAt = this.officialLiveResultHydratedAt.get(fixtureState.fixture.id) ?? 0
      if (Date.now() - previousHydratedAt < OFFICIAL_LIVE_RESULT_HYDRATE_INTERVAL_MS) {
        return
      }

      this.officialLiveResultHydratedAt.set(fixtureState.fixture.id, Date.now())

      try {
        const officialScore = await fetchOfficialLiveScorePayload(fixtureState.fixture, officialMatchId)
        if (!officialScore) {
          return
        }

        fixtureState.fixture = {
          ...fixtureState.fixture,
          lastScore: stringifyScore(officialScore),
          lastPeriod: stringifyPeriod(officialScore) ?? fixtureState.fixture.lastPeriod,
          lastResultPayload: officialScore,
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
      } catch (error) {
        logger.warn("Failed to hydrate official IPL live score for live model", {
          fixtureId: fixtureState.fixture.id,
          officialMatchId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      }))
  }

  private async hydratePolymarketBooksForLiveModel() {
    const fixtureStates = Array.from(this.fixtures.values())
      .filter((fixtureState) => requiresLiveModelCoverage(fixtureState.fixture))

    await Promise.all(fixtureStates.map(async (fixtureState) => {
      const previousHydratedAt = this.polymarketBookHydratedAt.get(fixtureState.fixture.id) ?? 0
      if (Date.now() - previousHydratedAt < POLYMARKET_BOOK_HYDRATE_INTERVAL_MS) {
        return
      }

      this.polymarketBookHydratedAt.set(fixtureState.fixture.id, Date.now())

      try {
        await this.ensureFixturePolymarketMapping(fixtureState)
        const tokenIds = [fixtureState.fixture.homeTokenId, fixtureState.fixture.awayTokenId]
          .filter((tokenId): tokenId is string => Boolean(tokenId))

        await Promise.all(tokenIds.map(async (tokenId) => {
          const book = await fetchPolymarketBookSnapshot(tokenId)
          if (!book) {
            return
          }

          fixtureState.polymarketBooks.set(tokenId, book)
        }))
      } catch (error) {
        logger.warn("Failed to hydrate Polymarket book for live model", {
          fixtureId: fixtureState.fixture.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }))
  }

  public async getLiveModelHistory(limit = 20) {
    const fixtures = (await listFixtures(Math.max(limit * 6, 60))).filter(
      (fixture) => !fixture.isLive,
    )
    const historyEntries = await Promise.all(
      fixtures.map(async (fixture) => {
        const [snapshots, signals] = await Promise.all([
          this.getFixtureLiveModelSnapshotsSafe(fixture.id, 500),
          this.getFixtureLiveModelSignalsSafe(fixture.id, 5),
        ])
        const meaningfulSnapshots = snapshots.filter(isMeaningfulLiveModelSnapshot)
        const latestSnapshot = meaningfulSnapshots[0] ?? null
        const inningsSnapshots = buildLatestSnapshotsByInnings(meaningfulSnapshots)
        const inningsStates = buildLiveInningsExpectedStates(fixture)
        const hasFixtureInningsState =
          hasMeaningfulExpectedState(inningsStates.first) || hasMeaningfulExpectedState(inningsStates.second)

        if (!latestSnapshot && !hasFixtureInningsState) {
          return null
        }

        return {
          fixture: this.buildPublicFixture(fixture),
          venueContext: getVenueContextStats(fixture.venueName),
          latestSnapshot,
          inningsSnapshots,
          inningsStates,
          recentSignals: signals
            .filter(isMeaningfulLiveModelSignal)
            .filter(dedupeLiveModelSignalRecord),
          snapshotCountKnown: Boolean(latestSnapshot),
          signalCount: signals
            .filter(isMeaningfulLiveModelSignal)
            .filter(dedupeLiveModelSignalRecord).length,
        }
      }),
    )

    return historyEntries
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => {
        const leftTime = left.latestSnapshot?.createdAt ?? left.fixture.updatedAt
        const rightTime = right.latestSnapshot?.createdAt ?? right.fixture.updatedAt
        return new Date(rightTime).getTime() - new Date(leftTime).getTime()
      })
      .slice(0, limit)
  }

  public getReadiness() {
    if (!config.opticOddsEnabled) {
      const reasons: string[] = []
      const fixtureRefreshAge = toAgeSeconds(this.status.fixtureRefreshAt)

      if (!this.started) {
        reasons.push("observer-not-started")
      }

      if (fixtureRefreshAge === null || fixtureRefreshAge > READY_MAX_FIXTURE_REFRESH_AGE_SECONDS) {
        reasons.push("fixture-refresh-stale")
      }

      if (this.fixtures.size === 0) {
        reasons.push("no-fixtures-loaded")
      }

      return {
        ready: reasons.length === 0,
        mode: "official-fixtures-no-opticodds",
        degraded: true,
        degradationReasons: ["opticodds-disabled"],
        reasons,
        fixtureRefreshAgeSeconds: fixtureRefreshAge,
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
      mode: "opticodds-live-streams",
      degraded: false,
      degradationReasons: [],
      reasons,
      fixtureRefreshAgeSeconds: fixtureRefreshAge,
      oddsStreamAgeSeconds: oddsStreamAge,
      polymarketStreamAgeSeconds: polymarketStreamAge,
      trackedFixtures: this.fixtures.size,
      trackedPolymarketTokens: this.status.trackedPolymarketTokens,
    }
  }

  public async getFixtureDetail(fixtureId: string) {
    let fixture = await getFixture(fixtureId)

    if (!fixture) {
      return null
    }

    if (requiresLiveModelCoverage(fixture)) {
      await this.hydrateOfficialLiveResultsForLiveModel()
      await this.hydratePolymarketBooksForLiveModel()
      fixture = await getFixture(fixtureId) ?? fixture
    }

    const [odds, signals, liveModelSnapshots, liveModelSignals] = await Promise.all([
      listFixtureOdds(fixtureId),
      listFixtureSignals(fixtureId, 20),
      this.getFixtureLiveModelSnapshotsSafe(fixtureId, 50),
      this.getFixtureLiveModelSignalsSafe(fixtureId, 20),
    ])

    const liveState = this.fixtures.get(fixtureId)

    return {
      fixture: this.buildPublicFixture(fixture),
      books: this.buildBookViews(odds),
      signals,
      liveModel: liveState ? this.buildLiveModelView(liveState, "api-read") : null,
      liveModelSnapshots,
      liveModelSignals,
      monitoring: this.buildFixtureMonitoringState(fixture, liveState),
      summary: liveState ? this.buildFixtureSummary(liveState) : null,
    }
  }

  private async getFixtureLiveModelSnapshotsSafe(fixtureId: string, limit: number) {
    try {
      return await listFixtureLiveModelSnapshots(fixtureId, limit)
    } catch (error) {
      this.disableLiveModelPersistence(error)
      return []
    }
  }

  private async getFixtureLiveModelSignalsSafe(fixtureId: string, limit: number) {
    try {
      return await listFixtureLiveModelSignals(fixtureId, limit)
    } catch (error) {
      this.disableLiveModelPersistence(error)
      return []
    }
  }

  public async getCurrentLiveFixtureDetail(homeTeam: string, awayTeam: string) {
    const fixture = await getLiveFixtureByTeams(homeTeam, awayTeam)

    return fixture ? this.getFixtureDetail(fixture.id) : null
  }

  private async refreshFixtures() {
    const fixtures = await this.fetchActiveFixtures()
    const refreshedFixtureIds = new Set(fixtures.map((fixture) => fixture.id))

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

        if (config.opticOddsEnabled && fixtureState && requiresActiveOddsCoverage(fixtureState.fixture)) {
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

    if (!config.opticOddsEnabled) {
      await this.pruneStaleLocalOfficialFixtures(refreshedFixtureIds)
    }

    this.status.fixtureRefreshAt = new Date().toISOString()
    this.status.trackedFixtures = this.fixtures.size
    this.status.trackedPolymarketTokens = this.trackedTokenIds.size

    if (this.trackedTokenIds.size > 0) {
      this.ensurePolymarketSocket()
    }
  }

  private async pruneStaleLocalOfficialFixtures(refreshedFixtureIds: Set<string>) {
    for (const [fixtureId, fixtureState] of this.fixtures.entries()) {
      if (refreshedFixtureIds.has(fixtureId)) {
        continue
      }

      if (!fixtureState.fixture.opticOddsGameId.startsWith("ipl-official:")) {
        continue
      }

      await upsertFixture({
        ...fixtureState.fixture,
        status: "completed",
        isLive: false,
      })
      this.fixtures.delete(fixtureId)
      this.officialLiveResultHydratedAt.delete(fixtureId)
      this.polymarketBookHydratedAt.delete(fixtureId)
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
    if (!config.opticOddsEnabled) {
      return this.fetchLocalFixtures()
    }

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

  private async fetchLocalFixtures() {
    try {
      const payload = JSON.parse(await readFile(LOCAL_UPCOMING_FIXTURES_PATH, "utf-8")) as LocalFixtureRow[]
      return payload.flatMap((fixture) => {
        const record = this.buildLocalFixtureRecord(fixture)
        return record ? [record] : []
      })
    } catch (error) {
      logger.warn("Failed to load local official IPL fixtures for observer", {
        path: LOCAL_UPCOMING_FIXTURES_PATH,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  private buildLocalFixtureRecord(fixture: LocalFixtureRow): ObserverFixtureCore | null {
    const fixtureId = cleanLocalValue(fixture.fixture_id)
    const team1 = cleanLocalValue(fixture.team1)
    const team2 = cleanLocalValue(fixture.team2)
    const startTime = new Date(cleanLocalValue(fixture.match_date))

    if (!fixtureId || !team1 || !team2 || !Number.isFinite(startTime.getTime())) {
      return null
    }

    const inferredHomeTeam = cleanLocalValue(fixture.inferred_home_team)
    const homeTeam = inferredHomeTeam === team2 ? team2 : team1
    const awayTeam = homeTeam === team1 ? team2 : team1
    const officialMatchId = cleanLocalValue(fixture.official_match_id)
    const opticOddsGameId = cleanLocalValue(fixture.opticodds_game_id) || buildSyntheticFixtureSourceId(fixtureId, officialMatchId)

    return {
      id: fixtureId,
      opticOddsGameId,
      sport: "cricket",
      league: IPL_LEAGUE_NAME,
      homeTeam,
      awayTeam,
      homeTeamId: null,
      awayTeamId: null,
      startTime,
      status: cleanLocalValue(fixture.status) || "scheduled",
      isLive: parseLocalBoolean(fixture.is_live),
      venueName: cleanLocalValue(fixture.venue) || null,
      venueLocation: cleanLocalValue(fixture.venue_location) || (cleanLocalValue(fixture.city) ? `${cleanLocalValue(fixture.city)}, India` : null),
      polymarketEventSlug: this.fixtures.get(fixtureId)?.fixture.polymarketEventSlug ?? null,
      polymarketMarketSlug: this.fixtures.get(fixtureId)?.fixture.polymarketMarketSlug ?? null,
      polymarketConditionId: this.fixtures.get(fixtureId)?.fixture.polymarketConditionId ?? null,
      homeTokenId: this.fixtures.get(fixtureId)?.fixture.homeTokenId ?? null,
      awayTokenId: this.fixtures.get(fixtureId)?.fixture.awayTokenId ?? null,
      lastScore: null,
      lastPeriod: null,
      lastResultPayload: officialMatchId ? { source: "ipl_official", officialMatchId } : null,
    }
  }

  private async registerFixture(fixture: OpticOddsFixture | ObserverFixtureCore) {
    if ("startTime" in fixture) {
      await this.registerFixtureRecord(fixture)
      return
    }

    const existingState = this.fixtures.get(fixture.id)
    const existingFixture = existingState?.fixture
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
      lastResultPayload: mergeResultPayload(fixture.result ?? null, undefined, existingFixture?.lastResultPayload),
    } satisfies ObserverFixtureCore

    await this.registerFixtureRecord(record)
  }

  private async registerFixtureRecord(record: ObserverFixtureCore) {
    const existingState = this.fixtures.get(record.id)
    const existingFixture = existingState?.fixture

    await upsertFixture(record)

    this.fixtures.set(record.id, {
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

    const normalizedExpectedTeams = expectedTeams.map((team) => normalizeSelection(team))
    const teamMatch = catalog.find((entry) => {
      const teamSet = new Set(entry.teams.map((team) => normalizeSelection(team)))
      return (
        entry.eventDate === fixtureDate &&
        normalizedExpectedTeams.every((team) => teamSet.has(team))
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

    await this.recordLiveModelSnapshot(fixtureState, "opticodds-results")
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
      lastResultPayload: mergeResultPayload(
        update.score,
        update.player_results,
        fixtureState.fixture.lastResultPayload,
      ),
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

      void this.handlePolymarketMessage(data).catch((error: unknown) => {
        logger.warn("Failed to handle Polymarket market message", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
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
          await this.recordLiveModelSnapshot(fixtureState, "polymarket-price-change")
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
      await this.recordLiveModelSnapshot(fixtureState, `polymarket-${eventType}`)
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

  private async recordLiveModelSnapshot(
    fixtureState: FixtureState,
    sourceEvent: string,
    ballStateOverlay?: BallStateLiveModelOverlayInput,
  ) {
    if (this.liveModelPersistenceDisabledReason) {
      return
    }

    const now = Date.now()
    const liveModel = this.buildLiveModelView(fixtureState, sourceEvent, ballStateOverlay)
    const meaningfulInnings = [liveModel.inningsStates.first, liveModel.inningsStates.second]
      .filter(hasMeaningfulExpectedState)

    if (meaningfulInnings.length === 0) {
      return
    }

    const edgeCandidates = liveModel.selections
      .filter((selection) => selection.edgeVsMarketBps !== null)
      .sort(
        (left, right) =>
          Math.abs(right.edgeVsMarketBps ?? 0) - Math.abs(left.edgeVsMarketBps ?? 0),
      )
    const strongestEdge = edgeCandidates[0]

    let activeSnapshotId: number | null = null

    for (const inningsState of meaningfulInnings) {
      const snapshotKey = `${fixtureState.fixture.id}:${inningsState.innings ?? "unknown"}`
      const previousSnapshotAt = this.lastLiveModelSnapshotAt.get(snapshotKey) ?? 0

      if (now - previousSnapshotAt < LIVE_MODEL_SNAPSHOT_INTERVAL_MS) {
        continue
      }

      const snapshotId = await insertLiveModelSnapshot({
        fixtureId: fixtureState.fixture.id,
        sourceEvent,
        modelVersion: LIVE_MODEL_VERSION,
        innings: inningsState.innings,
        battingTeam: inningsState.battingTeam,
        bowlingTeam: inningsState.bowlingTeam,
        scoreRuns: inningsState.scoreRuns,
        scoreWickets: inningsState.scoreWickets,
        overs: inningsState.overs,
        balls: inningsState.balls,
        targetRuns: inningsState.targetRuns,
        expectedRunsNow: inningsState.expectedRunsNow,
        expectedWicketsNow: inningsState.expectedWicketsNow,
        runsDelta: inningsState.runsDelta,
        wicketsDelta: inningsState.wicketsDelta,
        projectedScore: inningsState.projectedScore,
        homeModelProbability: liveModel.home.winProbability ?? liveModel.home.fairProbability,
        awayModelProbability: liveModel.away.winProbability ?? liveModel.away.fairProbability,
        homePolymarketProbability: liveModel.home.marketProbability,
        awayPolymarketProbability: liveModel.away.marketProbability,
        homeReferenceProbability: liveModel.home.referenceProbability,
        awayReferenceProbability: liveModel.away.referenceProbability,
        edgeHomeVsPolymarketBps: liveModel.home.edgeVsMarketBps,
        edgeAwayVsPolymarketBps: liveModel.away.edgeVsMarketBps,
        confidence: liveModel.confidence,
        details: {
          ...liveModel.details,
          inningsStatus: inningsState.status,
          inningsStates: liveModel.inningsStates,
        },
      }).catch((error: unknown) => {
        this.disableLiveModelPersistence(error)
        return null
      })

      this.lastLiveModelSnapshotAt.set(snapshotKey, now)

      if (inningsState.innings === liveModel.expectedState.innings) {
        activeSnapshotId = snapshotId
      }
    }

    if (
      activeSnapshotId === null ||
      !strongestEdge ||
      strongestEdge.edgeVsMarketBps === null ||
      Math.abs(strongestEdge.edgeVsMarketBps) < LIVE_MODEL_SIGNAL_THRESHOLD_BPS
    ) {
      return
    }

    if (!hasMeaningfulSignalState(liveModel.expectedState)) {
      return
    }

    const signalKey = `${fixtureState.fixture.id}:${strongestEdge.selection}`
    const previousSignal = this.lastLiveModelSignalAt.get(signalKey)

    if (
      previousSignal &&
      now - previousSignal.observedAt < 60_000 &&
      Math.abs(previousSignal.edgeBps - strongestEdge.edgeVsMarketBps) < 50
    ) {
      return
    }

    await insertLiveModelSignal({
      fixtureId: fixtureState.fixture.id,
      snapshotId: activeSnapshotId,
      selection: strongestEdge.selection,
      modelProbability: strongestEdge.fairProbability,
      polymarketProbability: strongestEdge.marketProbability,
      referenceProbability: strongestEdge.referenceProbability,
      edgeVsPolymarketBps: strongestEdge.edgeVsMarketBps,
      reason: buildLiveModelSignalReason(liveModel.expectedState, strongestEdge.edgeVsMarketBps),
      confidence: liveModel.confidence,
      scoreContext: {
        score: fixtureState.fixture.lastScore,
        period: fixtureState.fixture.lastPeriod,
        expectedState: liveModel.expectedState,
      },
    }).catch((error: unknown) => {
      this.disableLiveModelPersistence(error)
    })

    this.lastLiveModelSignalAt.set(signalKey, {
      edgeBps: strongestEdge.edgeVsMarketBps,
      observedAt: now,
    })
  }

  private disableLiveModelPersistence(error: unknown) {
    if (this.liveModelPersistenceDisabledReason) {
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    if (!isLiveModelSchemaError(error, message)) {
      logger.warn("Live model persistence write failed; will retry on the next snapshot", {
        error: message,
      })
      return
    }

    this.liveModelPersistenceDisabledReason = message
    logger.warn("Live model persistence disabled; run pnpm db:migrate to create observer_live_model tables", {
      error: message,
    })
  }

  private buildLiveModelView(
    fixtureState: FixtureState,
    sourceEvent: string,
    ballStateOverlay?: BallStateLiveModelOverlayInput,
  ) {
    const matchingOverlay = getMatchingBallStateOverlay(fixtureState.fixture, ballStateOverlay)
    const publicFixture = this.buildPublicFixture(fixtureState.fixture)
    const fixture = matchingOverlay
      ? {
          ...publicFixture,
          score: publicFixture.score ?? formatBallStateFixtureScore(matchingOverlay.currentState),
          period: publicFixture.period ?? formatBallStateFixturePeriod(matchingOverlay.currentState.balls),
        }
      : publicFixture
    const summary = this.buildFixtureSummary(fixtureState, LIVE_MODEL_DISPLAY_ODDS_STALENESS_MS)
    const inningsStates = buildLiveInningsExpectedStates(fixtureState.fixture, matchingOverlay)
    const expectedState = getActiveExpectedState(inningsStates)
    const selections = summary?.selections ?? []
    const homeSelection = normalizeSelection(fixtureState.fixture.homeTeam)
    const awaySelection = normalizeSelection(fixtureState.fixture.awayTeam)
    const selectionViews: LiveSelectionView[] = selections.map((selection) => ({
      selection: selection.selection,
      fairProbability: selection.referenceProbability,
      marketProbability: selection.polymarketSnapshotPrice,
      referenceProbability: selection.referenceProbability,
      executableAsk: selection.executableAsk,
      executableBid: selection.executableBid,
      edgeVsMarketBps: selection.snapshotEdgeBps,
      edgeVsExecutableAskBps: selection.executableAskEdgeBps,
      feeAdjustedEdgeBps: selection.feeAdjustedEdgeBps,
    }))
    const home = selectionViews.find((selection) => selection.selection === homeSelection)
    const away = selectionViews.find((selection) => selection.selection === awaySelection)
    const homeWinProbability = getTeamLiveWinProbability(fixtureState.fixture.homeTeam, expectedState)
    const awayWinProbability = getTeamLiveWinProbability(fixtureState.fixture.awayTeam, expectedState)

    return {
      fixture,
      sourceEvent,
      modelVersion: LIVE_MODEL_VERSION,
      confidence: summary?.referenceConfidence ?? "low",
      expectedState,
      inningsStates,
      venueContext: getVenueContextStats(fixtureState.fixture.venueName),
      home: buildSideLiveModelView(
        home,
        fixtureState.fixture.homeTeam,
        homeWinProbability,
        getDirectPolymarketProbability(fixtureState, homeSelection),
      ),
      away: buildSideLiveModelView(
        away,
        fixtureState.fixture.awayTeam,
        awayWinProbability,
        getDirectPolymarketProbability(fixtureState, awaySelection),
      ),
      selections: selectionViews,
      details: {
        methodology:
          matchingOverlay
            ? "trained ball-by-ball expected-state scoring plus existing Betfair-first reference probability; isolated from deployed predictor artifacts"
            : "actual score context only; trained ball-by-ball expected-state scoring unavailable for this payload",
        score: fixtureState.fixture.lastScore,
        period: fixtureState.fixture.lastPeriod,
        rawScoreAvailable: fixtureState.fixture.lastResultPayload !== null,
        ballStateOverlayApplied: Boolean(matchingOverlay),
        reference: summary
          ? {
              source: summary.referenceSource,
              confidence: summary.referenceConfidence,
              bookCount: summary.referenceBookCount,
              maxDispersionBps: summary.maxDispersionBps,
              contributions: summary.contributions,
              excludedBooks: summary.excludedBooks,
            }
          : null,
      },
      updatedAt: new Date().toISOString(),
    }
  }

  private buildFixtureSummary(
    fixtureState: FixtureState,
    oddsStalenessMs = ODDS_STALENESS_MS,
  ) {
    const reference = this.buildReferenceProbabilities(fixtureState, oddsStalenessMs)

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
          this.buildSelectionSummary(fixtureState, referenceProbability, selection, oddsStalenessMs),
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
    oddsStalenessMs = ODDS_STALENESS_MS,
  ): SelectionSummary | null {
    const polymarketBook = fixtureState.oddsByBook.get("polymarket")
    const polymarketOddState = polymarketBook?.get(selection)

    const tokenId = fixtureState.selectionToToken.get(selection)
    const directBook = tokenId ? fixtureState.polymarketBooks.get(tokenId) : null

    if (
      (!polymarketOddState || polymarketOddState.isLocked) &&
      (!directBook || Date.now() - directBook.updatedAt.getTime() > oddsStalenessMs)
    ) {
      return null
    }

    if (
      polymarketOddState &&
      Date.now() - polymarketOddState.observedAt.getTime() > oddsStalenessMs &&
      (!directBook || Date.now() - directBook.updatedAt.getTime() > oddsStalenessMs)
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

  private buildReferenceProbabilities(
    fixtureState: FixtureState,
    oddsStalenessMs = ODDS_STALENESS_MS,
  ) {
    const { books, excludedBooks } = this.collectReferenceBooks(fixtureState, oddsStalenessMs)

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

  private collectReferenceBooks(fixtureState: FixtureState, oddsStalenessMs = ODDS_STALENESS_MS) {
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
          !entry.isLocked && Date.now() - entry.observedAt.getTime() <= oddsStalenessMs,
      )

      if (activeSelections.length < 2) {
        const hasLockedSelection = Array.from(selections.values()).some((entry) => entry.isLocked)
        const hasFreshSelection = Array.from(selections.values()).some(
          (entry) => Date.now() - entry.observedAt.getTime() <= oddsStalenessMs,
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

    if (fixture.isLive && !isFreshLiveFixture(fixture)) {
      reasons.push("stale-live-fixture")
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

const normalizeSelection = (value: string) => normalizeTeamName(value).trim().toLowerCase().replace(/\s+/g, "_")

const normalizeBallStateTeamName = (value: string | null) =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")

const getMatchingBallStateOverlay = (
  fixture: ObserverFixtureRecord,
  ballStateOverlay?: BallStateLiveModelOverlayInput,
) => {
  const overlays = Array.isArray(ballStateOverlay)
    ? ballStateOverlay
    : ballStateOverlay ? [ballStateOverlay] : []

  return overlays.find((overlay) => isMatchingBallStateOverlay(fixture, overlay)) ?? null
}

const isMatchingBallStateOverlay = (
  fixture: ObserverFixtureRecord,
  ballStateOverlay: BallStateLiveModelOverlay,
) => {
  if (!ballStateOverlay.available) {
    return null
  }

  if (ballStateOverlay.currentState.fixtureId === fixture.id) {
    return ballStateOverlay
  }

  const fixtureTeams = [fixture.homeTeam, fixture.awayTeam].map(normalizeBallStateTeamName).sort()
  const overlayTeams = [ballStateOverlay.currentState.battingTeam, ballStateOverlay.currentState.bowlingTeam]
    .flatMap((team) => {
      const normalized = normalizeBallStateTeamName(team)
      return normalized ? [normalized] : []
    })
    .sort()

  return overlayTeams.length === 2 && fixtureTeams.every((team, index) => team === overlayTeams[index])
    ? ballStateOverlay
    : null
}

const formatBallStateFixtureScore = (state: BallStateLiveModelOverlay["currentState"]) => {
  if (state.scoreRuns === null && state.scoreWickets === null) {
    return null
  }

  const prefix = state.battingTeam ? `${state.battingTeam} ` : ""
  return `${prefix}${state.scoreRuns ?? "—"}/${state.scoreWickets ?? "—"}`
}

const formatBallStateFixturePeriod = (balls: number | null) =>
  balls === null ? null : `${Math.floor(balls / 6)}.${balls % 6} ov`

const ballsToOvers = (balls: number) => Math.floor(balls / 6) + (balls % 6) / 10

const getOfficialMatchId = (payload: unknown) => {
  const record = toJsonRecord(payload)
  if (!record) {
    return null
  }

  return readText(record.officialMatchId)
    ?? readText(record.official_match_id)
    ?? readText(record.matchId)
    ?? readText(record.match_id)
}

const extractOfficialJsonpPayload = <T>(text: string, callbackName: string) => {
  const trimmed = text.trim()
  const prefix = `${callbackName}(`

  if (trimmed.startsWith(prefix) && trimmed.endsWith(");")) {
    return JSON.parse(trimmed.slice(prefix.length, -2)) as T
  }

  if (trimmed.startsWith(prefix) && trimmed.endsWith(")")) {
    return JSON.parse(trimmed.slice(prefix.length, -1)) as T
  }

  const match = new RegExp(`${callbackName}\\((.*)\\)\\s*;?$`, "s").exec(trimmed)
  if (!match?.[1]) {
    throw new Error(`Unable to parse official IPL payload for ${callbackName}`)
  }

  return JSON.parse(match[1]) as T
}

const fetchOfficialInnings = async (matchId: string, innings: 1 | 2) => {
  const url = IPLT20_INNINGS_URL_TEMPLATE
    .replace("{match_id}", encodeURIComponent(matchId))
    .replace("{innings}", String(innings))
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })

  if (!response.ok) {
    return null
  }

  const payload = extractOfficialJsonpPayload<Record<string, OfficialInningsPayload>>(
    await response.text(),
    "onScoring",
  )

  return payload[`Innings${innings}`] ?? null
}

const fetchOfficialLiveScorePayload = async (
  fixture: ObserverFixtureRecord,
  officialMatchId: string,
) => {
  const [firstInnings, secondInnings] = await Promise.all([
    fetchOfficialInnings(officialMatchId, 1),
    fetchOfficialInnings(officialMatchId, 2),
  ])
  const summaries = [
    buildOfficialInningsSummary(firstInnings, 1),
    buildOfficialInningsSummary(secondInnings, 2),
  ].filter((summary): summary is OfficialInningsSummary => summary !== null)

  if (summaries.length === 0) {
    return null
  }

  const firstAvailableSummary = summaries[0]
  if (!firstAvailableSummary) {
    return null
  }

  const activeSummary = summaries.reduce((latest, summary) =>
    summary.innings > latest.innings && summary.balls > 0 ? summary : latest,
  firstAvailableSummary)

  const homeSummary = summaries.find((summary) => teamsComparable(summary.battingTeam, fixture.homeTeam)) ?? null
  const awaySummary = summaries.find((summary) => teamsComparable(summary.battingTeam, fixture.awayTeam)) ?? null
  const firstSummary = summaries.find((summary) => summary.innings === 1) ?? null
  const activeBowlingTeam = activeSummary.bowlingTeam
    ?? (teamsComparable(activeSummary.battingTeam, fixture.homeTeam)
      ? fixture.awayTeam
      : teamsComparable(activeSummary.battingTeam, fixture.awayTeam)
        ? fixture.homeTeam
        : null)

  return {
    source: "ipl_official_live",
    officialMatchId,
    fixture: {
      home_team_display: fixture.homeTeam,
      away_team_display: fixture.awayTeam,
    },
    scores: {
      home: buildOfficialScoreSide(homeSummary),
      away: buildOfficialScoreSide(awaySummary),
    },
    stats: {
      home: buildOfficialStatsRows(homeSummary),
      away: buildOfficialStatsRows(awaySummary),
    },
    in_play: {
      current_innings: activeSummary.innings,
      period: `period_${activeSummary.innings}`,
      clock: activeSummary.oversLabel,
    },
    current_innings: activeSummary.innings,
    innings: activeSummary.innings,
    batting_team: activeSummary.battingTeam,
    bowling_team: activeBowlingTeam,
    total_runs: activeSummary.runs,
    score_runs: activeSummary.runs,
    total_wickets: activeSummary.wickets,
    score_wickets: activeSummary.wickets,
    batting_overs: activeSummary.oversLabel,
    overs: activeSummary.oversLabel,
    target_runs: activeSummary.innings === 2 && firstSummary ? firstSummary.runs + 1 : null,
  } satisfies JsonRecord
}

const fetchPolymarketBookSnapshot = async (tokenId: string): Promise<PolymarketBookState | null> => {
  const url = new URL(`${POLYMARKET_CLOB_BASE_URL}/book`)
  url.searchParams.set("token_id", tokenId)
  const response = await fetch(url)

  if (!response.ok) {
    return null
  }

  const payload = toJsonRecord(await response.json())
  if (!payload) {
    return null
  }

  const bids = sortBidLevels(parseBookLevels(payload.bids))
  const asks = sortAskLevels(parseBookLevels(payload.asks))

  return {
    tokenId,
    bestBid: getBestBidFromLevels(bids),
    bestAsk: getBestAskFromLevels(asks),
    lastTradePrice: null,
    bids,
    asks,
    updatedAt: new Date(),
  }
}

const buildOfficialInningsSummary = (
  innings: OfficialInningsPayload | null,
  inningsNumber: 1 | 2,
): OfficialInningsSummary | null => {
  const overHistory = innings?.OverHistory ?? []
  const lastBall = overHistory
    .filter((row) => readOfficialNumber(row.TotalRuns) !== null || readOfficialNumber(row.score_after) !== null)
    .sort((left, right) => officialBallSortValue(left) - officialBallSortValue(right))
    .at(-1)

  if (!lastBall) {
    return null
  }

  const balls = officialBallCount(lastBall)
  if (balls === null || balls <= 0) {
    return null
  }

  return {
    innings: inningsNumber,
    battingTeam: readText(lastBall.TeamName) ?? readText(lastBall.batting_team),
    bowlingTeam: null,
    runs: Math.round(readOfficialNumber(lastBall.TotalRuns) ?? readOfficialNumber(lastBall.score_after) ?? 0),
    wickets: readOfficialNumber(lastBall.TotalWickets) ?? readOfficialNumber(lastBall.wickets_after),
    balls,
    oversLabel: formatBallsAsOvers(balls),
  }
}

const readOfficialNumber = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") {
    return null
  }

  return readNumber(value)
}

const officialBallSortValue = (row: JsonRecord) => {
  const balls = officialBallCount(row)
  if (balls !== null) {
    return balls
  }

  return readNumber(row.SNO) ?? readNumber(row.BallUniqueID) ?? 0
}

const officialBallCount = (row: JsonRecord) => {
  const ballName = readText(row.BallName) ?? readText(row.CommentOver) ?? readText(row.over_ball)
  if (ballName) {
    const match = /(\d+)\.(\d+)/.exec(ballName)
    if (match) {
      const completedOvers = Number(match[1])
      const ball = Number(match[2])
      if (Number.isInteger(completedOvers) && Number.isInteger(ball)) {
        return completedOvers * 6 + normalizeCricketBallPart(ball)
      }
    }
  }

  const overNo = readNumber(row.OverNo)
  const ballNo = readNumber(row.BallNo)
  if (overNo !== null && ballNo !== null) {
    return Math.max(0, overNo - 1) * 6 + normalizeCricketBallPart(ballNo)
  }

  return null
}

const formatBallsAsOvers = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`

const buildOfficialScoreSide = (summary: OfficialInningsSummary | null) => ({
  total: summary?.runs ?? 0,
  wickets: summary?.wickets ?? null,
})

const buildOfficialStatsRows = (summary: OfficialInningsSummary | null) => summary
  ? [{
      period: `period_${summary.innings}`,
      stats: {
        batting_overs: summary.oversLabel,
        batting_runs: summary.runs,
        batting_wickets: summary.wickets,
      },
    }]
  : []

const teamsComparable = (left: string | null, right: string | null) =>
  normalizeBallStateTeamName(left) === normalizeBallStateTeamName(right)

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
    const nestedHome = toJsonRecord(nestedScores.home)
    const nestedAway = toJsonRecord(nestedScores.away)
    const nestedHomeScore = nestedHome?.total
    const nestedAwayScore = nestedAway?.total

    if (typeof nestedHomeScore === "number" && typeof nestedAwayScore === "number") {
      const homeWickets = readNumber(nestedHome?.wickets)
      const awayWickets = readNumber(nestedAway?.wickets)
      return homeWickets !== null || awayWickets !== null
        ? `${nestedHomeScore}/${homeWickets ?? "—"} - ${nestedAwayScore}/${awayWickets ?? "—"}`
        : `${nestedHomeScore}-${nestedAwayScore}`
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

const mergeResultPayload = (
  score: unknown,
  playerResults: unknown[] | undefined,
  previousPayload: unknown,
) => {
  const previousRecord = toJsonRecord(previousPayload)
  const previousScore = toJsonRecord(previousRecord?.score) ?? previousRecord
  const scoreRecord = toJsonRecord(score)
  const nextScore = mergeScorePayload(scoreRecord, previousScore) ?? score
  const previousPlayerResults = Array.isArray(previousRecord?.player_results)
    ? previousRecord.player_results
    : []
  const nextPlayerResults = playerResults && playerResults.length > 0 ? playerResults : previousPlayerResults

  if (nextPlayerResults.length === 0) {
    return nextScore
  }

  return {
    score: nextScore,
    player_results: nextPlayerResults,
  }
}

const mergeScorePayload = (score: JsonRecord | null, previousScore: JsonRecord | null) => {
  if (!score) {
    return previousScore
  }

  if (!previousScore || score.stats) {
    return score
  }

  if (!previousScore.stats) {
    return score
  }

  return {
    ...previousScore,
    ...score,
    scores: score.scores ?? previousScore.scores,
    in_play: score.in_play ?? previousScore.in_play,
    in_play_data: score.in_play_data ?? previousScore.in_play_data,
  }
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

const buildSideLiveModelView = (
  selection: LiveSelectionView | undefined,
  team: string,
  winProbability: number | null,
  marketFallbackProbability: number | null,
) => {
  const marketProbability = selection?.marketProbability ?? marketFallbackProbability
  const edgeVsMarketBps = winProbability !== null && marketProbability !== null
    ? Math.round((winProbability - marketProbability) * 10_000)
    : selection?.edgeVsMarketBps ?? null

  return {
    team,
    winProbability,
    fairProbability: selection?.fairProbability ?? null,
    marketProbability,
    referenceProbability: selection?.referenceProbability ?? null,
    edgeVsMarketBps,
  }
}

const getDirectPolymarketProbability = (fixtureState: FixtureState, selection: string) => {
  const tokenId = fixtureState.selectionToToken.get(selection)
  const directBook = tokenId ? fixtureState.polymarketBooks.get(tokenId) : null
  if (!directBook) {
    return null
  }

  return getPolymarketBookMidpoint(directBook)
    ?? (isUsablePolymarketAsk(directBook.bestAsk) ? directBook.bestAsk : null)
    ?? (isUsablePolymarketBid(directBook.bestBid) ? directBook.bestBid : null)
    ?? (isUsablePolymarketAsk(directBook.lastTradePrice) ? directBook.lastTradePrice : null)
}

const getPolymarketBookMidpoint = (book: PolymarketBookState) =>
  book.bestBid !== null && book.bestAsk !== null
    ? clampProbability((book.bestBid + book.bestAsk) / 2)
    : null

const getTeamLiveWinProbability = (team: string, expectedState: LiveExpectedState) => {
  const battingTeamWinProbability = expectedState.battingTeamWinProbability ?? expectedState.chaseSuccessProbability

  if (battingTeamWinProbability === null) {
    return null
  }

  if (teamsComparable(team, expectedState.battingTeam)) {
    return battingTeamWinProbability
  }

  if (teamsComparable(team, expectedState.bowlingTeam)) {
    return roundMetric(1 - battingTeamWinProbability)
  }

  return null
}

const buildLiveModelSignalReason = (
  expectedState: LiveExpectedState,
  edgeVsPolymarketBps: number,
) => {
  const direction = edgeVsPolymarketBps > 0 ? "fair_above_market" : "fair_below_market"
  const runGap =
    expectedState.runsDelta === null
      ? "runs_delta_unavailable"
      : `runs_delta_${expectedState.runsDelta.toFixed(1)}`
  const wicketGap =
    expectedState.wicketsDelta === null
      ? "wickets_delta_unavailable"
      : `wickets_delta_${expectedState.wicketsDelta.toFixed(1)}`

  return `${direction}; ${runGap}; ${wicketGap}`
}

const hasMeaningfulExpectedState = (expectedState: LiveExpectedState) =>
  expectedState.scoreRuns !== null &&
  expectedState.balls !== null &&
  expectedState.balls > 0 &&
  expectedState.expectedRunsNow !== null &&
  expectedState.expectedWicketsNow !== null &&
  expectedState.runsDelta !== null &&
  expectedState.projectedScore !== null

const hasMeaningfulSignalState = (expectedState: LiveExpectedState) =>
  expectedState.scoreRuns !== null &&
  expectedState.scoreWickets !== null &&
  expectedState.balls !== null &&
  expectedState.balls > 0 &&
  expectedState.runsDelta !== null &&
  expectedState.wicketsDelta !== null

const isMeaningfulLiveModelSnapshot = (snapshot: {
  scoreRuns: number | null
  scoreWickets: number | null
  balls: number | null
  expectedRunsNow: number | null
  expectedWicketsNow: number | null
  runsDelta: number | null
  wicketsDelta: number | null
  projectedScore: number | null
}) =>
  snapshot.scoreRuns !== null &&
  snapshot.balls !== null &&
  snapshot.balls > 0 &&
  snapshot.expectedRunsNow !== null &&
  snapshot.expectedWicketsNow !== null &&
  snapshot.runsDelta !== null &&
  snapshot.projectedScore !== null

const buildLatestSnapshotsByInnings = <T extends { innings: number | null }>(snapshots: T[]) => ({
  first: snapshots.find((snapshot) => snapshot.innings === 1) ?? null,
  second: snapshots.find((snapshot) => snapshot.innings === 2) ?? null,
})

const isMeaningfulLiveModelSignal = (signal: { scoreContext: unknown }) => {
  const context = toJsonRecord(signal.scoreContext)
  const expectedState = context ? toJsonRecord(context.expectedState) : null

  return Boolean(
    expectedState &&
      readNumber(expectedState.scoreRuns) !== null &&
      readNumber(expectedState.scoreWickets) !== null &&
      (readNumber(expectedState.balls) ?? 0) > 0 &&
      readNumber(expectedState.runsDelta) !== null &&
      readNumber(expectedState.wicketsDelta) !== null,
  )
}

const isLiveModelSchemaError = (error: unknown, message: string) => {
  const record = toJsonRecord(error)
  const code = typeof record?.code === "string" ? record.code : null
  return code === "42P01" || code === "42703" || /observer_live_model|does not exist|column .* does not exist/i.test(message)
}

const dedupeLiveModelSignalRecord = <T extends {
  fixtureId: string
  selection: string
  reason: string
  edgeVsPolymarketBps: number | null
}>(signal: T, index: number, signals: T[]) => {
  const edge = signal.edgeVsPolymarketBps ?? 0
  return signals.findIndex((candidate) => {
    const candidateEdge = candidate.edgeVsPolymarketBps ?? 0
    return (
      candidate.fixtureId === signal.fixtureId &&
      candidate.selection === signal.selection &&
      candidate.reason === signal.reason &&
      Math.abs(candidateEdge - edge) < 50
    )
  }) === index
}

const buildLiveInningsExpectedStates = (
  fixture: ObserverFixtureRecord,
  ballStateOverlay?: BallStateLiveModelOverlay | null,
): LiveInningsExpectedStates => {
  const sideStates = buildLiveSideInningsStates(fixture)
  if (sideStates) {
    return applyBallStateOverlayToInningsStates(sideStates, ballStateOverlay)
  }

  const active = parseCricketState(fixture.lastResultPayload)
  const first = buildExpectedStateFromParsed(parseCricketStateForInnings(fixture.lastResultPayload, 1))
  const second = buildExpectedStateFromParsed(parseCricketStateForInnings(fixture.lastResultPayload, 2))
  const activeInnings = active.innings ?? first.innings ?? second.innings

  return applyBallStateOverlayToInningsStates({
    activeInnings,
    first: withInningsStatus(first, 1, activeInnings),
    second: withInningsStatus(second, 2, activeInnings),
  }, ballStateOverlay)
}

const applyBallStateOverlayToInningsStates = (
  states: LiveInningsExpectedStates,
  ballStateOverlay?: BallStateLiveModelOverlay | null,
): LiveInningsExpectedStates => {
  if (!ballStateOverlay?.available) {
    return states
  }

  const innings = ballStateOverlay.currentState.innings
  if (innings !== 1 && innings !== 2) {
    return states
  }

  return {
    activeInnings: innings,
    first: innings === 1 ? applyBallStateOverlayToInningsState(states.first, ballStateOverlay) : states.first,
    second: innings === 2 ? applyBallStateOverlayToInningsState(states.second, ballStateOverlay) : states.second,
  }
}

const applyBallStateOverlayToInningsState = (
  state: InningsExpectedState,
  ballStateOverlay: BallStateLiveModelOverlay,
): InningsExpectedState => {
  const balls = ballStateOverlay.currentState.balls
  const innings = ballStateOverlay.currentState.innings
  const scoreRuns = ballStateOverlay.currentState.scoreRuns ?? state.scoreRuns
  const scoreWickets = ballStateOverlay.currentState.scoreWickets ?? state.scoreWickets
  const targetRuns = state.targetRuns
  const terminalProbability = terminalChaseSuccessProbability({
    innings,
    scoreRuns,
    scoreWickets,
    balls: balls ?? state.balls,
    targetRuns,
  })
  const battingTeamWinProbability = terminalProbability
    ?? (innings === 1 ? ballStateOverlay.predictions.battingTeamMatchWinProbability : null)
    ?? (innings === 2 ? ballStateOverlay.predictions.chaseSuccessProbability : null)

  return {
    ...state,
    innings,
    battingTeam: ballStateOverlay.currentState.battingTeam ?? state.battingTeam,
    bowlingTeam: ballStateOverlay.currentState.bowlingTeam ?? state.bowlingTeam,
    scoreRuns,
    scoreWickets,
    overs: balls === null ? state.overs : ballsToOvers(balls),
    balls: balls ?? state.balls,
    expectedRunsNow: ballStateOverlay.predictions.expectedRunsNow,
    expectedWicketsNow: ballStateOverlay.predictions.expectedWicketsNow,
    runsDelta: ballStateOverlay.predictions.runsDelta,
    wicketsDelta: ballStateOverlay.predictions.wicketsDelta,
    projectedScore: ballStateOverlay.predictions.finalInningsRuns,
    battingTeamWinProbability,
    chaseSuccessProbability: terminalProbability ?? (innings === 2 ? ballStateOverlay.predictions.chaseSuccessProbability : null),
    status: "live",
  }
}

const terminalChaseSuccessProbability = (
  state: Pick<LiveExpectedState, "innings" | "scoreRuns" | "scoreWickets" | "balls" | "targetRuns">,
) => {
  if (state.innings !== 2 || state.scoreRuns === null || state.targetRuns === null) {
    return null
  }

  if (state.scoreRuns >= state.targetRuns) {
    return 1
  }

  if (state.scoreWickets !== null && state.scoreWickets >= 10) {
    return 0
  }

  if (state.balls !== null && state.balls >= 120) {
    return 0
  }

  return null
}

const buildLiveSideInningsStates = (fixture: ObserverFixtureRecord): LiveInningsExpectedStates | null => {
  const payloadRecord = toJsonRecord(fixture.lastResultPayload)
  const scoreRecord = toJsonRecord(payloadRecord?.score) ?? payloadRecord
  const inningsSides = readLiveInningsSides(scoreRecord)

  if (!inningsSides) {
    return null
  }

  const first = buildExpectedStateFromParsed(readLiveSideInningsState(scoreRecord, 1) ?? blankParsedInnings(1))
  const second = buildExpectedStateFromParsed(readLiveSideInningsState(scoreRecord, 2) ?? blankParsedInnings(2))

  return {
    activeInnings: 2,
    first: { ...first, status: "frozen" },
    second: { ...second, status: hasStartedInnings(second) ? "live" : "pending" },
  }
}

const blankParsedInnings = (innings: 1 | 2): ParsedCricketState => ({
  innings,
  battingTeam: null,
  bowlingTeam: null,
  scoreRuns: null,
  scoreWickets: null,
  overs: null,
  balls: null,
  targetRuns: null,
})

const getActiveExpectedState = (inningsStates: LiveInningsExpectedStates): LiveExpectedState => {
  if (inningsStates.activeInnings === 2) {
    return stripInningsStatus(inningsStates.second)
  }

  if (inningsStates.activeInnings === 1) {
    return stripInningsStatus(inningsStates.first)
  }

  return stripInningsStatus(inningsStates.first.scoreRuns !== null ? inningsStates.first : inningsStates.second)
}

const withInningsStatus = (
  state: LiveExpectedState,
  innings: 1 | 2,
  activeInnings: number | null,
): InningsExpectedState => {
  const hasScore = hasStartedInnings(state)
  const status = hasScore && activeInnings === innings
    ? "live"
    : hasScore && activeInnings !== null && activeInnings > innings
      ? "frozen"
      : activeInnings === innings
        ? "pending"
        : hasScore
          ? "frozen"
          : "unavailable"

  return { ...state, status }
}

const stripInningsStatus = (state: InningsExpectedState): LiveExpectedState => {
  const { status: _status, ...expectedState } = state
  return expectedState
}

const isMidInningsBreak = (states: LiveInningsExpectedStates) =>
  isCompletedLiveInningsState(states.first) && !hasSecondInningsStarted(states.second)

const isCompletedLiveInningsState = (state: InningsExpectedState) =>
  state.scoreWickets !== null && state.scoreWickets >= 10 || state.overs !== null && state.overs >= 19.5

const hasSecondInningsStarted = (state: InningsExpectedState) =>
  hasStartedInnings(state) ||
  state.status === "live"

const hasStartedInnings = (state: Pick<LiveExpectedState, "balls" | "overs" | "scoreRuns" | "scoreWickets">) =>
  state.balls !== null && state.balls > 0 ||
  state.overs !== null && state.overs > 0 ||
  state.scoreRuns !== null && state.scoreRuns > 0 ||
  state.scoreWickets !== null && state.scoreWickets > 0

const buildExpectedStateFromParsed = (parsed: ParsedCricketState): LiveExpectedState => ({
  ...parsed,
  expectedRunsNow: null,
  expectedWicketsNow: null,
  runsDelta: null,
  wicketsDelta: null,
  projectedScore: null,
  expectedRunRate: null,
  battingTeamWinProbability: null,
  chaseSuccessProbability: null,
})

const parseCricketState = (payload: unknown): ParsedCricketState => {
  const records = collectJsonRecords(payload)
  const scoreRecord = toJsonRecord(toJsonRecord(payload)?.score) ?? toJsonRecord(payload)
  const inPlay = scoreRecord ? toJsonRecord(scoreRecord.in_play) ?? toJsonRecord(scoreRecord.in_play_data) : null
  const activeInnings = firstInteger(
    [inPlay, scoreRecord].filter((record): record is JsonRecord => record !== null),
    ["current_innings", "currentInnings", "innings", "inning"],
  )
  const inferredActiveInnings = inferLiveActiveInnings(scoreRecord, activeInnings)
  const activeSideState = readLiveSideInningsState(scoreRecord, inferredActiveInnings)

  if (activeSideState) {
    return activeSideState
  }

  const activeRecords = selectActiveInningsRecords(records, scoreRecord, inPlay, inferredActiveInnings)
  const resolvedInnings = inferredActiveInnings ?? firstInteger(activeRecords, ["innings", "inning", "current_innings"])

  return {
    innings: resolvedInnings,
    battingTeam: firstText(activeRecords, ["batting_team", "battingTeam", "batting_team_name"]),
    bowlingTeam: firstText(activeRecords, ["bowling_team", "bowlingTeam", "bowling_team_name"]),
    scoreRuns: firstScoreRuns(activeRecords, inPlay, scoreRecord, resolvedInnings),
    scoreWickets: firstScoreWickets(payload, activeRecords, inPlay, scoreRecord, resolvedInnings),
    overs: hasScoreValue(activeRecords) ? firstOverValue(activeRecords, inPlay) : null,
    balls: hasScoreValue(activeRecords) ? firstBallValue(activeRecords, inPlay) : null,
    targetRuns: firstInteger(activeRecords, ["target", "target_runs", "runs_to_win"]),
  }
}

const parseCricketStateForInnings = (payload: unknown, innings: 1 | 2): ParsedCricketState => {
  const records = collectJsonRecords(payload)
  const scoreRecord = toJsonRecord(toJsonRecord(payload)?.score) ?? toJsonRecord(payload)
  const inPlay = scoreRecord ? toJsonRecord(scoreRecord.in_play) ?? toJsonRecord(scoreRecord.in_play_data) : null
  const sideState = readLiveSideInningsState(scoreRecord, innings)

  if (sideState) {
    return sideState
  }

  const inningsRecords = selectActiveInningsRecords(records, scoreRecord, inPlay, innings)

  return {
    innings,
    battingTeam: firstText(inningsRecords, ["batting_team", "battingTeam", "batting_team_name"]),
    bowlingTeam: firstText(inningsRecords, ["bowling_team", "bowlingTeam", "bowling_team_name"]),
    scoreRuns: firstScoreRuns(inningsRecords, innings === 2 ? inPlay : null, scoreRecord, innings),
    scoreWickets: firstScoreWickets(payload, inningsRecords, innings === 2 ? inPlay : null, scoreRecord, innings),
    overs: hasScoreValue(inningsRecords) ? firstOverValue(inningsRecords, innings === 2 ? inPlay : null) : null,
    balls: hasScoreValue(inningsRecords) ? firstBallValue(inningsRecords, innings === 2 ? inPlay : null) : null,
    targetRuns: firstInteger(inningsRecords, ["target", "target_runs", "runs_to_win"]),
  }
}

const hasScoreValue = (records: JsonRecord[]) =>
  records.some((record) =>
    firstInteger([record], [
      "total_runs",
      "runs_total",
      "scoreRuns",
      "score_runs",
      "team_total",
      "innings_total",
      "batting_total",
      "total",
      "runs",
      "batting_runs",
      "batter_runs",
      "runs_batter",
      "runs_off_bat",
      "total_wickets",
      "scoreWickets",
      "score_wickets",
      "wickets_lost",
      "batting_wickets",
      "wickets",
    ]) !== null || readSummaryScoreTotals(record).some((value) => value !== null && value > 0),
  )

const selectActiveInningsRecords = (
  records: JsonRecord[],
  scoreRecord: JsonRecord | null,
  inPlay: JsonRecord | null,
  activeInnings: number | null,
) => {
  const anchoredRecords = [
    recordMatchesInnings(inPlay, activeInnings) ? inPlay : null,
    recordMatchesInnings(scoreRecord, activeInnings) ? scoreRecord : null,
  ].filter((record): record is JsonRecord => record !== null)
  const matchingRecords = activeInnings === null
    ? []
    : records.filter((record) => {
        if (activeInnings > 1 && record === scoreRecord) {
          return false
        }

        const recordInnings = readNumber(record.current_innings)
          ?? readNumber(record.currentInnings)
          ?? readNumber(record.innings)
          ?? readNumber(record.inning)

        return recordInnings !== null && Math.round(recordInnings) === activeInnings
      })

  const ordered = [...anchoredRecords, ...matchingRecords]
  const seen = new Set<JsonRecord>()
  return ordered.filter((record) => {
    if (seen.has(record)) {
      return false
    }

    seen.add(record)
    return true
  })
}

const recordMatchesInnings = (record: JsonRecord | null, innings: number | null) => {
  if (!record) {
    return false
  }

  if (innings === null) {
    return true
  }

  const recordInnings = readNumber(record.current_innings)
    ?? readNumber(record.currentInnings)
    ?? readNumber(record.innings)
    ?? readNumber(record.inning)

  return recordInnings === null ? innings <= 1 : Math.round(recordInnings) === innings
}

type CricketScoreSide = "home" | "away"

const inferLiveActiveInnings = (scoreRecord: JsonRecord | null, feedInnings: number | null) => {
  const inningsSides = readLiveInningsSides(scoreRecord)
  return inningsSides ? 2 : feedInnings
}

const readLiveSideInningsState = (
  scoreRecord: JsonRecord | null,
  innings: number | null,
): ParsedCricketState | null => {
  const inningsSides = readLiveInningsSides(scoreRecord)
  if (!inningsSides || (innings !== 1 && innings !== 2)) {
    return null
  }

  const side = innings === 1 ? inningsSides.first : inningsSides.second
  const oppositeSide = side === "home" ? "away" : "home"
  const score = toJsonRecord(toJsonRecord(scoreRecord?.scores)?.[side])
  const summary = readSideBattingSummary(scoreRecord, side, innings)
  const overs = summary.overs
  const scoreRuns = readNumber(score?.total) ?? summary.runs
  const firstInningsRuns = innings === 2
    ? readNumber(toJsonRecord(toJsonRecord(scoreRecord?.scores)?.[inningsSides.first])?.total)
    : null

  return {
    innings,
    battingTeam: readScoreTeamName(scoreRecord, side),
    bowlingTeam: readScoreTeamName(scoreRecord, oppositeSide),
    scoreRuns: scoreRuns === null ? null : Math.round(scoreRuns),
    scoreWickets: summary.wickets === null ? null : Math.round(summary.wickets),
    overs,
    balls: overs === null ? null : oversToBalls(overs),
    targetRuns: innings === 2 && firstInningsRuns !== null ? Math.round(firstInningsRuns + 1) : null,
  }
}

const readLiveInningsSides = (scoreRecord: JsonRecord | null) => {
  const homePeriods = readSidePeriods(scoreRecord, "home")
  const awayPeriods = readSidePeriods(scoreRecord, "away")

  if (homePeriods.has("period_1") && awayPeriods.has("period_2")) {
    return { first: "home" as const, second: "away" as const }
  }

  if (awayPeriods.has("period_1") && homePeriods.has("period_2")) {
    return { first: "away" as const, second: "home" as const }
  }

  const homeSummary = readSideBattingSummary(scoreRecord, "home")
  const awaySummary = readSideBattingSummary(scoreRecord, "away")
  const scores = toJsonRecord(scoreRecord?.scores)
  const homeTotal = readNumber(toJsonRecord(scores?.home)?.total)
  const awayTotal = readNumber(toJsonRecord(scores?.away)?.total)

  if ((homeTotal ?? 0) <= 0 || (awayTotal ?? 0) <= 0) {
    return null
  }

  if (isCompletedT20Innings(homeSummary) && isCurrentT20Innings(awaySummary)) {
    return { first: "home" as const, second: "away" as const }
  }

  if (isCompletedT20Innings(awaySummary) && isCurrentT20Innings(homeSummary)) {
    return { first: "away" as const, second: "home" as const }
  }

  return null
}

const readSideBattingSummary = (
  scoreRecord: JsonRecord | null,
  side: CricketScoreSide,
  innings?: 1 | 2 | null,
) => {
  const rowRecords = readSideStatRows(scoreRecord, side)
  const preferredPeriod = innings === 1 || innings === 2 ? `period_${innings}` : "period_1"
  const preferredRow = rowRecords.find((row) => readText(row.period) === preferredPeriod) ?? rowRecords[0] ?? null
  const battingStats = toJsonRecord(preferredRow?.stats)
  const overs = readText(battingStats?.batting_overs)

  return {
    runs: readNumber(battingStats?.batting_runs),
    wickets: readNumber(battingStats?.batting_wickets),
    overs: overs ? parseCricketOverNotation(overs) : null,
  }
}

const readSidePeriods = (scoreRecord: JsonRecord | null, side: CricketScoreSide) =>
  new Set(readSideStatRows(scoreRecord, side).flatMap((row) => {
    const period = readText(row.period)
    return period ? [period] : []
  }))

const readSideStatRows = (scoreRecord: JsonRecord | null, side: CricketScoreSide) => {
  const stats = toJsonRecord(scoreRecord?.stats)
  const rows = stats ? stats[side] : null
  return Array.isArray(rows)
    ? rows.map((row) => toJsonRecord(row)).filter((row): row is JsonRecord => row !== null)
    : []
}

const isCompletedT20Innings = (summary: { overs: number | null; wickets: number | null }) =>
  summary.wickets !== null && summary.wickets >= 10 || summary.overs !== null && summary.overs >= 19.5

const isCurrentT20Innings = (summary: { overs: number | null; wickets: number | null }) =>
  summary.overs !== null && summary.overs < 19.5 && (summary.wickets === null || summary.wickets < 10)

const firstScoreRuns = (
  activeRecords: JsonRecord[],
  inPlay: JsonRecord | null,
  scoreRecord: JsonRecord | null,
  activeInnings: number | null,
) => {
  const liveRuns = firstInteger(activeRecords, [
    "total_runs",
    "runs_total",
    "scoreRuns",
    "score_runs",
    "team_total",
    "innings_total",
    "batting_total",
    "total",
  ])

  if (liveRuns !== null) {
    return liveRuns
  }

  const liveRunsWithExtras = firstRunsPlusExtras(activeRecords)
  if (liveRunsWithExtras !== null) {
    return liveRunsWithExtras
  }

  const liveFallbackRuns = firstInteger(activeRecords, ["runs", "batting_runs", "batter_runs", "runs_batter", "runs_off_bat"])
  if (liveFallbackRuns !== null) {
    return liveFallbackRuns
  }

  const inningsSummaryRuns = firstSummaryScoreRuns(scoreRecord, activeInnings)
  if (inningsSummaryRuns !== null) {
    return inningsSummaryRuns
  }

  if (activeInnings !== null && activeInnings > 1) {
    return null
  }

  return firstInteger([scoreRecord, inPlay].filter((record): record is JsonRecord => record !== null), [
    "total_runs",
    "runs_total",
    "scoreRuns",
    "score_runs",
    "team_total",
    "innings_total",
    "batting_total",
    "total",
  ])
}

const firstScoreWickets = (
  payload: unknown,
  activeRecords: JsonRecord[],
  inPlay: JsonRecord | null,
  scoreRecord: JsonRecord | null,
  activeInnings: number | null,
) => {
  const liveWickets = firstInteger(activeRecords, [
    "total_wickets",
    "scoreWickets",
    "score_wickets",
    "wickets_lost",
    "batting_wickets",
    "wickets",
  ])

  if (liveWickets !== null) {
    return liveWickets
  }

  const dismissedBatters = countDismissedBatters(payload, scoreRecord, activeInnings)
  if (dismissedBatters !== null) {
    return dismissedBatters
  }

  const inningsSummaryWickets = firstSummaryScoreWickets(scoreRecord, activeInnings)
  if (inningsSummaryWickets !== null) {
    return inningsSummaryWickets
  }

  if (activeInnings !== null && activeInnings > 1) {
    return null
  }

  return firstInteger([scoreRecord, inPlay].filter((record): record is JsonRecord => record !== null), [
    "total_wickets",
    "scoreWickets",
    "score_wickets",
    "wickets_lost",
    "batting_wickets",
    "wickets",
  ])
}

const firstSummaryScoreRuns = (scoreRecord: JsonRecord | null, activeInnings: number | null) => {
  if (activeInnings !== null && activeInnings > 1) {
    return null
  }

  const totals = readSummaryScoreTotals(scoreRecord).filter((value) => value !== null)
  const positiveTotals = totals.filter((value) => value > 0)

  if (positiveTotals.length === 1) {
    return positiveTotals[0] ?? null
  }

  return null
}

const firstSummaryScoreWickets = (scoreRecord: JsonRecord | null, activeInnings: number | null) => {
  if (activeInnings !== null && activeInnings > 1) {
    return null
  }

  const summaries = readSummaryScoreRecords(scoreRecord)
  const scoredSummaries = summaries.filter((summary) => (readNumber(summary.total) ?? 0) > 0)
  const scoredSummary = scoredSummaries.length === 1 ? scoredSummaries[0] : null

  return scoredSummary ? readNumber(scoredSummary.wickets) ?? readNumber(scoredSummary.wickets_lost) : null
}

const countDismissedBatters = (
  payload: unknown,
  scoreRecord: JsonRecord | null,
  activeInnings: number | null,
) => {
  if (activeInnings === null) {
    return null
  }

  const battingTeamName = readSoleScoringTeamName(scoreRecord)
  const period = `period_${activeInnings}`
  const payloadRecord = toJsonRecord(payload)
  const playerResults = Array.isArray(payloadRecord?.player_results) ? payloadRecord.player_results : []
  const dismissedPlayersByTeam = new Map<string, Set<string>>()

  for (const playerResult of playerResults) {
    const resultRecord = toJsonRecord(playerResult)
    const teamRecord = toJsonRecord(resultRecord?.team)
    const teamName = readText(teamRecord?.name)
    if (!teamName || (battingTeamName && teamName !== battingTeamName)) {
      continue
    }

    const playerRecord = toJsonRecord(resultRecord?.player)
    const playerKey = readText(playerRecord?.id) ?? readText(playerRecord?.name)
    const statsRows = Array.isArray(resultRecord?.stats) ? resultRecord.stats : []

    for (const statsRow of statsRows) {
      const statsRecord = toJsonRecord(statsRow)
      if (statsRecord === null) {
        continue
      }

      if (readText(statsRecord.period) !== period) {
        continue
      }

      const nestedStats = toJsonRecord(statsRecord.stats)
      const battingStats = nestedStats === null ? statsRecord : nestedStats
      const fowType = readText(battingStats.batting_fow_type)?.toLowerCase()
      if (fowType && fowType !== "not_out") {
        const teamDismissals = dismissedPlayersByTeam.get(teamName) ?? new Set<string>()
        teamDismissals.add(playerKey ?? `${teamName}-${teamDismissals.size + 1}`)
        dismissedPlayersByTeam.set(teamName, teamDismissals)
      }
    }
  }

  if (battingTeamName) {
    const dismissedPlayers = dismissedPlayersByTeam.get(battingTeamName)
    return dismissedPlayers && dismissedPlayers.size > 0 ? dismissedPlayers.size : null
  }

  return dismissedPlayersByTeam.size === 1 ? [...dismissedPlayersByTeam.values()][0]?.size ?? null : null
}

const readSoleScoringTeamName = (scoreRecord: JsonRecord | null) => {
  const scores = toJsonRecord(scoreRecord?.scores)
  const homeScore = toJsonRecord(scores?.home)
  const awayScore = toJsonRecord(scores?.away)
  const homeTotal = readNumber(homeScore?.total)
  const awayTotal = readNumber(awayScore?.total)

  if (homeTotal !== null && homeTotal > 0 && (awayTotal ?? 0) === 0) {
    return readScoreTeamName(scoreRecord, "home")
  }

  if (awayTotal !== null && awayTotal > 0 && (homeTotal ?? 0) === 0) {
    return readScoreTeamName(scoreRecord, "away")
  }

  return null
}

const readScoreTeamName = (scoreRecord: JsonRecord | null, side: "home" | "away") => {
  const fixture = toJsonRecord(scoreRecord?.fixture)
  const displayName = readText(fixture?.[`${side}_team_display`])

  if (displayName) {
    return displayName
  }

  const competitors = fixture?.[`${side}_competitors`]
  if (!Array.isArray(competitors)) {
    return null
  }

  return readText(toJsonRecord(competitors[0])?.name)
}

const readSummaryScoreTotals = (scoreRecord: JsonRecord | null) =>
  readSummaryScoreRecords(scoreRecord).map((record) => readNumber(record.total))

const readSummaryScoreRecords = (scoreRecord: JsonRecord | null) => {
  const scores = toJsonRecord(scoreRecord?.scores) ?? scoreRecord

  if (!scores) {
    return []
  }

  return [toJsonRecord(scores.home), toJsonRecord(scores.away)]
    .filter((record): record is JsonRecord => record !== null)
}

const firstRunsPlusExtras = (records: JsonRecord[]) => {
  for (const record of records) {
    const batterRuns = readNumber(record.batter_runs)
      ?? readNumber(record.runs_batter)
      ?? readNumber(record.runs_off_bat)
      ?? readNumber(record.batting_runs)
    const extras = readNumber(record.extras)
      ?? readNumber(record.runs_extras)
      ?? readNumber(record.extra_runs)

    if (batterRuns !== null && extras !== null) {
      return Math.round(batterRuns + extras)
    }
  }

  return null
}

const collectJsonRecords = (value: unknown): JsonRecord[] => {
  const record = toJsonRecord(value)

  if (!record) {
    return []
  }

  const nested = Object.values(record).flatMap((item) => {
    if (Array.isArray(item)) {
      return item.flatMap((entry) => collectJsonRecords(entry))
    }

    return collectJsonRecords(item)
  })

  return [record, ...nested]
}

const firstText = (records: JsonRecord[], keys: string[]) => {
  for (const record of records) {
    for (const key of keys) {
      const value = readText(record[key])
      if (value) {
        return value
      }
    }
  }

  return null
}

const firstInteger = (records: JsonRecord[], keys: string[]) => {
  for (const record of records) {
    for (const key of keys) {
      const value = readNumber(record[key])
      if (value !== null) {
        return Math.round(value)
      }
    }
  }

  return null
}

const firstOverValue = (records: JsonRecord[], inPlay: JsonRecord | null) => {
  const raw = firstText(records, ["batting_overs", "overs", "over", "clock"])
  if (raw) {
    return parseCricketOverNotation(raw)
  }

  const clock = readText(inPlay?.clock)
  if (!clock) {
    return null
  }

  return parseCricketOverNotation(clock)
}

const firstBallValue = (records: JsonRecord[], inPlay: JsonRecord | null) => {
  const overs = firstOverValue(records, inPlay)
  if (overs !== null) {
    return oversToBalls(overs)
  }

  const explicitBalls = firstInteger(records, ["valid_balls", "balls_batted"])
  return explicitBalls !== null && explicitBalls > 0 ? explicitBalls : null
}

const oversToBalls = (overs: number) => {
  const completedOvers = Math.trunc(overs)
  const ballsInCurrentOver = Math.round((overs - completedOvers) * 10)
  return completedOvers * 6 + normalizeCricketBallPart(ballsInCurrentOver)
}

const parseCricketOverNotation = (value: string) => {
  const trimmed = value.trim()
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed)

  if (!match) {
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? roundMetric(parsed) : null
  }

  const completedOvers = Number(match[1])
  const ballsInCurrentOver = match[2] ? Number(match[2]) : 0
  const totalBalls = completedOvers * 6 + normalizeCricketBallPart(ballsInCurrentOver)
  const normalizedOvers = Math.trunc(totalBalls / 6) + (totalBalls % 6) / 10

  return roundMetric(normalizedOvers)
}

const normalizeCricketBallPart = (ballsInCurrentOver: number) => {
  if (!Number.isFinite(ballsInCurrentOver) || ballsInCurrentOver <= 0) {
    return 0
  }

  return Math.min(6, Math.round(ballsInCurrentOver))
}

const roundMetric = (value: number) => Number(value.toFixed(2))

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
