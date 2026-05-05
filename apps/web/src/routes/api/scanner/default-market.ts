import { createFileRoute } from '@tanstack/react-router'

import { fetchDefaultIplMarket } from '../../../lib/defaultIplMarket'

export const Route = createFileRoute('/api/scanner/default-market')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const defaultMarket = await fetchDefaultIplMarket()
          return Response.json(defaultMarket, {
            headers: {
              'cache-control': 'no-store',
            },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to resolve default IPL market.'
          return Response.json(
            { error: message },
            {
              status: 404,
              headers: {
                'cache-control': 'no-store',
              },
            },
          )
        }
      },
    },
  },
})
