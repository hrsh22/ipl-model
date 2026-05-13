import { describe, expect, test } from 'vitest'

import {
  buildTradeIntentKey,
  buildTradingExecutionEventInsert,
  claimNextTradeIntentWithStore,
  createTradeIntentWithStore,
  type CreateTradeIntentInput,
  type TradingIntentRecord,
  type TradingPersistenceStore,
} from '../src/trading/repository.js'

const createIntentInput = (): CreateTradeIntentInput => ({
  recipeKey: 'recipe:scoreboard-side-11-13:v1-value90:balls-66-78:fixture-scoreboard-side-001:market-001:token-home-001:buy',
  strategyKey: 'scoreboard-side-11-13',
  recipeVersion: 'v1-value90',
  windowKey: 'balls-66-78',
  fixtureId: 'fixture-scoreboard-side-001',
  marketId: 'market-001',
  conditionId: 'condition-001',
  tokenId: 'token-home-001',
  side: 'buy',
  context: { safe: true },
})

const createIntentRecord = (
  id: number,
  input: CreateTradeIntentInput,
  overrides: Partial<TradingIntentRecord> = {},
): TradingIntentRecord => {
  const createdAt = overrides.createdAt ?? new Date('2026-05-11T10:00:00.000Z')

  return {
    id,
    intentKey: overrides.intentKey ?? buildTradeIntentKey(input),
    recipeKey: overrides.recipeKey ?? input.recipeKey,
    strategyKey: overrides.strategyKey ?? input.strategyKey,
    recipeVersion: overrides.recipeVersion ?? input.recipeVersion,
    windowKey: overrides.windowKey ?? input.windowKey,
    fixtureId: overrides.fixtureId ?? input.fixtureId,
    marketId: overrides.marketId ?? input.marketId,
    conditionId: overrides.conditionId ?? input.conditionId,
    tokenId: overrides.tokenId ?? input.tokenId,
    side: overrides.side ?? input.side,
    status: overrides.status ?? 'pending',
    claimCount: overrides.claimCount ?? 0,
    claimedBy: overrides.claimedBy ?? null,
    claimedAt: overrides.claimedAt ?? null,
    claimExpiresAt: overrides.claimExpiresAt ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
    context: overrides.context ?? input.context ?? null,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
  }
}

