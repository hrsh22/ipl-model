import "dotenv/config"

import { POLYMARKET_CHAIN_ID, POLYMARKET_CLOB_HOST } from "./trading/config.js"

const requireEnv = (name: string) => {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

const optionalEnv = (name: string) => {
  const value = process.env[name]?.trim()

  return value ? value : null
}

const parseBooleanEnv = (value: string | undefined) =>
  value ? ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()) : false

const parsePort = (value: string) => {
  const port = Number(value)

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer")
  }

  return port
}

const defaultPredictorBackgroundIntervalMs = 60 * 60 * 1000
const tradingLiveEnabled = parseBooleanEnv(process.env.TRADING_LIVE_ENABLED)
const defaultTradingMatchStateMaxAgeMs = 30_000
const defaultTradingBookMaxAgeMs = 15_000
const defaultTradingExecutorIntervalMs = 5_000
const defaultTradingExecutorLeaseMs = 30_000
const polymarketPrivateKeyPresent = optionalEnv("POLYMARKET_PRIVATE_KEY") !== null
const polymarketBuilderCodePresent = optionalEnv("POLY_BUILDER_CODE") !== null

export const config = {
  port: parsePort(requireEnv("PORT")),
  logLevel: requireEnv("LOG_LEVEL"),
  databaseUrl: requireEnv("DATABASE_URL"),
  observerApiToken: optionalEnv("OBSERVER_API_TOKEN"),
  predictorLiveDataMaxAgeMs: defaultPredictorBackgroundIntervalMs,
  predictorMaintenanceIntervalMs: defaultPredictorBackgroundIntervalMs,
  experimentalBallStateShadowRefreshEnabled: false,
  experimentalBallStateRemoteFetchEnabled: false,
  trading: {
    liveEnabled: tradingLiveEnabled,
    polymarketCredentials: {
      privateKeyPresent: polymarketPrivateKeyPresent,
      builderCodePresent: polymarketBuilderCodePresent,
      allPresent:
        polymarketPrivateKeyPresent &&
        polymarketBuilderCodePresent,
    },
    staleWindows: {
      matchStateMaxAgeMs: defaultTradingMatchStateMaxAgeMs,
      bookMaxAgeMs: defaultTradingBookMaxAgeMs,
    },
    dailyBoundaryTimezone: "Asia/Kolkata",
    executor: {
      enabled: true,
      intervalMs: defaultTradingExecutorIntervalMs,
      leaseMs: defaultTradingExecutorLeaseMs,
      workerId: "polymarket-runtime-executor",
    },
    polymarketClob: {
      host: POLYMARKET_CLOB_HOST,
      chainId: POLYMARKET_CHAIN_ID,
    },
  },
}
