import { createFileRoute } from '@tanstack/react-router'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'

import { fetchDefaultIplMarket, type DefaultMarketResponse } from '../lib/defaultIplMarket'

export const Route = createFileRoute('/scanner')({
  loader: async () => await loadDefaultMarket(),
  staleTime: 0,
  gcTime: 0,
  shouldReload: true,
  component: ScannerPage,
})

type PnlPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'ALL'
type PnlCategory = 'OVERALL' | 'SPORTS'

type LeaderboardEntry = {
  rank: string
  proxyWallet: string
  userName: string
  vol: number
  pnl: number
}

type TraderPnl = Partial<Record<PnlCategory, Partial<Record<PnlPeriod, LeaderboardEntry>>>>

type EnrichedHolder = {
  proxyWallet: string
  amount: number
  displayName: string
  outcome: string
  bothSides: boolean
  oppositeAmount?: number
  oppositeOutcome?: string
  pnl: TraderPnl
  label: 'profitable-shark' | 'mixed' | 'unprofitable' | 'unknown'
}

type OutcomeReport = {
  token: string
  outcome: string
  holders: EnrichedHolder[]
}

type ScanResponse = {
  event: {
    title: string
    slug: string
  }
  market: {
    question: string
    conditionId: string
    outcomes: string[]
  }
  holderLimit: number
  minBalance: number
  outcomes: OutcomeReport[]
  generatedAt: string
}

type ScanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: ScanResponse }
  | { status: 'error'; message: string }

const compactNumberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

async function loadDefaultMarket(): Promise<DefaultMarketResponse | null> {
  try {
    return await fetchDefaultIplMarket()
  } catch {
    return null
  }
}

function ScannerPage() {
  const defaultMarket = Route.useLoaderData()
  const [resolvedDefaultMarket, setResolvedDefaultMarket] = useState(defaultMarket)
  const [marketUrl, setMarketUrl] = useState(defaultMarket?.url ?? '')
  const [holderLimit, setHolderLimit] = useState(20)
  const [state, setState] = useState<ScanState>({ status: 'idle' })
  const userEditedMarketUrl = useRef(false)

  useEffect(() => {
    setResolvedDefaultMarket(defaultMarket)
    if (!defaultMarket) {
      return
    }

    setMarketUrl((currentUrl) => {
      if (userEditedMarketUrl.current && currentUrl.trim() !== '') {
        return currentUrl
      }
      return defaultMarket.url
    })
  }, [defaultMarket])

  async function scanMarket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState({ status: 'loading' })

    try {
      const response = await fetch('/api/scanner/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: marketUrl, holderLimit, minBalance: 1 }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'Scan failed.'
        throw new Error(message)
      }
      setState({ status: 'success', data: payload as ScanResponse })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Unexpected scan failure.' })
    }
  }

  return (
    <main className="shell scanner-shell">
      <section className="hero-panel scanner-hero">
        <div>
          <p className="eyebrow">Polymarket IPL scanner</p>
          <h1>Find the profitable wallets behind an IPL market.</h1>
          <p>
            Paste a Polymarket match link. The server resolves the market, pulls holder depth, then enriches wallets through
            rate-limited PnL lookups.
          </p>
        </div>
        <div className="signal-card">
          <span className="signal-dot" />
          <strong>Top holder ≠ shark</strong>
          <p>Wallet labels combine position size, weekly/monthly/all-time PnL, sports PnL, and both-side exposure.</p>
        </div>
      </section>

      <form className="scan-panel" onSubmit={scanMarket}>
        <label htmlFor="market-url">Polymarket link or slug</label>
        <div className="input-row">
          <input
            id="market-url"
            value={marketUrl}
            onChange={(event) => {
              userEditedMarketUrl.current = true
              setMarketUrl(event.target.value)
            }}
            placeholder="Resolving today's IPL market…"
          />
          <button type="submit" disabled={state.status === 'loading'}>{state.status === 'loading' ? 'Scanning…' : 'Scan sharks'}</button>
        </div>
        <div className="controls-row">
          <label htmlFor="holder-limit">Holder depth</label>
          <input
            id="holder-limit"
            type="number"
            min={1}
            max={50}
            value={holderLimit}
            onChange={(event) => setHolderLimit(Number(event.target.value))}
          />
          <span>Top holders per outcome. Every wallet is enriched through the backend queue.</span>
        </div>
      </form>

      {resolvedDefaultMarket ? (
        <p className="subdued inline-note">Default market: {resolvedDefaultMarket.title} · {resolvedDefaultMarket.status} · {resolvedDefaultMarket.matchDate}</p>
      ) : null}

      {state.status === 'idle' && <StateCard label="Ready" message="Use the prefilled IPL market or paste another Polymarket link." />}
      {state.status === 'loading' && <StateCard label="Scanning holders" message="Resolving market, pulling holders, and enriching wallet PnL." loading />}
      {state.status === 'error' && <StateCard label="Scan failed" message={state.message} tone="error" />}
      {state.status === 'success' && <Results data={state.data} />}
    </main>
  )
}

