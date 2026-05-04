import { createFileRoute } from '@tanstack/react-router'

import { proxyBackendJsonRequest } from '../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/live-model')({
  server: {
    handlers: {
      GET: async ({ request }) => await proxyBackendJsonRequest('/observer/live-model', request),
    },
  },
})
