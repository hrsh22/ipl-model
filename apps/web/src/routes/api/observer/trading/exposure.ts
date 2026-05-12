import { createFileRoute } from '@tanstack/react-router'
import { proxyBackendJsonRequest } from '../../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/trading/exposure')({
  server: {
    handlers: {
      GET: async ({ request }) => await proxyBackendJsonRequest('/trading/exposure', request),
    },
  },
})
