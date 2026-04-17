import { drizzle } from "drizzle-orm/node-postgres"
import { Effect } from "effect"
import { Client, Pool } from "pg"
import { config } from "./config.js"
import * as schema from "./db/schema.js"

export const pool = new Pool({
  connectionString: config.databaseUrl,
})

export const db = drizzle(pool, { schema })

export const checkDatabaseConnection = Effect.acquireUseRelease(
  Effect.tryPromise({
    try: async () => {
      const client = new Client({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: 5000,
      })

      await client.connect()

      return client
    },
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  }),
  (client) =>
    Effect.tryPromise({
      try: () => client.query("SELECT 1"),
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    }),
  (client) =>
    Effect.tryPromise({
      try: () => client.end(),
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    }).pipe(Effect.orDie),
)
