import "dotenv/config"

import {
  SCOREBOARD_SIDE_STRATEGY_MODES,
  getScoreboardSideStrategySettings,
  type ScoreboardSideStrategyMode,
} from "./ipl/scoreboard-side-strategy.js"
import { POLYMARKET_CHAIN_ID, POLYMARKET_CLOB_HOST } from "./trading/config.js"

const POLYMARKET_FUNDER_ADDRESS = "0xBF1D3CEC2Ba0DC94Db211c9099F8b20132278aB4"
const POLYMARKET_EXPECTED_SIGNER_ADDRESS = "0x5B581d7f0d8cbee002470095d072059DA7A984c2"
const POLYMARKET_SIGNATURE_TYPE = 3

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

const parseScoreboardSideStrategyMode = (value: string | undefined): ScoreboardSideStrategyMode => {
  const mode = value?.trim()

  if (!mode) {
    return "value90"
  }

  if (mode in SCOREBOARD_SIDE_STRATEGY_MODES) {
    return mode as ScoreboardSideStrategyMode
  }

  throw new Error(
    `SCOREBOARD_SIDE_STRATEGY_MODE must be one of: ${Object.keys(SCOREBOARD_SIDE_STRATEGY_MODES).join(", ")}`,
  )
}

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
const scoreboardSideStrategyMode = parseScoreboardSideStrategyMode(process.env.SCOREBOARD_SIDE_STRATEGY_MODE)
const scoreboardSideStrategy = getScoreboardSideStrategySettings(scoreboardSideStrategyMode)

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
      signatureType: POLYMARKET_SIGNATURE_TYPE,
      funderAddressRequired: true,
      funderAddressPresent: true,
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
      signatureType: POLYMARKET_SIGNATURE_TYPE,
      funderAddress: POLYMARKET_FUNDER_ADDRESS,
      expectedSignerAddress: POLYMARKET_EXPECTED_SIGNER_ADDRESS,
    },
    scoreboardSideStrategy,
  },
}
