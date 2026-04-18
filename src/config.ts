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

const predictorOnlyMode = parseBooleanEnv(process.env.PREDICTOR_ONLY)

export const config = {
  port: parsePort(requireEnv("PORT")),
  logLevel: requireEnv("LOG_LEVEL"),
  predictorOnlyMode,
  databaseUrl: predictorOnlyMode ? optionalEnv("DATABASE_URL") : requireEnv("DATABASE_URL"),
  opticOddsApiKey: requireEnv("OPTICODDS_API_KEY"),
  observerApiToken: optionalEnv("OBSERVER_API_TOKEN"),
}
