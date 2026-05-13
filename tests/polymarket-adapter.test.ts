import { describe, expect, test, vi } from 'vitest'

import {
  MockPolymarketTradingAdapter,
  PolymarketAdapterError,
  PolymarketClobV2LiveClient,
  buildPolymarketTradingAdapter,
  classifyPolymarketError,
  createPolymarketClobV2LiveClient,
  createPolymarketLogSafePayload,
  type PolymarketCreateOrderRequest,
  type PolymarketClobV2SdkClient,
} from '../src/trading/polymarket-adapter.js'
import { validateTradingRecipe } from '../src/trading/config.js'

const FAKE_PRIVATE_KEY = '0xFAKE_PRIVATE_KEY_TEST_VALUE'
const VALID_TEST_PRIVATE_KEY = `0x${'1'.repeat(64)}`
const FAKE_BUILDER_CODE = `0x${'2'.repeat(64)}`
const FAKE_API_KEY = 'FAKE_API_KEY_TEST_VALUE'
const FAKE_SECRET = 'FAKE_SECRET_TEST_VALUE'
const FAKE_PASSPHRASE = 'FAKE_PASSPHRASE_TEST_VALUE'

const buildCreateOrderRequest = (): PolymarketCreateOrderRequest => ({
  marketId: 'market-1',
  conditionId: 'condition-1',
  tokenId: 'token-home',
  side: 'buy',
  orderStyle: 'limit',
  price: 0.41,
  size: 25,
  expirationMs: 1_800_000_000_000,
  clientOrderId: 'client-order-1',
})

const buildLiveReadyRecipe = () => {
  const recipe = validateTradingRecipe({
    marketId: 'market-1',
    conditionId: 'condition-1',
    tokenId: 'token-home',
    side: 'buy',
    orderStyle: 'limit',
    maxPrice: 0.41,
    expiryEpochMs: 1_800_000_000_000,
  })

  if (!recipe.ok) {
    throw new Error(`Expected valid recipe fixture: ${recipe.errors.join(', ')}`)
  }

  return recipe.value
}

