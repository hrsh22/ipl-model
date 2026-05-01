import { createFileRoute } from '@tanstack/react-router'

import { proxyBackendJsonRequest } from '../../../server/backendProxy'

export const Route = createFileRoute('/api/predictor/context')({
  server: {
    handlers: {
      POST: async ({ request }) => await proxyBackendJsonRequest('/predictor/api/context', request),
    },
  },
})
