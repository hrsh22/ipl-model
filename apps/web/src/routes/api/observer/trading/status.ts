import { createFileRoute } from '@tanstack/react-router'
import { proxyBackendJsonRequest } from '../../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/trading/status')({
  server: {
    handlers: {
      GET: async ({ request }) => await proxyBackendJsonRequest('/trading/status', request),
    },
  },
})
