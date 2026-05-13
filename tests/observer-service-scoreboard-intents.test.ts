import { beforeEach, describe, expect, test, vi } from 'vitest'

const createObserverTradeIntentMock = vi.hoisted(() => vi.fn())
const insertLiveModelSnapshotMock = vi.hoisted(() => vi.fn())
const insertLiveModelSignalMock = vi.hoisted(() => vi.fn())

vi.mock('../src/trading/observer-intents.js', () => ({
  createObserverTradeIntent: createObserverTradeIntentMock,
}))

vi.mock('../src/observer/repository.js', () => ({
  getFixture: vi.fn(),
  getLiveFixtureByTeams: vi.fn(),
  insertLiveModelSignal: insertLiveModelSignalMock,
  insertLiveModelSnapshot: insertLiveModelSnapshotMock,
  insertSignal: vi.fn(),
  listFixtureLiveModelSignals: vi.fn(async () => []),
  listFixtureLiveModelSnapshots: vi.fn(async () => []),
  listFixtureOdds: vi.fn(async () => []),
  listFixtureSignals: vi.fn(async () => []),
  listFixtures: vi.fn(async () => []),
  listLiveModelSignals: vi.fn(async () => []),
  listLiveModelSnapshots: vi.fn(async () => []),
  listSignals: vi.fn(async () => []),
  upsertFixture: vi.fn(),
}))

const FIXED_NOW = new Date('2026-05-11T10:12:00.000Z')

type ObserverServiceHarness = {
  liveModelPersistenceDisabledReason: string | null
  lastLiveModelSnapshotAt: Map<string, number>
  lastLiveModelSignalAt: Map<string, { edgeBps: number; observedAt: number }>
  recordLiveModelSnapshot: (fixtureState: ReturnType<typeof buildFixtureState>, sourceEvent: string, overlay: unknown) => Promise<void>
}

const buildFixtureState = () => {
  const fixture = {
    id: 'fixture-1',
    opticOddsGameId: 'optic-1',
    sport: 'cricket',
    league: 'India - IPL',
    homeTeam: 'Mumbai Indians',
    awayTeam: 'Chennai Super Kings',
    homeTeamId: null,
    awayTeamId: null,
    startTime: new Date('2026-05-11T09:00:00.000Z'),
    status: 'live',
    isLive: true,
    venueName: null,
    venueLocation: null,
    polymarketEventSlug: 'mumbai-vs-chennai-event',
    polymarketMarketSlug: 'mumbai-vs-chennai',
    polymarketConditionId: 'condition-1',
    homeTokenId: 'token-home',
    awayTokenId: 'token-away',
    lastScore: null,
    lastPeriod: null,
    lastResultPayload: {
      scores: {
        home: { total: 180 },
        away: { total: 70 },
      },
      stats: {
        home: [{ period: 'period_1', stats: { batting_overs: '20.0', batting_runs: 180, batting_wickets: 7 } }],
        away: [{ period: 'period_2', stats: { batting_overs: '11.0', batting_runs: 70, batting_wickets: 5 } }],
      },
    },
    createdAt: FIXED_NOW,
    updatedAt: new Date(),
  }

  return {
    fixture,
    oddsByBook: new Map(),
    tokenToSelection: new Map([
      ['token-home', 'mumbai_indians'],
      ['token-away', 'chennai_super_kings'],
    ]),
    selectionToToken: new Map([
      ['mumbai_indians', 'token-home'],
      ['chennai_super_kings', 'token-away'],
    ]),
    polymarketBooks: new Map([
      ['token-home', {
        tokenId: 'token-home',
        bestBid: 0.36,
        bestAsk: 0.38,
        lastTradePrice: null,
        bids: [[0.36, 500]],
        asks: [[0.38, 500]],
        updatedAt: new Date(),
      }],
      ['token-away', {
        tokenId: 'token-away',
        bestBid: 0.62,
        bestAsk: 0.64,
        lastTradePrice: null,
        bids: [[0.62, 500]],
        asks: [[0.64, 500]],
        updatedAt: new Date(),
      }],
    ]),
    lastSignals: new Map(),
  }
}

