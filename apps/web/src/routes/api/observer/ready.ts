import { createFileRoute } from '@tanstack/react-router'

import { proxyBackendJson } from '../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/ready')({
  server: {
    handlers: {
      GET: async () => await proxyBackendJson('/ready'),
    },
  },
})
