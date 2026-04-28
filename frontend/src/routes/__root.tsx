import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import appStyles from "../styles.css?url"

const queryClient = new QueryClient()

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "IPL Live Model Observer" },
    ],
    links: [{ rel: "stylesheet", href: appStyles }],
  }),
  component: RootDocument,
  notFoundComponent: NotFound,
})

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <main className="shell">
      <section className="hero-panel compact-panel">
        <div>
          <p className="eyebrow">Route not found</p>
          <h1>Nothing on this pitch</h1>
          <p className="hero-copy">Return to the live model desk at `/`.</p>
        </div>
      </section>
    </main>
  )
}
