import { createFileRoute } from '@tanstack/react-router'

import { proxyBackendJsonRequest } from '../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/ball-state-shadow')({
  server: {
    handlers: {
      GET: async ({ request }) => await proxyBackendJsonRequest('/observer/ball-state-shadow', request),
    },
  },
})
