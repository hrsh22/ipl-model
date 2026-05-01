import { createFileRoute } from '@tanstack/react-router'

const GAMMA_API = 'https://gamma-api.polymarket.com'
const DATA_API = 'https://data-api.polymarket.com'

const PNL_WINDOWS = [
  { category: 'OVERALL', periods: ['WEEK', 'MONTH', 'ALL'] },
  { category: 'SPORTS', periods: ['ALL'] },
] as const satisfies readonly { category: PnlCategory; periods: readonly PnlPeriod[] }[]
const DEFAULT_HOLDER_LIMIT = 20
const MAX_HOLDER_LIMIT = 50
const POSITION_REQUEST_CONCURRENCY = 4
const PNL_REQUEST_CONCURRENCY = 1
const LEADERBOARD_CALL_DELAY_MS = 275
const LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000

const leaderboardCache = new Map<string, { expiresAt: number; value: unknown | null }>()
let lastLeaderboardRequestAt = 0

type PnlPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'ALL'
type PnlCategory = 'OVERALL' | 'SPORTS'

type ScanRequest = {
  url: string
  holderLimit?: number | undefined
  minBalance?: number | undefined
}

type GammaEvent = {
  id?: string | undefined
  title?: string | undefined
  slug?: string | undefined
  markets?: GammaMarket[] | undefined
}

type GammaMarket = {
  id?: string | undefined
  question?: string | undefined
  slug?: string | undefined
  conditionId?: string | undefined
  outcomes?: string | undefined
  clobTokenIds?: string | undefined
}

type ScannableMarket = Omit<GammaMarket, 'conditionId' | 'question'> & {
  conditionId: string
  question: string
}

type Holder = {
  proxyWallet: string
  asset: string
  amount: number
  outcomeIndex: number
  bothSides: boolean
  oppositeAmount?: number | undefined
  oppositeAsset?: string | undefined
  name?: string | undefined
  pseudonym?: string | undefined
  profileImage?: string | undefined
}

type HolderGroup = {
  token: string
  holders: Holder[]
}

type MarketPosition = {
  proxyWallet: string
  asset: string
  conditionId: string
  size: number
  outcomeIndex: number
  name?: string | undefined
  pseudonym?: string | undefined
  profileImage?: string | undefined
}

type LeaderboardEntry = {
  rank: string
  proxyWallet: string
  userName: string
  vol: number
  pnl: number
}

type TraderPnl = Partial<Record<PnlCategory, Partial<Record<PnlPeriod, LeaderboardEntry>>>>

type EnrichedHolder = Holder & {
  displayName: string
  outcome: string
  oppositeOutcome?: string | undefined
  pnl: TraderPnl
  profitableScore: number
  label: 'profitable-shark' | 'mixed' | 'unprofitable' | 'unknown'
}

export const Route = createFileRoute('/api/scanner/scan')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readScanRequest(request)
          const slug = extractPolymarketSlug(body.url)
          const holderLimit = clampInteger(body.holderLimit, 1, MAX_HOLDER_LIMIT, DEFAULT_HOLDER_LIMIT)
          const minBalance = clampInteger(body.minBalance, 0, 999_999, 1)

          const event = await fetchEventBySlug(slug)
          const market = selectPrimaryMarket(event, slug)
          const outcomes = parseJsonStringArray(market.outcomes)
          const tokenIds = parseJsonStringArray(market.clobTokenIds)
          const holders = await fetchHolders(market.conditionId, tokenIds, holderLimit, minBalance)
          const pnlByWallet = await fetchWalletPnls(collectWallets(holders))

          return Response.json({
            event: {
              id: event.id ?? null,
              title: event.title ?? market.question,
              slug: event.slug ?? slug,
            },
            market: {
              id: market.id ?? null,
              question: market.question,
              slug: market.slug ?? slug,
              conditionId: market.conditionId,
              outcomes,
              tokenIds,
            },
            holderLimit,
            minBalance,
            outcomes: holders.map((group) => ({
              token: group.token,
              outcome: outcomeNameForGroup(group, outcomes, tokenIds),
              holders: group.holders.map((holder) => enrichHolder(holder, outcomes, tokenIds, pnlByWallet)),
            })),
            generatedAt: new Date().toISOString(),
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown scan failure'
          return Response.json({ error: message }, { status: 400 })
        }
      },
    },
  },
})

async function readScanRequest(request: Request): Promise<ScanRequest> {
  const value: unknown = await request.json()
  if (!isRecord(value) || typeof value.url !== 'string') {
    throw new Error('Request body must include a Polymarket url string.')
  }

  return {
    url: value.url,
    holderLimit: typeof value.holderLimit === 'number' ? value.holderLimit : undefined,
    minBalance: typeof value.minBalance === 'number' ? value.minBalance : undefined,
  }
}

