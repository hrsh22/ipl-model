import { createFileRoute } from '@tanstack/react-router'

import { proxyBackendJson } from '../../../server/backendProxy'

export const Route = createFileRoute('/api/predictor/performance')({
  server: {
    handlers: {
      GET: async () => await proxyBackendJson('/predictor/api/performance'),
    },
  },
})
