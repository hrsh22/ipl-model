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
  recipeKey: 'recipe:11-over:v1',
  strategyKey: 'eleven-over',
  recipeVersion: '2026-05-11-v1',
  windowKey: '2026-05-11-v1:fixture-1:innings-2:balls-66-72',
  fixtureId: 'fixture-1',
  marketId: 'market-1',
  conditionId: 'condition-1',
  tokenId: 'token-1',
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
      listClaimableTradeIntentIds: async () => [],
      tryClaimTradeIntent: async () => null,
    }

    const result = await createTradeIntentWithStore(store, input)

    expect(result.created).toBe(false)
    expect(result.record).toEqual(existing)
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
