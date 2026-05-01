const GAMMA_API = 'https://gamma-api.polymarket.com'
const POLYMARKET_IPL_PATH = 'https://polymarket.com/sports/cricipl'
const IPL_TAG_SLUG = 'indian-premier-league'
const IPL_TIME_ZONE = 'Asia/Kolkata'

export type DefaultMarketResponse = {
  url: string
  title: string
  slug: string
  status: 'live' | 'upcoming'
  matchDate: string
}

type GammaEvent = {
  title?: string | undefined
  slug?: string | undefined
  active?: boolean | undefined
  closed?: boolean | undefined
}

type IplMatchEvent = {
  title: string
  slug: string
  matchDate: string
}

export async function fetchDefaultIplMarket(): Promise<DefaultMarketResponse> {
  const events = await fetchIplEvents()
  const matches = events
    .filter(isOpenIplMatchEvent)
    .map((event) => ({
      title: event.title,
      slug: event.slug,
      matchDate: matchDateFromSlug(event.slug),
    }))
    .filter((event): event is IplMatchEvent => event.matchDate !== undefined)
    .sort((left, right) => left.matchDate.localeCompare(right.matchDate))

  const today = localDateKey(new Date(), IPL_TIME_ZONE)
  const liveMatch = matches.find((event) => event.matchDate === today)
  const upcomingMatch = matches.find((event) => event.matchDate > today)
  const selected = liveMatch ?? upcomingMatch

  if (!selected) {
    throw new Error('No live or upcoming IPL match market found on Polymarket.')
  }

  return {
    url: `${POLYMARKET_IPL_PATH}/${selected.slug}`,
    title: selected.title,
    slug: selected.slug,
    status: selected.matchDate === today ? 'live' : 'upcoming',
    matchDate: selected.matchDate,
  }
}

async function fetchIplEvents(): Promise<GammaEvent[]> {
  const url = new URL(`${GAMMA_API}/events`)
  url.searchParams.set('tag_slug', IPL_TAG_SLUG)
  url.searchParams.set('active', 'true')
  url.searchParams.set('closed', 'false')
  url.searchParams.set('limit', '100')

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      'user-agent': 'ipl-trader-web/0.1',
    },
  })

  if (!response.ok) {
    throw new Error(`Polymarket request failed: ${response.status} ${response.statusText}`)
  }

  const value: unknown = await response.json()
  if (!Array.isArray(value)) {
    throw new Error('Polymarket IPL events response was not an array.')
  }

  return value.filter(isRecord).map(normalizeEvent)
}

function isOpenIplMatchEvent(event: GammaEvent): event is GammaEvent & { title: string; slug: string } {
  return (
    event.active === true &&
    event.closed === false &&
    typeof event.title === 'string' &&
    typeof event.slug === 'string' &&
    /^cricipl-[a-z]+-[a-z]+-\d{4}-\d{2}-\d{2}$/u.test(event.slug) &&
    event.title.startsWith('Indian Premier League:') &&
    !event.title.includes(' - ')
  )
}

function matchDateFromSlug(slug: string): string | undefined {
  return slug.match(/\d{4}-\d{2}-\d{2}$/u)?.[0]
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error('Could not format the current IPL date.')
  }

  return `${year}-${month}-${day}`
}

function normalizeEvent(value: Record<string, unknown>): GammaEvent {
  return {
    title: stringField(value.title),
    slug: stringField(value.slug),
    active: booleanField(value.active),
    closed: booleanField(value.closed),
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