describe('polymarket adapter boundary', () => {
  test('stays dry-run and unreachable when live readiness has not passed', async () => {
    const adapter = buildPolymarketTradingAdapter({
      requestedMode: 'live',
      readiness: {
        liveReady: false,
        mode: 'dry-run',
        reasons: [{ code: 'ENV_LIVE_GATE_DISABLED' }],
      },
    })

    expect(adapter.mode).toBe('dry-run')
    await expect(adapter.createOrder(buildCreateOrderRequest())).rejects.toMatchObject({
      name: 'PolymarketAdapterError',
      safeContext: {
        details: {
          reasons: [{ code: 'ENV_LIVE_GATE_DISABLED' }],
        },
      },
    })

    await expect(adapter.selfTest()).resolves.toEqual({
      ok: false,
      mode: 'dry-run',
      authenticated: false,
      reasons: ['ENV_LIVE_GATE_DISABLED'],
    })
  })

  test('can build a live adapter only after readiness passes and a client is injected', async () => {
    const adapter = buildPolymarketTradingAdapter({
      requestedMode: 'live',
      readiness: {
        liveReady: true,
        mode: 'live',
        recipe: buildLiveReadyRecipe(),
        reasons: [],
      },
      liveClient: {
        lookupMarket: async () => null,
        createOrder: async (request) => ({
          orderId: 'live-order-1',
          clientOrderId: request.clientOrderId ?? null,
          marketId: request.marketId,
          conditionId: request.conditionId,
          tokenId: request.tokenId,
          side: request.side,
          orderStyle: request.orderStyle,
          price: request.price,
          size: request.size,
          status: 'open',
          matchedSize: 0,
          remainingSize: request.size,
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:00.000Z',
          reason: null,
          duplicateOfOrderId: null,
        }),
        cancelOrder: async () => {
          throw new Error('not needed in this test')
        },
        getOrder: async () => null,
        getTrades: async () => [],
        subscribeUserUpdates: async () => () => undefined,
        selfTest: async () => ({ ok: true, authenticated: true, reasons: [] }),
      },
    })

    expect(adapter.mode).toBe('live')
    await expect(adapter.selfTest()).resolves.toEqual({
      ok: true,
      mode: 'live',
      authenticated: true,
      reasons: [],
    })
  })

  test('keeps live adapter available when env and credentials are ready before recipes seed', async () => {
    const adapter = buildPolymarketTradingAdapter({
      requestedMode: 'live',
      readiness: {
        liveReady: false,
        mode: 'dry-run',
        reasons: [{ code: 'RECIPE_MISSING' }],
      },
      liveClient: {
        lookupMarket: async () => null,
        createOrder: async (request) => ({
          orderId: 'late-recipe-live-order',
          clientOrderId: request.clientOrderId ?? null,
          marketId: request.marketId,
          conditionId: request.conditionId,
          tokenId: request.tokenId,
          side: request.side,
          orderStyle: request.orderStyle,
          price: request.price,
          size: request.size,
          status: 'open',
          matchedSize: 0,
          remainingSize: request.size,
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:00.000Z',
          reason: null,
          duplicateOfOrderId: null,
        }),
        cancelOrder: async () => {
          throw new Error('not needed in this test')
        },
        getOrder: async () => null,
        getTrades: async () => [],
        subscribeUserUpdates: async () => () => undefined,
        selfTest: async () => ({ ok: true, authenticated: true, reasons: [] }),
      },
    })

    expect(adapter.mode).toBe('live')
    await expect(adapter.createOrder(buildCreateOrderRequest())).resolves.toMatchObject({
      orderId: 'late-recipe-live-order',
    })
  })

  test('package-backed CLOB V2 live client factory fails closed without required signing and builder inputs', async () => {
    const result = await createPolymarketClobV2LiveClient({
      host: 'https://clob.polymarket.com',
      chainId: 137,
      privateKey: null,
      builderCode: null,
    })

    expect(result).toEqual({
      ok: false,
      reasons: [
        'POLYMARKET_PRIVATE_KEY_MISSING',
        'POLYMARKET_BUILDER_CODE_MISSING',
      ],
    })
  })

  test('package-backed CLOB V2 live client derives API credentials from the private key', async () => {
    const deriveApiCredentials = vi.fn(async () => ({
      key: FAKE_API_KEY,
      secret: FAKE_SECRET,
      passphrase: FAKE_PASSPHRASE,
    }))

    const result = await createPolymarketClobV2LiveClient({
      host: 'https://clob.polymarket.com',
      chainId: 137,
      privateKey: VALID_TEST_PRIVATE_KEY,
      builderCode: FAKE_BUILDER_CODE,
      deriveApiCredentials,
    })

    expect(result.ok).toBe(true)
    expect(deriveApiCredentials).toHaveBeenCalledTimes(1)
  })

  test('package-backed CLOB V2 live client rejects missing builder code', async () => {
    const result = await createPolymarketClobV2LiveClient({
      host: 'https://clob.polymarket.com',
      chainId: 137,
      privateKey: VALID_TEST_PRIVATE_KEY,
      builderCode: null,
    })

    expect(result).toEqual({
      ok: false,
      reasons: ['POLYMARKET_BUILDER_CODE_MISSING'],
    })
  })

  test('package-backed CLOB V2 client posts expiring limit orders as GTD with expiration', async () => {
    const calls: Array<{ userOrder: unknown; options: unknown; orderType: unknown }> = []
    const sdkClient: PolymarketClobV2SdkClient = {
      getClobMarketInfo: async () => {
        throw new Error('not needed in this test')
      },
      createAndPostOrder: async (userOrder, options, orderType) => {
        calls.push({ userOrder, options, orderType })
        return { success: true, orderID: 'sdk-order-1', status: 'open' }
      },
      createAndPostMarketOrder: async () => {
        throw new Error('market order path should not be used')
      },
      cancelOrder: async () => ({}),
      getOrder: async () => {
        throw new Error('not needed in this test')
      },
      getTrades: async () => [],
      updateBalanceAllowance: async () => ({}),
      getBalanceAllowance: async () => ({ balance: '2000', allowances: {} }),
      getOk: async () => ({}),
    }
    const client = new PolymarketClobV2LiveClient(sdkClient, FAKE_BUILDER_CODE)

    await expect(client.createOrder(buildCreateOrderRequest())).resolves.toMatchObject({
      orderId: 'sdk-order-1',
      status: 'open',
    })

    expect(calls).toEqual([
      {
        userOrder: {
          tokenID: 'token-home',
          price: 0.41,
          size: 25,
          side: 'BUY',
          builderCode: FAKE_BUILDER_CODE,
          expiration: 1_800_000_000,
        },
        options: { tickSize: '0.01' },
        orderType: 'GTD',
      },
    ])
  })

  test('package-backed CLOB V2 client maps maker trade order ids for REST reconciliation', async () => {
    const sdkClient: PolymarketClobV2SdkClient = {
      getClobMarketInfo: async () => {
        throw new Error('not needed in this test')
      },
      createAndPostOrder: async () => {
        throw new Error('not needed in this test')
      },
      createAndPostMarketOrder: async () => {
        throw new Error('not needed in this test')
      },
      cancelOrder: async () => ({}),
      getOrder: async () => {
        throw new Error('not needed in this test')
      },
      getTrades: async () => [
        {
          id: 'trade-1',
          taker_order_id: 'taker-order-1',
          market: 'market-1',
          asset_id: 'token-home',
          side: 'SELL',
          size: '10',
          fee_rate_bps: '0',
          price: '0.41',
          status: 'CONFIRMED',
          match_time: '2026-05-11T10:00:00.000Z',
          last_update: '2026-05-11T10:00:00.000Z',
          outcome: 'Home',
          bucket_index: 0,
          owner: 'owner-1',
          maker_address: 'maker-1',
          maker_orders: [
            {
              order_id: 'maker-order-1',
              owner: 'owner-1',
              maker_address: 'maker-1',
              matched_amount: '10',
              price: '0.41',
              fee_rate_bps: '0',
              asset_id: 'token-home',
              outcome: 'Home',
              side: 'BUY',
            },
          ],
          trader_side: 'MAKER',
        },
      ],
      updateBalanceAllowance: async () => ({}),
      getBalanceAllowance: async () => ({ balance: '2000', allowances: {} }),
      getOk: async () => ({}),
    }
    const client = new PolymarketClobV2LiveClient(sdkClient, FAKE_BUILDER_CODE)

    await expect(client.getTrades({ marketId: 'market-1', tokenId: 'token-home' })).resolves.toMatchObject([
      {
        tradeId: 'trade-1',
        orderId: 'maker-order-1',
        marketId: 'market-1',
        tokenId: 'token-home',
        side: 'buy',
        price: 0.41,
        size: 10,
      },
    ])
    await expect(client.getTrades({ orderId: 'maker-order-1' })).resolves.toHaveLength(1)
  })

  test('package-backed CLOB V2 user updates fail closed until streaming is implemented', () => {
    const sdkClient: PolymarketClobV2SdkClient = {
      getClobMarketInfo: async () => {
        throw new Error('not needed in this test')
      },
      createAndPostOrder: async () => {
        throw new Error('not needed in this test')
      },
      createAndPostMarketOrder: async () => {
        throw new Error('not needed in this test')
      },
      cancelOrder: async () => ({}),
      getOrder: async () => {
        throw new Error('not needed in this test')
      },
      getTrades: async () => [],
      updateBalanceAllowance: async () => ({}),
      getBalanceAllowance: async () => ({ balance: '2000', allowances: {} }),
      getOk: async () => ({}),
    }
    const client = new PolymarketClobV2LiveClient(sdkClient, FAKE_BUILDER_CODE)

    expect(() => client.subscribeUserUpdates(() => {})).toThrow('user update streaming is not implemented')
  })
})

