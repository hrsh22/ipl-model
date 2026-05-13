import { afterEach, describe, expect, test, vi } from 'vitest'

import { loadObserverDashboard } from '../apps/web/src/routes/observer.js'
import { buildScoreboardAction, loadStrategyDashboard } from '../apps/web/src/routes/eleven-over.js'
import { tradingEventsProxyPath } from '../apps/web/src/routes/api/observer/trading/events.js'
import { tradingIntentsProxyPath } from '../apps/web/src/routes/api/observer/trading/intents.js'

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, { status })

const liveModelFixture = {
  fixture: {
    id: 'fixture-1',
    homeTeam: 'Chennai Super Kings',
    awayTeam: 'Delhi Capitals',
    venueName: 'Chennai',
    status: 'live',
    isLive: true,
    score: '100/2',
    period: '2nd innings',
    updatedAt: '2026-05-11T10:00:00.000Z',
  },
  modelVersion: 'test',
  confidence: 'high',
  expectedState: {
    innings: 2,
    battingTeam: 'Chennai Super Kings',
    bowlingTeam: 'Delhi Capitals',
    scoreRuns: 100,
    scoreWickets: 2,
    overs: 11,
    balls: 66,
    targetRuns: 170,
    expectedRunsNow: null,
    expectedWicketsNow: null,
    runsDelta: null,
    wicketsDelta: null,
    projectedScore: null,
    expectedRunRate: null,
    battingTeamWinProbability: null,
    chaseSuccessProbability: null,
  },
  inningsStates: {
    activeInnings: 2,
    first: {
      innings: 1,
      battingTeam: 'Delhi Capitals',
      bowlingTeam: 'Chennai Super Kings',
      scoreRuns: 169,
      scoreWickets: 6,
      overs: 20,
      balls: 120,
      targetRuns: null,
      expectedRunsNow: null,
      expectedWicketsNow: null,
      runsDelta: null,
      wicketsDelta: null,
      projectedScore: null,
      expectedRunRate: null,
      battingTeamWinProbability: null,
      chaseSuccessProbability: null,
      status: 'frozen',
    },
    second: {
      innings: 2,
      battingTeam: 'Chennai Super Kings',
      bowlingTeam: 'Delhi Capitals',
      scoreRuns: 100,
      scoreWickets: 2,
      overs: 11,
      balls: 66,
      targetRuns: 170,
      expectedRunsNow: null,
      expectedWicketsNow: null,
      runsDelta: null,
      wicketsDelta: null,
      projectedScore: null,
      expectedRunRate: null,
      battingTeamWinProbability: null,
      chaseSuccessProbability: null,
      status: 'live',
    },
  },
  venueContext: null,
  home: {
    team: 'Chennai Super Kings',
    winProbability: null,
    fairProbability: null,
    marketProbability: 0.92,
    referenceProbability: null,
    edgeVsMarketBps: null,
  },
  away: {
    team: 'Delhi Capitals',
    winProbability: null,
    fairProbability: null,
    marketProbability: 0.08,
    referenceProbability: null,
    edgeVsMarketBps: null,
  },
}

describe('observer dashboard helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('uses the configured scoreboard-side price cap for BUY/WAIT display', () => {
    const value90Action = buildScoreboardAction(liveModelFixture, liveModelFixture.inningsStates, 0.9)
    const volume95Action = buildScoreboardAction(liveModelFixture, liveModelFixture.inningsStates, 0.95)

    expect(value90Action.status).toBe('wait')
    expect(value90Action.priceCap).toBe(0.9)
    expect(value90Action.blockers).toContain('Chaser price 92¢ is above the 90¢ cap.')
    expect(volume95Action.status).toBe('buy')
    expect(volume95Action.priceCap).toBe(0.95)
  })

  test('observer dashboard does not fetch trading status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/observer/ready') return jsonResponse({ ready: true })
      if (url === '/api/observer/live-model') return jsonResponse([])
      if (url === '/api/observer/live-model/signals?limit=8') return jsonResponse([])
      if (url === '/api/observer/live-model/history?limit=12') return jsonResponse([])
      return jsonResponse({ error: 'unexpected fetch' }, 404)
    }))

    await expect(loadObserverDashboard()).resolves.toMatchObject({
      ready: { ready: true },
      fixtures: [],
      signals: [],
      history: [],
    })
    expect(fetch).not.toHaveBeenCalledWith('/api/observer/trading/status')
  })

  test('keeps 11-over dashboard data when trading status is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/observer/ready') return jsonResponse({ ready: true })
      if (url === '/api/observer/live-model') return jsonResponse([])
      if (url === '/api/observer/fixtures') return jsonResponse([])
      if (url === '/api/predictor/fixtures') return jsonResponse([])
      if (url === '/api/scanner/default-market') return jsonResponse({ error: 'default unavailable' }, 500)
      if (url === '/api/observer/trading/status') return jsonResponse({ error: 'trading unavailable' }, 500)
      return jsonResponse({ error: 'unexpected fetch' }, 404)
    }))

    await expect(loadStrategyDashboard()).resolves.toMatchObject({
      ready: { ready: true },
      fixtures: [],
      observerFixtures: [],
      scheduleFixtures: [],
      defaultMarket: null,
      tradingStatus: null,
    })
  })
})

describe('observer trading proxy paths', () => {
  test('forwards all trading intent query parameters unchanged', () => {
    expect(tradingIntentsProxyPath('https://web.local/api/observer/trading/intents?status=submitted&limit=20')).toBe('/trading/intents?status=submitted&limit=20')
  })

  test('forwards all trading event query parameters unchanged', () => {
    expect(tradingEventsProxyPath('https://web.local/api/observer/trading/events?intentId=123&limit=25')).toBe('/trading/events?intentId=123&limit=25')
  })
})
