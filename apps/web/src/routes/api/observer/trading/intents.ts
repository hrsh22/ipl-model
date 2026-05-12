import { createFileRoute } from '@tanstack/react-router'
import { proxyBackendJsonRequest } from '../../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/trading/intents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const limit = url.searchParams.get('limit') || '5'
        return await proxyBackendJsonRequest(`/trading/intents?limit=${limit}`, request)
      },
    },
  },
})
