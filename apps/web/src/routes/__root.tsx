/// <reference types="vite/client" />
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'description', content: 'Unified IPL trading workspace for predictor and Polymarket scanner.' },
      { title: 'IPL Trader Console' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Fraunces:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
})

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <nav className="app-nav" aria-label="Primary navigation">
          <Link to="/predictor" activeProps={{ className: 'active' }}>Predictor</Link>
          <Link to="/scanner" activeProps={{ className: 'active' }}>Scanner</Link>
          <Link to="/observer" activeProps={{ className: 'active' }}>Observer</Link>
          <Link to="/eleven-over" activeProps={{ className: 'active' }}>11-over</Link>
        </nav>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}

function NotFoundComponent() {
  return (
    <main className="shell compact-shell">
      <section className="panel hero-panel">
        <p className="eyebrow">Route not found</p>
        <h1>Nothing on this pitch.</h1>
        <p className="subdued">Use the Predictor tab for model reads or Scanner for Polymarket holder intelligence.</p>
      </section>
    </main>
  )
}