function Results({ data }: { data: ScanResponse }) {
  const summary = useMemo(() => summarize(data), [data])

  return (
    <section className="results">
      <div className="market-header panel">
        <div>
          <span className="eyebrow">Market resolved</span>
          <h2>{data.market.question}</h2>
          <p className="condition">{data.market.conditionId}</p>
        </div>
        <div className="summary-strip">
          <Metric label="Wallets" value={String(summary.wallets)} />
          <Metric label="Profitable sharks" value={String(summary.profitable)} />
          <Metric label="Large losers" value={String(summary.unprofitable)} />
          <Metric label="Both sides" value={String(summary.bothSides)} />
        </div>
      </div>

      <div className="outcome-grid">
        {data.outcomes.map((outcome) => {
          const stats = summarizeOutcome(outcome)
          return (
            <article className="outcome-card" key={outcome.token}>
              <div className="outcome-title">
                <div>
                  <span>{outcome.outcome}</span>
                  <small>{outcome.holders.length} holders · {stats.checked} PnL checked</small>
                </div>
                <div className="team-shark-count">
                  <strong>{stats.profitable}</strong>
                  <span>profitable sharks</span>
                  <small>{formatAmount(stats.profitableShares)} shares</small>
                </div>
              </div>
              <div className="holder-list">
                {outcome.holders.map((holder, index) => <HolderRow holder={holder} index={index} key={`${holder.proxyWallet}-${holder.outcome}`} />)}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function HolderRow({ holder, index }: { holder: EnrichedHolder; index: number }) {
  const week = holder.pnl.OVERALL?.WEEK?.pnl
  const month = holder.pnl.OVERALL?.MONTH?.pnl
  const all = holder.pnl.OVERALL?.ALL?.pnl
  const sportsRank = holder.pnl.SPORTS?.ALL?.rank

  return (
    <div className={`holder-row ${holder.label}`}>
      <div className="rank">#{index + 1}</div>
      <div className="holder-main">
        <div className="holder-name">
          <a href={`https://polymarket.com/profile/${holder.proxyWallet}`} target="_blank" rel="noreferrer">{holder.displayName}</a>
          <span>{shortWallet(holder.proxyWallet)}</span>
        </div>
        <div className="wallet-metrics">
          <span>{formatAmount(holder.amount)} shares</span>
          {holder.bothSides && holder.oppositeAmount !== undefined ? <span>Other side {formatAmount(holder.oppositeAmount)}</span> : null}
          <span>W {formatMoney(week)}</span>
          <span>M {formatMoney(month)}</span>
          <span>All {formatMoney(all)}</span>
        </div>
      </div>
      <div className="tag-stack">
        <span className="label">{labelText(holder)}</span>
        {sportsRank ? <span className="rank-pill">Sports #{sportsRank}</span> : null}
        {holder.bothSides ? <span className="hedge-pill">Both sides</span> : null}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function StateCard({ label, message, loading = false, tone }: { label: string; message: string; loading?: boolean; tone?: 'error' }) {
  return (
    <section className={`state-card ${tone === 'error' ? 'error-card' : ''}`}>
      <span>{label}</span>
      <p>{message}</p>
      {loading ? <div className="loader" /> : null}
    </section>
  )
}

function summarize(data: ScanResponse) {
  const holders = data.outcomes.flatMap((outcome) => outcome.holders)
  const bothSideWallets = new Set<string>()
  for (const holder of holders) {
    if (holder.bothSides) {
      bothSideWallets.add(holder.proxyWallet)
    }
  }
  return {
    wallets: new Set(holders.map((holder) => holder.proxyWallet)).size,
    profitable: holders.filter((holder) => holder.label === 'profitable-shark').length,
    unprofitable: holders.filter((holder) => holder.label === 'unprofitable').length,
    bothSides: bothSideWallets.size,
  }
}

function summarizeOutcome(outcome: OutcomeReport) {
  const profitableHolders = outcome.holders.filter((holder) => holder.label === 'profitable-shark')
  return {
    checked: outcome.holders.filter((holder) => Boolean(holder.pnl.OVERALL || holder.pnl.SPORTS)).length,
    profitable: profitableHolders.length,
    profitableShares: profitableHolders.reduce((total, holder) => total + holder.amount, 0),
  }
}

function labelText(holder: EnrichedHolder): string {
  if (!holder.pnl.OVERALL && !holder.pnl.SPORTS) {
    return 'No PnL data'
  }
  switch (holder.label) {
    case 'profitable-shark':
      return 'Profitable shark'
    case 'unprofitable':
      return 'Large but losing'
    case 'mixed':
      return 'Mixed signal'
    case 'unknown':
      return 'Unknown PnL'
  }
}

function formatMoney(value: number | undefined): string {
  if (value === undefined) {
    return '—'
  }
  const sign = value > 0 ? '+' : ''
  return `${sign}${compactNumberFormatter.format(value)}`
}

function formatAmount(value: number): string {
  return compactNumberFormatter.format(value)
}

function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
