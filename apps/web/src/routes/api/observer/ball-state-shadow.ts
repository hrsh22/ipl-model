import { createFileRoute } from '@tanstack/react-router'

import { proxyBackendJson } from '../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/ball-state-shadow')({
  server: {
    handlers: {
      GET: async () => await proxyBackendJson('/observer/ball-state-shadow'),
    },
  },
})
