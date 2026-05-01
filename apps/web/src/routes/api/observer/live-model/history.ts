import { createFileRoute } from '@tanstack/react-router'

import { proxyBackendJson } from '../../../../server/backendProxy'

export const Route = createFileRoute('/api/observer/live-model/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const search = new URL(request.url).search
        return await proxyBackendJson(`/observer/live-model/history${search}`)
      },
    },
  },
})
