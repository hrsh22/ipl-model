/**
 * Polymarket Gamma API Client
 * Fetches live odds for IPL matches from Polymarket
 */

import logger from "../logger.js"

export interface PolymarketMarket {
  id: string
  question: string
  description: string
  outcomes: Array<{
    name: string
    price: number
  }>
  volume: number
  liquidity: number
  createdAt: string
  updatedAt: string
}

export interface PolymarketOdds {
  matchId: string
  team1: string
  team2: string
  team1Odds: number
  team2Odds: number
  volume: number
  liquidity: number
  fetchedAt: Date
}

/**
 * Polymarket Gamma API client
 * Base URL: https://gamma-api.polymarket.com
 */
export class PolymarketClient {
  private baseUrl = "https://gamma-api.polymarket.com"
  private timeout = 10000 // 10 seconds

  /**
   * Search for IPL match markets
   */
  async searchIPLMarkets(season: number = 2026): Promise<PolymarketMarket[]> {
    try {
      const query = `IPL ${season}`
      const url = `${this.baseUrl}/markets?search=${encodeURIComponent(query)}&limit=100`

      logger.debug("Searching Polymarket for IPL markets", { query })

      const response = await this.fetchWithTimeout(url)
      const data = (await response.json()) as { data: PolymarketMarket[] }

      logger.info(`Found ${data.data.length} IPL markets on Polymarket`)
      return data.data
    } catch (error) {
      logger.error("Failed to search Polymarket markets", { error })
      return []
    }
  }

  /**
   * Get odds for a specific match
   */
  async getMatchOdds(team1: string, team2: string): Promise<PolymarketOdds | null> {
    try {
      const markets = await this.searchIPLMarkets()

      // Find market matching both teams
      const matchMarket = markets.find((m) => {
        const question = m.question.toLowerCase()
        return (
          question.includes(team1.toLowerCase()) &&
          question.includes(team2.toLowerCase())
        )
      })

      if (!matchMarket) {
        logger.debug("No Polymarket found for match", { team1, team2 })
        return null
      }

      // Extract odds from outcomes
      const team1Outcome = matchMarket.outcomes.find((o) =>
        o.name.toLowerCase().includes(team1.toLowerCase())
      )
      const team2Outcome = matchMarket.outcomes.find((o) =>
        o.name.toLowerCase().includes(team2.toLowerCase())
      )

      if (!team1Outcome || !team2Outcome) {
        logger.warn("Could not find outcomes for both teams", { team1, team2 })
        return null
      }

      // Convert prices to odds (Polymarket uses probabilities, convert to decimal odds)
      const team1Odds = 1 / team1Outcome.price
      const team2Odds = 1 / team2Outcome.price

      const result: PolymarketOdds = {
        matchId: matchMarket.id,
        team1,
        team2,
        team1Odds,
        team2Odds,
        volume: matchMarket.volume,
        liquidity: matchMarket.liquidity,
        fetchedAt: new Date(),
      }

      logger.debug("Retrieved Polymarket odds", result)
      return result
    } catch (error) {
      logger.error("Failed to get match odds from Polymarket", { error, team1, team2 })
      return null
    }
  }

  /**
   * Get all active IPL markets
   */
  async getActiveIPLMarkets(): Promise<PolymarketMarket[]> {
    try {
      const url = `${this.baseUrl}/markets?search=IPL&active=true&limit=100`

      const response = await this.fetchWithTimeout(url)
      const data = (await response.json()) as { data: PolymarketMarket[] }

      return data.data
    } catch (error) {
      logger.error("Failed to get active IPL markets", { error })
      return []
    }
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "IPL-Trader/1.0",
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return response
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * Singleton instance
 */
export const polymarketClient = new PolymarketClient()