describe('mock polymarket adapter outcomes', () => {
  test('accepts an order, records calls, and exposes it through getOrder', async () => {
    const adapter = new MockPolymarketTradingAdapter()
    adapter.seedMarket({
      eventSlug: 'ipl-match-1',
      marketSlug: 'ipl-match-1-moneyline',
      conditionId: 'condition-1',
      outcomes: ['Mumbai', 'Chennai'],
      tokens: [
        { tokenId: 'token-home', outcome: 'Mumbai' },
        { tokenId: 'token-away', outcome: 'Chennai' },
      ],
    })
    adapter.enqueueCreateOrderOutcome({ type: 'accept', orderId: 'accepted-order-1' })

    const market = await adapter.lookupMarket({ tokenId: 'token-home' })
    const order = await adapter.createOrder(buildCreateOrderRequest())
    const fetchedOrder = await adapter.getOrder(order.orderId)

    expect(market?.marketSlug).toBe('ipl-match-1-moneyline')
    expect(order).toMatchObject({
      orderId: 'accepted-order-1',
      status: 'open',
      matchedSize: 0,
      remainingSize: 25,
    })
    expect(fetchedOrder).toEqual(order)
    expect(adapter.getRecordedCalls().map((call) => call.operation)).toEqual([
      'lookupMarket',
      'createOrder',
      'getOrder',
    ])
  })

  test('rejects an order with a classified safe error', async () => {
    const adapter = new MockPolymarketTradingAdapter()
    adapter.enqueueCreateOrderOutcome({ type: 'reject', message: 'Order rejected by venue' })

    await expect(adapter.createOrder(buildCreateOrderRequest())).rejects.toMatchObject({
      name: 'PolymarketAdapterError',
      code: 'ORDER_REJECTED',
      retryable: false,
      shouldBackoff: false,
    })
  })

  test('classifies duplicate and timeout outcomes correctly', async () => {
    const duplicateAdapter = new MockPolymarketTradingAdapter()
    duplicateAdapter.enqueueCreateOrderOutcome({
      type: 'duplicate',
      duplicateOfOrderId: 'existing-order-1',
      message: 'Duplicate client order id',
    })

    await expect(duplicateAdapter.createOrder(buildCreateOrderRequest())).rejects.toMatchObject({
      name: 'PolymarketAdapterError',
      code: 'DUPLICATE_ORDER',
      retryable: false,
      shouldBackoff: false,
      safeContext: {
        details: {
          duplicateOfOrderId: 'existing-order-1',
        },
      },
    })

    const timeoutAdapter = new MockPolymarketTradingAdapter()
    timeoutAdapter.enqueueCreateOrderOutcome({ type: 'timeout', message: 'Request timed out' })

    await expect(timeoutAdapter.createOrder(buildCreateOrderRequest())).rejects.toMatchObject({
      name: 'PolymarketAdapterError',
      code: 'REQUEST_TIMEOUT',
      retryable: true,
      shouldBackoff: true,
      backoffMs: 1000,
    })
  })

  test('supports partial fills, trades lookup, subscriber updates, and cancel', async () => {
    const adapter = new MockPolymarketTradingAdapter()
    const updates: string[] = []
    const unsubscribe = await adapter.subscribeUserUpdates((update) => {
      updates.push(update.type)
    })

    adapter.enqueueCreateOrderOutcome({
      type: 'partial-fill',
      orderId: 'partial-order-1',
      matchedSize: 10,
      tradeId: 'trade-1',
    })
    adapter.enqueueCancelOrderOutcome({ type: 'cancel', message: 'Canceled by user' })

    const order = await adapter.createOrder(buildCreateOrderRequest())
    const trades = await adapter.getTrades({ orderId: order.orderId })
    const canceledOrder = await adapter.cancelOrder(order.orderId)

    unsubscribe()

    expect(order).toMatchObject({
      orderId: 'partial-order-1',
      status: 'partially-filled',
      matchedSize: 10,
      remainingSize: 15,
    })
    expect(trades).toEqual([
      expect.objectContaining({
        tradeId: 'trade-1',
        orderId: 'partial-order-1',
        size: 10,
      }),
    ])
    expect(canceledOrder).toMatchObject({
      orderId: 'partial-order-1',
      status: 'canceled',
      matchedSize: 10,
      remainingSize: 15,
      reason: 'Canceled by user',
    })
    expect(updates).toEqual(['order', 'trade', 'order'])
    expect(adapter.drainUserUpdates().map((update) => update.type)).toEqual(['order', 'trade', 'order'])
  })

  test('returns retryable backoff information for rate limits', async () => {
    const adapter = new MockPolymarketTradingAdapter()
    adapter.enqueueCreateOrderOutcome({
      type: 'rate-limit',
      retryAfterMs: 7500,
      message: 'Rate limit exceeded',
    })

    await expect(adapter.createOrder(buildCreateOrderRequest())).rejects.toMatchObject({
      name: 'PolymarketAdapterError',
      code: 'RATE_LIMITED',
      retryable: true,
      shouldBackoff: true,
      backoffMs: 7500,
      status: 429,
    })

    expect(classifyPolymarketError({ status: 429, retryAfterMs: 4000, message: 'Rate limit exceeded' })).toEqual({
      code: 'RATE_LIMITED',
      retryable: true,
      shouldBackoff: true,
      backoffMs: 4000,
      status: 429,
    })
  })
})

