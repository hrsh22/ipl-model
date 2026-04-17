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

const parsePort = (value: string) => {
  const port = Number(value)

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer")
  }

  return port
}

export const config = {
  port: parsePort(requireEnv("PORT")),
  logLevel: requireEnv("LOG_LEVEL"),
  databaseUrl: requireEnv("DATABASE_URL"),
  opticOddsApiKey: requireEnv("OPTICODDS_API_KEY"),
  observerApiToken: optionalEnv("OBSERVER_API_TOKEN"),
}
