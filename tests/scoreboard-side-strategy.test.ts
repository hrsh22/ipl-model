import { describe, expect, test } from 'vitest'

import {
  SCOREBOARD_SIDE_END_BALL,
  SCOREBOARD_SIDE_START_BALL,
  SCOREBOARD_SIDE_STRATEGY_KEY,
  SCOREBOARD_SIDE_WINDOW_KEY,
  evaluateScoreboardSideStrategy,
  type ScoreboardSideStrategyInput,
} from '../src/ipl/scoreboard-side-strategy.js'

const buildInput = (overrides: Partial<ScoreboardSideStrategyInput> = {}): ScoreboardSideStrategyInput => ({
  fixtureId: 'fixture-scoreboard-side-001',
  inningsNumber: 2,
  legalBallsCompleted: SCOREBOARD_SIDE_START_BALL,
  firstInningsScore: 180,
  firstInningsBalls: 120,
  firstInningsWickets: 7,
  chasingScore: 110,
  wicketsLost: 3,
  targetRuns: 181,
  chaser: {
    team: 'Chennai Super Kings',
    price: 0.88,
    tokenSide: 'away',
  },
  defender: {
    team: 'Mumbai Indians',
    price: 0.62,
    tokenSide: 'home',
  },
  fixtureFinished: false,
  reducedOverRisk: false,
  dataQualityWarnings: [],
  ...overrides,
})