describe('trading repository helpers', () => {
  test('duplicate intent creation is deterministic and returns the existing row on conflict', async () => {
    const input = createIntentInput()
    const existing = createIntentRecord(7, input)
    const store: TradingPersistenceStore = {
      insertTradeIntent: async () => null,
      findTradeIntentByKey: async (intentKey) =>
        intentKey === existing.intentKey ? existing : null,
      findTradeIntentByFixtureScope: async () => null,
      listClaimableTradeIntentIds: async () => [],
      tryClaimTradeIntent: async () => null,
    }

    const result = await createTradeIntentWithStore(store, input)

    expect(result.created).toBe(false)
    expect(result.record).toEqual(existing)
  })

  test('fixture-level one-shot guard returns existing intent for the opposite token', async () => {
    const input = createIntentInput()
    const existing = createIntentRecord(11, input, { tokenId: 'token-home-001' })
    const oppositeTokenInput = {
      ...input,
      recipeKey: 'recipe:scoreboard-side-11-13:v1-value90:balls-66-78:fixture-scoreboard-side-001:market-001:token-away-001:buy',
      tokenId: 'token-away-001',
    } satisfies CreateTradeIntentInput
    const store: TradingPersistenceStore = {
      insertTradeIntent: async () => createIntentRecord(12, oppositeTokenInput),
      findTradeIntentByKey: async () => null,
      findTradeIntentByFixtureScope: async (identity) =>
        identity.strategyKey === existing.strategyKey &&
        identity.windowKey === existing.windowKey &&
        identity.fixtureId === existing.fixtureId &&
        identity.marketId === existing.marketId &&
        identity.side === existing.side
          ? existing
          : null,
      listClaimableTradeIntentIds: async () => [],
      tryClaimTradeIntent: async () => null,
    }

    const result = await createTradeIntentWithStore(store, oppositeTokenInput)

    expect(result.created).toBe(false)
    expect(result.record).toEqual(existing)
  })

  test('fixture-level one-shot guard allows the same strategy and market on a different fixture', async () => {
    const input = createIntentInput()
    const existing = createIntentRecord(21, input, { tokenId: 'token-home-001' })
    const differentFixtureInput = {
      ...input,
      recipeKey: 'recipe:scoreboard-side-11-13:v1-value90:balls-66-78:fixture-scoreboard-side-002:market-001:token-away-001:buy',
      fixtureId: 'fixture-2',
      tokenId: 'token-away-001',
    } satisfies CreateTradeIntentInput
    const created = createIntentRecord(22, differentFixtureInput)
    const store: TradingPersistenceStore = {
      insertTradeIntent: async () => created,
      findTradeIntentByKey: async () => null,
      findTradeIntentByFixtureScope: async (identity) =>
        identity.fixtureId === existing.fixtureId ? existing : null,
      listClaimableTradeIntentIds: async () => [],
      tryClaimTradeIntent: async () => null,
    }

    const result = await createTradeIntentWithStore(store, differentFixtureInput)

    expect(result.created).toBe(true)
    expect(result.record).toEqual(created)
  })

  test('fixture-level one-shot guard is skipped for non-scoreboard strategies', async () => {
    const input = {
      ...createIntentInput(),
      recipeKey: 'recipe:other-strategy:v1:fixture-scoreboard-side-001:market-001:token-home-001:buy',
      strategyKey: 'other-strategy',
      recipeVersion: 'v1',
    } satisfies CreateTradeIntentInput
    const existing = createIntentRecord(25, input, { tokenId: 'token-home-001' })
    const oppositeTokenInput = {
      ...input,
      recipeKey: 'recipe:other-strategy:v2:fixture-scoreboard-side-001:market-001:token-away-001:buy',
      recipeVersion: 'v2',
      tokenId: 'token-away-001',
    } satisfies CreateTradeIntentInput
    const created = createIntentRecord(26, oppositeTokenInput)
    const records: TradingIntentRecord[] = [existing]
    const store: TradingPersistenceStore = {
      insertTradeIntent: async () => {
        records.push(created)
        return created
      },
      findTradeIntentByKey: async () => null,
      findTradeIntentByFixtureScope: async (identity) =>
        identity.strategyKey === 'scoreboard-side-11-13'
          ? records.find((record) => (
              record.strategyKey === identity.strategyKey &&
              record.windowKey === identity.windowKey &&
              record.fixtureId === identity.fixtureId &&
              record.marketId === identity.marketId &&
              record.side === identity.side
            )) ?? null
          : null,
      listClaimableTradeIntentIds: async () => [],
      tryClaimTradeIntent: async () => null,
    }

    const result = await createTradeIntentWithStore(store, oppositeTokenInput)

    expect(result.created).toBe(true)
    expect(result.record).toEqual(created)
  })

  test('fixture-level one-shot guard returns existing intent after a recipe version mode switch', async () => {
    const input = createIntentInput()
    const existing = createIntentRecord(23, input, {
      recipeVersion: 'v1-value90',
      tokenId: 'token-home-001',
    })
    const volumeModeInput = {
      ...input,
      recipeKey: 'recipe:scoreboard-side-11-13:v1-volume95:balls-66-78:fixture-scoreboard-side-001:market-001:token-away-001:buy',
      recipeVersion: 'v1-volume95',
      tokenId: 'token-away-001',
    } satisfies CreateTradeIntentInput
    const store: TradingPersistenceStore = {
      insertTradeIntent: async () => createIntentRecord(24, volumeModeInput),
      findTradeIntentByKey: async () => null,
      findTradeIntentByFixtureScope: async (identity) =>
        identity.strategyKey === existing.strategyKey &&
        identity.windowKey === existing.windowKey &&
        identity.fixtureId === existing.fixtureId &&
        identity.marketId === existing.marketId &&
        identity.side === existing.side
          ? existing
          : null,
      listClaimableTradeIntentIds: async () => [],
      tryClaimTradeIntent: async () => null,
    }

    const result = await createTradeIntentWithStore(store, volumeModeInput)

    expect(result.created).toBe(false)
    expect(result.record).toEqual(existing)
  })

  test('fixture-level conflict fallback returns existing opposite-token intent after insert conflict', async () => {
    const input = createIntentInput()
    const existing = createIntentRecord(31, input, { tokenId: 'token-home-001' })
    const oppositeTokenInput = {
      ...input,
      recipeKey: 'recipe:scoreboard-side-11-13:v1-value90:balls-66-78:fixture-scoreboard-side-001:market-001:token-away-001:buy',
      tokenId: 'token-away-001',
    } satisfies CreateTradeIntentInput
    let fixtureScopeLookups = 0
    const calls: string[] = []
    const store: TradingPersistenceStore = {
      insertTradeIntent: async () => {
        calls.push('insert-conflict')
        return null
      },
      findTradeIntentByKey: async () => {
        calls.push('intent-key-miss')
        return null
      },
      findTradeIntentByFixtureScope: async () => {
        fixtureScopeLookups += 1
        calls.push(fixtureScopeLookups === 1 ? 'fixture-precheck-miss' : 'fixture-fallback-hit')
        return fixtureScopeLookups === 1 ? null : existing
      },
      listClaimableTradeIntentIds: async () => [],
      tryClaimTradeIntent: async () => null,
    }

    const result = await createTradeIntentWithStore(store, oppositeTokenInput)

    expect(result.created).toBe(false)
    expect(result.record).toEqual(existing)
    expect(calls).toEqual([
      'fixture-precheck-miss',
      'insert-conflict',
      'intent-key-miss',
      'fixture-fallback-hit',
    ])
  })

  test('overlapping workers can safely claim different intents without double-claiming one row', async () => {
    const input = createIntentInput()
    const otherInput = {
      ...createIntentInput(),
      recipeKey: 'recipe:11-over:v1:other',
      marketId: 'market-2',
      tokenId: 'token-2',
    } satisfies CreateTradeIntentInput

    const now = new Date('2026-05-11T10:05:00.000Z')
    const first = createIntentRecord(1, input, { createdAt: new Date('2026-05-11T10:00:00.000Z') })
    const second = createIntentRecord(2, otherInput, {
      intentKey: buildTradeIntentKey(otherInput),
      createdAt: new Date('2026-05-11T10:01:00.000Z'),
    })
    const records = new Map<number, TradingIntentRecord>([
      [first.id, first],
      [second.id, second],
    ])

    const store: TradingPersistenceStore = {
      insertTradeIntent: async () => null,
      findTradeIntentByKey: async () => null,
      findTradeIntentByFixtureScope: async () => null,
      listClaimableTradeIntentIds: async () => [1, 2],
      tryClaimTradeIntent: async (intentId, workerId, claimedAt, claimExpiresAt) => {
        const current = records.get(intentId)
        if (!current || current.status !== 'pending') {
          return null
        }

        const claimed: TradingIntentRecord = {
          ...current,
          status: 'claimed',
          claimCount: current.claimCount + 1,
          claimedBy: workerId,
          claimedAt,
          claimExpiresAt,
          updatedAt: claimedAt,
        }
        records.set(intentId, claimed)
        return claimed
      },
    }

    const [workerOne, workerTwo] = await Promise.all([
      claimNextTradeIntentWithStore(store, { workerId: 'worker-1', now, leaseMs: 30_000 }),
      claimNextTradeIntentWithStore(store, { workerId: 'worker-2', now, leaseMs: 30_000 }),
    ])

    expect(workerOne?.id).toBe(1)
    expect(workerOne?.claimedBy).toBe('worker-1')
    expect(workerTwo?.id).toBe(2)
    expect(workerTwo?.claimedBy).toBe('worker-2')
    expect(records.get(1)?.claimCount).toBe(1)
    expect(records.get(2)?.claimCount).toBe(1)
  })

  test('execution event inserts always include both event and processing timestamps', async () => {
    const eventTime = new Date('2026-05-11T10:00:00.000Z')
    const before = Date.now()

    const event = buildTradingExecutionEventInsert({
      intentId: 3,
      eventType: 'submitted',
      eventTime,
      executorId: 'worker-1',
      details: { orderId: 'safe-order-id' },
    })
    const after = Date.now()
    const explicitProcessedAt = new Date('2026-05-11T10:00:05.000Z')
    const explicitEvent = buildTradingExecutionEventInsert({
      intentId: 3,
      eventType: 'submitted',
      eventTime,
      processedAt: explicitProcessedAt,
    })

    expect(event.eventTime).toEqual(eventTime)
    expect(event.processedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(event.processedAt.getTime()).toBeLessThanOrEqual(after)
    expect(event.details).toEqual({ orderId: 'safe-order-id' })
    expect(event.executorId).toBe('worker-1')
    expect(explicitEvent.processedAt).toEqual(explicitProcessedAt)
    expect(explicitEvent.eventTime).toEqual(eventTime)
  })
})