describe('polymarket adapter secret redaction', () => {
  test('redacts secrets from log-safe payloads and thrown errors', async () => {
    const redactedPayload = createPolymarketLogSafePayload({
      authorization: `Bearer ${FAKE_API_KEY}`,
      privateKey: FAKE_PRIVATE_KEY,
      apiSecret: FAKE_SECRET,
      nested: {
        passphrase: FAKE_PASSPHRASE,
        signedPayload: `signature=${FAKE_SECRET}`,
      },
      note: `saw ${FAKE_PRIVATE_KEY} and ${FAKE_API_KEY} during debug`,
    })

    const payloadText = JSON.stringify(redactedPayload)
    expect(payloadText).not.toContain(FAKE_PRIVATE_KEY)
    expect(payloadText).not.toContain(FAKE_API_KEY)
    expect(payloadText).not.toContain(FAKE_SECRET)
    expect(payloadText).not.toContain(FAKE_PASSPHRASE)
    expect(payloadText).toContain('[REDACTED]')

    const adapter = new MockPolymarketTradingAdapter()
    adapter.enqueueCreateOrderOutcome({
      type: 'reject',
      message: `Venue rejected secret payload ${FAKE_PRIVATE_KEY} ${FAKE_API_KEY}`,
      details: {
        authorization: `Bearer ${FAKE_API_KEY}`,
        apiSecret: FAKE_SECRET,
        passphrase: FAKE_PASSPHRASE,
      },
      sensitiveValues: [FAKE_PRIVATE_KEY, FAKE_API_KEY, FAKE_SECRET, FAKE_PASSPHRASE],
    })

    let thrownError: unknown
    try {
      await adapter.createOrder(buildCreateOrderRequest())
    } catch (error) {
      thrownError = error
    }

    expect(thrownError).toBeInstanceOf(PolymarketAdapterError)

    const safeText = JSON.stringify({
      message: (thrownError as Error).message,
      safeContext: (thrownError as PolymarketAdapterError).safeContext,
    })

    expect(safeText).not.toContain(FAKE_PRIVATE_KEY)
    expect(safeText).not.toContain(FAKE_API_KEY)
    expect(safeText).not.toContain(FAKE_SECRET)
    expect(safeText).not.toContain(FAKE_PASSPHRASE)
    expect(safeText).toContain('[REDACTED]')
  })
})