function extractPolymarketSlug(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Paste a Polymarket market URL or slug.')
  }

  try {
    const url = new URL(trimmed)
    const slug = url.pathname.split('/').filter(Boolean).at(-1)
    if (url.hostname.endsWith('polymarket.com') && slug) {
      return slug
    }
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error
    }
  }

  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(trimmed)) {
    return trimmed
  }

  throw new Error('Could not extract a Polymarket slug from that input.')
}

async function fetchEventBySlug(slug: string): Promise<GammaEvent> {
  const events = await fetchJson<unknown>(`${GAMMA_API}/events?slug=${encodeURIComponent(slug)}`)
  if (!Array.isArray(events) || events.length === 0 || !isRecord(events[0])) {
    throw new Error(`No Polymarket event found for slug: ${slug}`)
  }

  return normalizeEvent(events[0])
}

function selectPrimaryMarket(event: GammaEvent, slug: string): ScannableMarket {
  const markets = event.markets ?? []
  const exact = markets.find((market) => market.slug === slug && typeof market.conditionId === 'string')
  const fallback = markets.find((market) => typeof market.conditionId === 'string')
  const market = exact ?? fallback

  if (!market?.conditionId || !market.question) {
    throw new Error('The event did not include a scannable market condition ID.')
  }

  return { ...market, conditionId: market.conditionId, question: market.question }
}

async function fetchHolders(conditionId: string, tokenIds: string[], limit: number, minBalance: number): Promise<HolderGroup[]> {
  const nettedGroups = await fetchNetHolderGroups(conditionId, limit, minBalance)
  const exactGroups = await fetchExactPositionGroups(conditionId, tokenIds, nettedGroups, limit, minBalance)
  return exactGroups.length === tokenIds.length && exactGroups.every((group) => group.holders.length > 0)
    ? exactGroups
    : nettedGroups
}

async function fetchNetHolderGroups(conditionId: string, limit: number, minBalance: number): Promise<HolderGroup[]> {
  const url = new URL(`${DATA_API}/holders`)
  url.searchParams.set('market', conditionId)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('minBalance', String(minBalance))
  const value = await fetchJson<unknown>(url.toString())
  if (!Array.isArray(value)) {
    throw new Error('Polymarket holders response was not an array.')
  }
  return value.map(normalizeHolderGroup)
}

async function fetchExactPositionGroups(
  conditionId: string,
  tokenIds: string[],
  nettedGroups: HolderGroup[],
  limit: number,
  minBalance: number,
): Promise<HolderGroup[]> {
  const holderDetails = new Map<string, Holder>()
  for (const group of nettedGroups) {
    for (const holder of group.holders) {
      holderDetails.set(holder.proxyWallet, holder)
    }
  }

  const uniqueWallets = [...holderDetails.keys()]
  if (uniqueWallets.length === 0) {
    return tokenIds.map((token) => ({ token, holders: [] }))
  }

  const positions = (await mapWithConcurrency(uniqueWallets, POSITION_REQUEST_CONCURRENCY, async (wallet) => {
    return await fetchWalletPositions(wallet, conditionId)
  })).flat()
  const positionsByToken = new Map(tokenIds.map((tokenId) => [tokenId, [] as Holder[]]))

  for (const position of positions) {
    if (position.size < minBalance) {
      continue
    }
    const group = positionsByToken.get(position.asset)
    if (!group) {
      continue
    }
    const fallbackHolder = holderDetails.get(position.proxyWallet)
    group.push({
      proxyWallet: position.proxyWallet,
      asset: position.asset,
      amount: position.size,
      outcomeIndex: position.outcomeIndex,
      bothSides: false,
      name: position.name ?? fallbackHolder?.name,
      pseudonym: position.pseudonym ?? fallbackHolder?.pseudonym,
      profileImage: position.profileImage ?? fallbackHolder?.profileImage,
    })
  }

  for (const group of positionsByToken.values()) {
    for (const holder of group) {
      const siblingPosition = positions.find(
        (position) => position.proxyWallet === holder.proxyWallet && position.asset !== holder.asset && position.size > 0,
      )
      if (siblingPosition) {
        holder.bothSides = true
        holder.oppositeAmount = siblingPosition.size
        holder.oppositeAsset = siblingPosition.asset
      }
    }
  }

  return tokenIds.map((token) => ({
    token,
    holders: (positionsByToken.get(token) ?? []).sort((left, right) => right.amount - left.amount).slice(0, limit),
  }))
}

