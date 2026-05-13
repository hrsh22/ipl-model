import { createFileRoute } from '@tanstack/react-router'
import { proxyBackendJsonRequest } from '../../../../server/backendProxy'

export function tradingEventsProxyPath(requestUrl: string): string {
  const search = new URL(requestUrl).search
  return `/trading/events${search}`
}

export const Route = createFileRoute('/api/observer/trading/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return await proxyBackendJsonRequest(tradingEventsProxyPath(request.url), request)
      },
    },
  },
})
