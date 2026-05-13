import { createFileRoute } from '@tanstack/react-router'
import { proxyBackendJsonRequest } from '../../../../server/backendProxy'

export function tradingIntentsProxyPath(requestUrl: string): string {
  const search = new URL(requestUrl).search
  return `/trading/intents${search}`
}

export const Route = createFileRoute('/api/observer/trading/intents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return await proxyBackendJsonRequest(tradingIntentsProxyPath(request.url), request)
      },
    },
  },
})