describe('scoreboard-side strategy evaluator', () => {
  test('buys the chaser when 11-to-13 over chase gates pass under the active cap', () => {
    const result = evaluateScoreboardSideStrategy(buildInput())

    expect(result).toMatchObject({
      strategyKey: SCOREBOARD_SIDE_STRATEGY_KEY,
      windowKey: SCOREBOARD_SIDE_WINDOW_KEY,
      strategyVersion: 'v1-value90',
      action: 'buy',
      signalSide: 'chaser',
      tokenSide: 'away',
      team: 'Chennai Super Kings',
      price: 0.88,
      allocationFraction: 0.2,
      priceCap: 0.9,
      mode: 'value90',
      blockers: [],
      reasons: ['CHASER_BUY_GATE_PASSED'],
    })
    expect(result.metrics).toMatchObject({
      legalBallsCompleted: 66,
      ballsLeft: 54,
      target: 181,
      runsNeeded: 71,
      wicketsLost: 3,
    })
    expect(result.metrics?.currentRunRate).toBe(10)
    expect(result.metrics?.requiredRunRate).toBeCloseTo(7.888889, 6)
    expect(result.strength).toBeCloseTo(75.511111, 6)
    expect(result.strengthLabel).toBe('strong')
  })

  test('buys a scoreboard-supported market underdog when chaser gates pass', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      chaser: {
        team: 'Chennai Super Kings',
        price: 0.37,
        tokenSide: 'away',
      },
      defender: {
        team: 'Mumbai Indians',
        price: 0.63,
        tokenSide: 'home',
      },
    }))

    expect(result).toMatchObject({
      action: 'buy',
      signalSide: 'chaser',
      tokenSide: 'away',
      team: 'Chennai Super Kings',
      price: 0.37,
      reasons: ['CHASER_BUY_GATE_PASSED'],
    })
    expect(result.price).toBeLessThan(0.63)
    expect(result.gates?.chaser).toMatchObject({
      rrrAtMostEleven: true,
      wicketsAtMostThree: true,
      currentRateAtLeastRequiredRate: true,
      priceAtOrBelowCap: true,
    })
  })

  test('buys the defender when chase pressure and wicket gates pass', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      legalBallsCompleted: SCOREBOARD_SIDE_END_BALL,
      firstInningsScore: 200,
      chasingScore: 80,
      targetRuns: 201,
      wicketsLost: 5,
      chaser: {
        team: 'Chennai Super Kings',
        price: 0.31,
        tokenSide: 'away',
      },
      defender: {
        team: 'Mumbai Indians',
        price: 0.89,
        tokenSide: 'home',
      },
    }))

    expect(result).toMatchObject({
      action: 'buy',
      signalSide: 'defender',
      tokenSide: 'home',
      team: 'Mumbai Indians',
      price: 0.89,
      blockers: [],
      reasons: ['DEFENDER_BUY_GATE_PASSED'],
    })
    expect(result.metrics?.currentRunRate).toBeCloseTo(6.153846, 6)
    expect(result.metrics?.requiredRunRate).toBeCloseTo(17.285714, 6)
    expect(result.strength).toBe(100)
    expect(result.strengthLabel).toBe('very-strong')
  })

  test('blocks settled defender markets at one cent even when defender buy gates otherwise pass', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      legalBallsCompleted: SCOREBOARD_SIDE_END_BALL,
      firstInningsScore: 200,
      chasingScore: 80,
      targetRuns: 201,
      wicketsLost: 5,
      chaser: {
        team: 'Chennai Super Kings',
        price: 0.31,
        tokenSide: 'away',
      },
      defender: {
        team: 'Mumbai Indians',
        price: 0.01,
        tokenSide: 'home',
      },
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      signalSide: null,
      tokenSide: null,
      team: null,
      price: null,
      blockers: ['SETTLED_MARKET'],
      reasons: ['SETTLED_MARKET'],
      gates: null,
    })
    expect(result.metrics?.requiredRunRate).toBeCloseTo(17.285714, 6)
  })

  test('blocks settled markets when either side is at ninety-nine cents', () => {
    const chaserSettled = evaluateScoreboardSideStrategy(buildInput({
      chaser: {
        team: 'Chennai Super Kings',
        price: 0.99,
        tokenSide: 'away',
      },
    }))
    const defenderSettled = evaluateScoreboardSideStrategy(buildInput({
      defender: {
        team: 'Mumbai Indians',
        price: 0.99,
        tokenSide: 'home',
      },
    }))

    expect(chaserSettled).toMatchObject({
      action: 'blocked',
      signalSide: null,
      blockers: ['SETTLED_MARKET'],
      reasons: ['SETTLED_MARKET'],
      gates: null,
    })
    expect(defenderSettled).toMatchObject({
      action: 'blocked',
      signalSide: null,
      blockers: ['SETTLED_MARKET'],
      reasons: ['SETTLED_MARKET'],
      gates: null,
    })
  })

  test('waits before ball 66 without evaluating buy gates', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      legalBallsCompleted: SCOREBOARD_SIDE_START_BALL - 1,
    }))

    expect(result).toMatchObject({
      action: 'wait',
      signalSide: null,
      tokenSide: null,
      blockers: ['BEFORE_WINDOW'],
      reasons: ['BEFORE_WINDOW'],
      gates: null,
    })
  })

  test('blocks non-second innings before any buy side is selected', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      inningsNumber: 1,
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      signalSide: null,
      tokenSide: null,
      blockers: ['NON_SECOND_INNINGS'],
      reasons: ['NON_SECOND_INNINGS'],
      gates: null,
    })
  })

  test('passes after ball 78 when no scoreboard-side trade was emitted', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      legalBallsCompleted: SCOREBOARD_SIDE_END_BALL + 1,
    }))

    expect(result).toMatchObject({
      action: 'passed',
      signalSide: null,
      tokenSide: null,
      blockers: ['AFTER_WINDOW'],
      reasons: ['AFTER_WINDOW'],
    })
  })

  test('waits with a price-above-cap reason when scoreboard gates pass but active cap fails', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      chaser: {
        team: 'Chennai Super Kings',
        price: 0.91,
        tokenSide: 'away',
      },
    }))

    expect(result).toMatchObject({
      action: 'wait',
      signalSide: null,
      tokenSide: null,
      blockers: [],
      reasons: ['PRICE_ABOVE_CAP'],
    })
    expect(result.gates?.chaser).toMatchObject({
      rrrAtMostEleven: true,
      wicketsAtMostThree: true,
      currentRateAtLeastRequiredRate: true,
      priceAtOrBelowCap: false,
    })
  })

  test('blocks missing scoreboard balls and missing market side data', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      legalBallsCompleted: null,
      chaser: {
        team: null,
        price: null,
      },
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      metrics: null,
      blockers: ['MISSING_BALLS', 'MISSING_TEAM_OR_PRICE'],
      reasons: ['MISSING_BALLS', 'MISSING_TEAM_OR_PRICE'],
    })
  })

  test('blocks missing scoreboard data without mislabeling present teams and prices', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      firstInningsScore: null,
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      signalSide: null,
      tokenSide: null,
      metrics: null,
      blockers: ['MISSING_SCOREBOARD_DATA'],
      reasons: ['MISSING_SCOREBOARD_DATA'],
      gates: null,
    })
    expect(result.blockers).not.toContain('MISSING_TEAM_OR_PRICE')
    expect(result.reasons).not.toContain('MISSING_TEAM_OR_PRICE')
  })

  test('blocks missing chase target as reduced-scoreboard risk before using derived targets', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      targetRuns: null,
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      signalSide: null,
      tokenSide: null,
      blockers: ['MISSING_TARGET'],
      reasons: ['MISSING_TARGET'],
      gates: null,
    })
  })

  test('blocks when the chase target has already been reached', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      chasingScore: 181,
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      blockers: ['TARGET_REACHED'],
      reasons: ['TARGET_REACHED'],
    })
    expect(result.metrics?.runsNeeded).toBe(0)
  })

  test('blocks all-out or no-balls-left states before emitting a side', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      wicketsLost: 10,
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      signalSide: null,
      blockers: ['ALL_OUT_OR_NO_BALLS_LEFT'],
      reasons: ['ALL_OUT_OR_NO_BALLS_LEFT'],
    })
  })

  test('blocks caller-provided reduced-over risk and target mismatches before trading', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      reducedOverRisk: true,
      targetRuns: 180,
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      signalSide: null,
      blockers: ['REDUCED_OVER_RISK', 'TARGET_MISMATCH'],
      reasons: ['REDUCED_OVER_RISK', 'TARGET_MISMATCH'],
    })
  })

  test('computes reduced-over risk from incomplete first innings not all out', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      firstInningsBalls: 108,
      firstInningsWickets: 8,
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      signalSide: null,
      blockers: ['REDUCED_OVER_RISK'],
      reasons: ['REDUCED_OVER_RISK'],
    })
  })

  test('does not compute reduced-over risk when shortened first innings ended all out', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      firstInningsBalls: 108,
      firstInningsWickets: 10,
    }))

    expect(result).toMatchObject({
      action: 'buy',
      signalSide: 'chaser',
      blockers: [],
      reasons: ['CHASER_BUY_GATE_PASSED'],
    })
  })

  test('blocks finished fixtures and tie or super-over data integrity warnings', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      fixtureFinished: true,
      dataQualityWarnings: ['super-over pending after tie'],
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      blockers: ['FIXTURE_FINISHED', 'DATA_INTEGRITY_WARNING'],
      reasons: ['FIXTURE_FINISHED', 'DATA_INTEGRITY_WARNING'],
    })
  })

  test('blocks reduced-data and tie integrity warnings even when score gates pass', () => {
    const result = evaluateScoreboardSideStrategy(buildInput({
      dataQualityWarnings: ['reduced-data target audit failed after tie'],
    }))

    expect(result).toMatchObject({
      action: 'blocked',
      signalSide: null,
      blockers: ['DATA_INTEGRITY_WARNING'],
      reasons: ['DATA_INTEGRITY_WARNING'],
      gates: null,
    })
  })

  test('uses mode-specific caps and allocation fractions', () => {
    const defaultResult = evaluateScoreboardSideStrategy(buildInput({
      chaser: {
        team: 'Chennai Super Kings',
        price: 0.94,
        tokenSide: 'away',
      },
    }))
    const volumeResult = evaluateScoreboardSideStrategy(buildInput({
      mode: 'volume95',
      chaser: {
        team: 'Chennai Super Kings',
        price: 0.94,
        tokenSide: 'away',
      },
    }))

    expect(defaultResult).toMatchObject({
      action: 'wait',
      strategyVersion: 'v1-value90',
      priceCap: 0.9,
      allocationFraction: 0.2,
      reasons: ['PRICE_ABOVE_CAP'],
    })
    expect(volumeResult).toMatchObject({
      action: 'buy',
      signalSide: 'chaser',
      tokenSide: 'away',
      strategyVersion: 'v1-volume95',
      priceCap: 0.95,
      allocationFraction: 0.1,
      reasons: ['CHASER_BUY_GATE_PASSED'],
    })
  })
})