const buildBallStateOverlay = () => ({
  available: true,
  currentState: {
    fixtureId: 'fixture-1',
    innings: 2,
    battingTeam: 'Chennai Super Kings',
    bowlingTeam: 'Mumbai Indians',
    scoreRuns: 70,
    scoreWickets: 5,
    balls: 66,
  },
  predictions: {
    expectedRunsNow: 70,
    expectedWicketsNow: 5,
    runsDelta: 0,
    wicketsDelta: 0,
    finalInningsRuns: 142,
    battingTeamMatchWinProbability: null,
    chaseSuccessProbability: 0.62,
  },
})

const getObserverServiceHarness = async () => {
  const { observerService } = await import('../src/observer/service.js')
  const service = observerService as unknown as ObserverServiceHarness
  service.liveModelPersistenceDisabledReason = null
  service.lastLiveModelSnapshotAt.clear()
  service.lastLiveModelSignalAt.clear()
  return service
}

describe('observer service scoreboard-side intent wiring', () => {
  beforeEach(() => {
    process.env.PORT = '3000'
    process.env.LOG_LEVEL = 'info'
    process.env.DATABASE_URL = 'postgresql://localhost:5432/ipl_trader_test'
    vi.clearAllMocks()
    insertLiveModelSnapshotMock.mockResolvedValue(101)
    createObserverTradeIntentMock.mockResolvedValue({
      status: 'ignored',
      reason: 'STRATEGY_WAIT',
      evaluation: { windowKey: 'balls-66-78' },
    })
  })

  test('evaluates scoreboard-side intent creation on a live ball even when model edge is below signal threshold', async () => {
    const service = await getObserverServiceHarness()

    await service.recordLiveModelSnapshot(buildFixtureState(), 'ball-state-runtime', buildBallStateOverlay())

    expect(createObserverTradeIntentMock).toHaveBeenCalledTimes(1)
    expect(insertLiveModelSignalMock).not.toHaveBeenCalled()
    expect(createObserverTradeIntentMock).toHaveBeenCalledWith(expect.objectContaining({
      fixture: expect.objectContaining({
        id: 'fixture-1',
        isLive: true,
        polymarketMarketSlug: 'mumbai-vs-chennai',
        homeTokenId: 'token-home',
        awayTokenId: 'token-away',
      }),
      inningsStates: expect.objectContaining({
        activeInnings: 2,
        first: expect.objectContaining({
          innings: 1,
          status: 'frozen',
          expectedRunsNow: 180,
          runsDelta: 0,
          projectedScore: 180,
        }),
        second: expect.objectContaining({
          innings: 2,
          status: 'live',
          balls: 66,
          battingTeam: 'Chennai Super Kings',
        }),
      }),
      home: expect.objectContaining({
        team: 'Mumbai Indians',
        marketProbability: 0.37,
        edgeVsMarketBps: 100,
      }),
      away: expect.objectContaining({
        team: 'Chennai Super Kings',
        marketProbability: 0.63,
        edgeVsMarketBps: -100,
      }),
      sourceEvent: 'ball-state-runtime',
    }))
    expect(insertLiveModelSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({
      innings: 1,
      scoreRuns: 180,
      expectedRunsNow: 180,
      runsDelta: 0,
      projectedScore: 180,
    }))
  })

  test('continues evaluating scoreboard-side intents after live-model persistence is disabled', async () => {
    const service = await getObserverServiceHarness()
    insertLiveModelSnapshotMock.mockRejectedValueOnce(Object.assign(new Error('relation observer_live_model_snapshots does not exist'), { code: '42P01' }))

    await service.recordLiveModelSnapshot(buildFixtureState(), 'ball-state-runtime', buildBallStateOverlay())
    await service.recordLiveModelSnapshot(buildFixtureState(), 'ball-state-runtime', buildBallStateOverlay())

    expect(service.liveModelPersistenceDisabledReason).toContain('observer_live_model_snapshots')
    expect(createObserverTradeIntentMock).toHaveBeenCalledTimes(2)
    expect(insertLiveModelSnapshotMock).toHaveBeenCalledTimes(2)
    expect(insertLiveModelSignalMock).not.toHaveBeenCalled()
  })
})
