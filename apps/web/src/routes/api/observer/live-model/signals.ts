import { createFileRoute } from '@tanstack/react-router'

import { proxyBackendJsonRequest } from '../../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/live-model/signals')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const search = new URL(request.url).search
        return await proxyBackendJsonRequest(`/observer/live-model/signals${search}`, request)
      },
    },
  },
})
