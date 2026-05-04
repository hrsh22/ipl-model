import { and, asc, desc, eq } from "drizzle-orm"
import {
  observerCheckpoints,
  observerFixtures,
  observerLiveModelSignals,
  observerLiveModelSnapshots,
  observerOdds,
  observerSignals,
} from "../db/schema.js"
import { db } from "../database.js"

export type ObserverFixtureRecord = typeof observerFixtures.$inferSelect
export type ObserverFixtureUpsert = typeof observerFixtures.$inferInsert
export type ObserverOddUpsert = typeof observerOdds.$inferInsert
export type ObserverSignalInsert = typeof observerSignals.$inferInsert
export type ObserverLiveModelSnapshotInsert = typeof observerLiveModelSnapshots.$inferInsert
export type ObserverLiveModelSignalInsert = typeof observerLiveModelSignals.$inferInsert

export const upsertFixture = async (fixture: ObserverFixtureUpsert) => {
  await db
    .insert(observerFixtures)
    .values(fixture)
    .onConflictDoUpdate({
      target: observerFixtures.id,
      set: {
        opticOddsGameId: fixture.opticOddsGameId,
        sport: fixture.sport,
        league: fixture.league,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        startTime: fixture.startTime,
        status: fixture.status,
        isLive: fixture.isLive,
        venueName: fixture.venueName,
        venueLocation: fixture.venueLocation,
        polymarketEventSlug: fixture.polymarketEventSlug,
        polymarketMarketSlug: fixture.polymarketMarketSlug,
        polymarketConditionId: fixture.polymarketConditionId,
        homeTokenId: fixture.homeTokenId,
        awayTokenId: fixture.awayTokenId,
        lastScore: fixture.lastScore,
        lastPeriod: fixture.lastPeriod,
        lastResultPayload: fixture.lastResultPayload,
        updatedAt: new Date(),
      },
    })
}

export const upsertOdd = async (odd: ObserverOddUpsert) => {
  await db.insert(observerOdds).values(odd).onConflictDoUpdate({
    target: observerOdds.id,
    set: {
      fixtureId: odd.fixtureId,
      sportsbookId: odd.sportsbookId,
      sportsbook: odd.sportsbook,
      marketId: odd.marketId,
      market: odd.market,
      selection: odd.selection,
      normalizedSelection: odd.normalizedSelection,
      priceProbability: odd.priceProbability,
      isMain: odd.isMain,
      isLive: odd.isLive,
      isLocked: odd.isLocked,
      maxStake: odd.maxStake,
      oddsTimestamp: odd.oddsTimestamp,
      sourceIds: odd.sourceIds,
      orderBook: odd.orderBook,
      deepLink: odd.deepLink,
      updatedAt: new Date(),
    },
  })
}

export const insertSignal = async (signal: ObserverSignalInsert) => {
  await db.insert(observerSignals).values(signal)
}

export const insertLiveModelSnapshot = async (snapshot: ObserverLiveModelSnapshotInsert) => {
  const rows = await db.insert(observerLiveModelSnapshots).values(snapshot).returning({
    id: observerLiveModelSnapshots.id,
  })

  return rows[0]?.id ?? null
}

export const insertLiveModelSignal = async (signal: ObserverLiveModelSignalInsert) => {
  await db.insert(observerLiveModelSignals).values(signal)
}

export const getCheckpoint = async (streamKey: string) => {
  const rows = await db
    .select()
    .from(observerCheckpoints)
    .where(eq(observerCheckpoints.streamKey, streamKey))
    .limit(1)

  return rows[0] ?? null
}

export const upsertCheckpoint = async (streamKey: string, lastEntryId: string) => {
  await db.insert(observerCheckpoints).values({ streamKey, lastEntryId }).onConflictDoUpdate({
    target: observerCheckpoints.streamKey,
    set: {
      lastEntryId,
      updatedAt: new Date(),
    },
  })
}

export const listFixtures = async (limit = 20) =>
  db.select().from(observerFixtures).orderBy(desc(observerFixtures.updatedAt)).limit(limit)

export const listSignals = async (limit = 50) =>
  db.select().from(observerSignals).orderBy(desc(observerSignals.createdAt)).limit(limit)

export const listLiveModelSnapshots = async (limit = 50) =>
  db
    .select()
    .from(observerLiveModelSnapshots)
    .orderBy(desc(observerLiveModelSnapshots.createdAt))
    .limit(limit)

export const listLiveModelSignals = async (limit = 50) =>
  db
    .select()
    .from(observerLiveModelSignals)
    .orderBy(desc(observerLiveModelSignals.createdAt))
    .limit(limit)

export const getFixture = async (fixtureId: string) => {
  const rows = await db
    .select()
    .from(observerFixtures)
    .where(eq(observerFixtures.id, fixtureId))
    .limit(1)

  return rows[0] ?? null
}

export const listFixtureOdds = async (fixtureId: string) =>
  db
    .select()
    .from(observerOdds)
    .where(eq(observerOdds.fixtureId, fixtureId))
    .orderBy(asc(observerOdds.sportsbookId), asc(observerOdds.selection))

export const listFixtureSignals = async (fixtureId: string, limit = 20) =>
  db
    .select()
    .from(observerSignals)
    .where(eq(observerSignals.fixtureId, fixtureId))
    .orderBy(desc(observerSignals.createdAt))
    .limit(limit)

export const listFixtureLiveModelSnapshots = async (fixtureId: string, limit = 50) =>
  db
    .select()
    .from(observerLiveModelSnapshots)
    .where(eq(observerLiveModelSnapshots.fixtureId, fixtureId))
    .orderBy(desc(observerLiveModelSnapshots.createdAt))
    .limit(limit)

export const listFixtureLiveModelSignals = async (fixtureId: string, limit = 20) =>
  db
    .select()
    .from(observerLiveModelSignals)
    .where(eq(observerLiveModelSignals.fixtureId, fixtureId))
    .orderBy(desc(observerLiveModelSignals.createdAt))
    .limit(limit)

export const getLiveFixtureByTeams = async (homeTeam: string, awayTeam: string) => {
  const rows = await db
    .select()
    .from(observerFixtures)
    .where(
      and(
        eq(observerFixtures.homeTeam, homeTeam),
        eq(observerFixtures.awayTeam, awayTeam),
        eq(observerFixtures.isLive, true),
      ),
    )
    .orderBy(desc(observerFixtures.updatedAt))
    .limit(1)

  return rows[0] ?? null
}