async function fetchWalletPositions(wallet: string, conditionId: string): Promise<MarketPosition[]> {
  const url = new URL(`${DATA_API}/positions`)
  url.searchParams.set('user', wallet)
  const value = await fetchJson<unknown>(url.toString())
  return Array.isArray(value)
    ? value.filter(isRecord).map(normalizeMarketPosition).filter((position): position is MarketPosition => position !== null && position.conditionId === conditionId)
    : []
}

function collectWallets(groups: HolderGroup[]): string[] {
  const wallets = new Set<string>()
  for (const group of groups) {
    for (const holder of group.holders) {
      wallets.add(holder.proxyWallet)
    }
  }
  return [...wallets]
}

async function fetchWalletPnls(wallets: string[]): Promise<Map<string, TraderPnl>> {
  const pairs = await mapWithConcurrency(wallets, PNL_REQUEST_CONCURRENCY, async (wallet) => [wallet, await fetchWalletPnl(wallet)] as const)
  return new Map(pairs)
}

async function fetchWalletPnl(wallet: string): Promise<TraderPnl> {
  const pnl: TraderPnl = {}
  for (const window of PNL_WINDOWS) {
    for (const period of window.periods) {
      const entry = await fetchLeaderboardEntry(wallet, window.category, period)
      if (entry) {
        const categoryPnl = pnl[window.category] ?? {}
        categoryPnl[period] = entry
        pnl[window.category] = categoryPnl
      }
    }
  }
  return pnl
}

async function fetchLeaderboardEntry(wallet: string, category: PnlCategory, period: PnlPeriod): Promise<LeaderboardEntry | null> {
  const url = new URL(`${DATA_API}/v1/leaderboard`)
  url.searchParams.set('category', category)
  url.searchParams.set('timePeriod', period)
  url.searchParams.set('orderBy', 'PNL')
  url.searchParams.set('user', wallet)
  url.searchParams.set('limit', '1')
  const value = await fetchLeaderboardJson(url.toString())
  return Array.isArray(value) && value.length > 0 ? normalizeLeaderboardEntry(value[0]) : null
}

function enrichHolder(holder: Holder, outcomes: string[], tokenIds: string[], pnlByWallet: Map<string, TraderPnl>): EnrichedHolder {
  const pnl = pnlByWallet.get(holder.proxyWallet) ?? {}
  const score = profitableScore(pnl)
  return {
    ...holder,
    displayName: holder.name || holder.pseudonym || shortWallet(holder.proxyWallet),
    outcome: outcomeNameForHolder(holder, outcomes, tokenIds),
    oppositeOutcome: holder.oppositeAsset ? outcomeNameForAsset(holder.oppositeAsset, outcomes, tokenIds) : undefined,
    pnl,
    profitableScore: score,
    label: holderLabel(score, pnl),
  }
}

function profitableScore(pnl: TraderPnl): number {
  const values = [pnl.OVERALL?.WEEK?.pnl, pnl.OVERALL?.MONTH?.pnl, pnl.OVERALL?.ALL?.pnl, pnl.SPORTS?.ALL?.pnl].filter(
    (value): value is number => typeof value === 'number',
  )
  return values.reduce((score, value) => score + Math.sign(value), 0)
}

