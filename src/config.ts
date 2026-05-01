import "dotenv/config"

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

const parseOptionalPositiveIntegerEnv = (
  value: string | undefined,
  fallback: number,
) => {
  if (!value?.trim()) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Expected a positive integer environment value")
  }

  return parsed
}

const predictorOnlyMode = parseBooleanEnv(process.env.PREDICTOR_ONLY)
const opticOddsEnabled = parseBooleanEnv(process.env.OPTICODDS_ENABLED)
const defaultPredictorBackgroundIntervalMs = 60 * 60 * 1000
const opticOddsApiKey = opticOddsEnabled
  ? requireEnv("OPTICODDS_API_KEY")
  : optionalEnv("OPTICODDS_API_KEY")

export const config = {
  port: parsePort(requireEnv("PORT")),
  logLevel: requireEnv("LOG_LEVEL"),
  predictorOnlyMode,
  databaseUrl: predictorOnlyMode ? optionalEnv("DATABASE_URL") : requireEnv("DATABASE_URL"),
  opticOddsEnabled,
  opticOddsApiKey,
  observerApiToken: optionalEnv("OBSERVER_API_TOKEN"),
  predictorLiveDataMaxAgeMs: parseOptionalPositiveIntegerEnv(
    process.env.PREDICTOR_LIVE_DATA_MAX_AGE_MS,
    defaultPredictorBackgroundIntervalMs,
  ),
  predictorMaintenanceIntervalMs: parseOptionalPositiveIntegerEnv(
    process.env.PREDICTOR_MAINTENANCE_INTERVAL_MS,
    defaultPredictorBackgroundIntervalMs,
  ),
  experimentalBallStateShadowRefreshEnabled: parseBooleanEnv(
    process.env.EXPERIMENTAL_BALL_STATE_SHADOW_REFRESH_ENABLED,
  ),
  experimentalBallStateRemoteFetchEnabled: parseBooleanEnv(
    process.env.EXPERIMENTAL_BALL_STATE_REMOTE_FETCH_ENABLED,
  ),
}
