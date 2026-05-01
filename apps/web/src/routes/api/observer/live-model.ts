import { createFileRoute } from '@tanstack/react-router'

import { proxyBackendJson } from '../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/live-model')({
  server: {
    handlers: {
      GET: async () => await proxyBackendJson('/observer/live-model'),
    },
  },
})
