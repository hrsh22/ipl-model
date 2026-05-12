import { createFileRoute } from '@tanstack/react-router'
import { proxyBackendJsonRequest } from '../../../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/trading/controls/live')({
  server: {
    handlers: {
      PUT: async ({ request }) => await proxyBackendJsonRequest('/trading/controls/live', request),
      GET: async ({ request }) => await proxyBackendJsonRequest('/trading/controls/live', request),
    },
  },
})