function holderLabel(score: number, pnl: TraderPnl): EnrichedHolder['label'] {
  if (!pnl.OVERALL && !pnl.SPORTS) {
    return 'unknown'
  }
  if (score >= 3) {
    return 'profitable-shark'
  }
  if (score <= -2) {
    return 'unprofitable'
  }
  return 'mixed'
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ipl-trader-web/0.1' } })
  if (!response.ok) {
    throw new Error(`Polymarket request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

async function fetchLeaderboardJson(url: string): Promise<unknown | null> {
  const cached = leaderboardCache.get(url)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await waitForLeaderboardSlot()
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ipl-trader-web/0.1' } })
    if (response.status === 429) {
      await delay(retryDelayMs(response, attempt))
      continue
    }
    if (!response.ok) {
      if (response.status === 404) {
        leaderboardCache.set(url, { expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS, value: null })
      }
      return null
    }
    const value: unknown = await response.json()
    leaderboardCache.set(url, { expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS, value })
    return value
  }
  return null
}

async function waitForLeaderboardSlot(): Promise<void> {
  const elapsed = Date.now() - lastLeaderboardRequestAt
  if (elapsed < LEADERBOARD_CALL_DELAY_MS) {
    await delay(LEADERBOARD_CALL_DELAY_MS - elapsed)
  }
  lastLeaderboardRequestAt = Date.now()
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const asSeconds = Number(retryAfter)
    if (Number.isFinite(asSeconds)) {
      return Math.max(1_000, asSeconds * 1_000)
    }
    const asDate = Date.parse(retryAfter)
    if (Number.isFinite(asDate)) {
      return Math.max(1_000, asDate - Date.now())
    }
  }
  return 1_500 * (attempt + 1)
}

async function mapWithConcurrency<T, U>(values: readonly T[], concurrency: number, mapper: (value: T) => Promise<U>): Promise<U[]> {
  const results: U[] = []
  let nextIndex = 0
  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      const value = values[currentIndex]
      if (value !== undefined) {
        results[currentIndex] = await mapper(value)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeEvent(value: Record<string, unknown>): GammaEvent {
  return {
    id: stringField(value.id),
    title: stringField(value.title),
    slug: stringField(value.slug),
    markets: Array.isArray(value.markets) ? value.markets.filter(isRecord).map(normalizeMarket) : [],
  }
}

function normalizeMarket(value: Record<string, unknown>): GammaMarket {
  return {
    id: stringField(value.id),
    question: stringField(value.question),
    slug: stringField(value.slug),
    conditionId: stringField(value.conditionId),
    outcomes: stringField(value.outcomes),
    clobTokenIds: stringField(value.clobTokenIds),
  }
}

function normalizeHolderGroup(value: unknown): HolderGroup {
  if (!isRecord(value) || typeof value.token !== 'string' || !Array.isArray(value.holders)) {
    throw new Error('Invalid holder group returned by Polymarket.')
  }
  return { token: value.token, holders: value.holders.filter(isRecord).map(normalizeHolder) }
}

function normalizeHolder(value: Record<string, unknown>): Holder {
  const proxyWallet = stringField(value.proxyWallet)
  const asset = stringField(value.asset)
  const amount = numberField(value.amount)
  const outcomeIndex = numberField(value.outcomeIndex)
  if (!proxyWallet || !asset || amount === undefined || outcomeIndex === undefined) {
    throw new Error('Invalid holder returned by Polymarket.')
  }
  return { proxyWallet, asset, amount, outcomeIndex, bothSides: false, name: stringField(value.name), pseudonym: stringField(value.pseudonym), profileImage: stringField(value.profileImage) }
}

function normalizeMarketPosition(value: Record<string, unknown>): MarketPosition | null {
  const proxyWallet = stringField(value.proxyWallet)
  const asset = stringField(value.asset)
  const conditionId = stringField(value.conditionId)
  const size = numberField(value.size)
  const outcomeIndex = numberField(value.outcomeIndex)
  if (!proxyWallet || !asset || !conditionId || size === undefined || outcomeIndex === undefined) {
    return null
  }
  return { proxyWallet, asset, conditionId, size, outcomeIndex, name: stringField(value.name), pseudonym: stringField(value.pseudonym), profileImage: stringField(value.profileImage) }
}

function normalizeLeaderboardEntry(value: unknown): LeaderboardEntry | null {
  if (!isRecord(value)) {
    return null
  }
  const rank = stringField(value.rank)
  const proxyWallet = stringField(value.proxyWallet)
  const userName = stringField(value.userName)
  const vol = numberField(value.vol)
  const pnl = numberField(value.pnl)
  return rank && proxyWallet && userName && vol !== undefined && pnl !== undefined ? { rank, proxyWallet, userName, vol, pnl } : null
}

function parseJsonStringArray(value: string | undefined): string[] {
  if (!value) {
    return []
  }
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function outcomeNameForGroup(group: HolderGroup, outcomes: string[], tokenIds: string[]): string {
  const tokenIndex = tokenIds.indexOf(group.token)
  if (tokenIndex >= 0) {
    return outcomes[tokenIndex] ?? `Outcome ${tokenIndex + 1}`
  }
  const holderIndex = group.holders[0]?.outcomeIndex
  return typeof holderIndex === 'number' ? outcomes[holderIndex] ?? `Outcome ${holderIndex + 1}` : 'Unknown outcome'
}

function outcomeNameForHolder(holder: Holder, outcomes: string[], tokenIds: string[]): string {
  const tokenIndex = tokenIds.indexOf(holder.asset)
  return tokenIndex >= 0 ? outcomes[tokenIndex] ?? `Outcome ${tokenIndex + 1}` : outcomes[holder.outcomeIndex] ?? `Outcome ${holder.outcomeIndex + 1}`
}

function outcomeNameForAsset(asset: string, outcomes: string[], tokenIds: string[]): string {
  const tokenIndex = tokenIds.indexOf(asset)
  return tokenIndex >= 0 ? outcomes[tokenIndex] ?? `Outcome ${tokenIndex + 1}` : 'Other outcome'
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, Math.trunc(value)))
}

function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
