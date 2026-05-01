const DEFAULT_BACKEND_ORIGIN = 'http://localhost:8080'
const BACKEND_UNAVAILABLE_STATUS = 503

export async function proxyBackendJson(path: string, init: RequestInit = {}): Promise<Response> {
  const origin = backendOrigin()
  const url = new URL(path, origin)
  const response = await fetchBackend(url, init)

  if (!response) {
    return backendUnavailableResponse(url)
  }

  const text = await response.text()
  return new Response(text, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json',
    },
  })
}

export async function proxyBackendJsonRequest(path: string, request: Request): Promise<Response> {
  return await proxyBackendJson(path, {
    method: request.method,
    body: await request.text(),
    headers: {
      'content-type': request.headers.get('content-type') ?? 'application/json',
    },
  })
}

function backendOrigin(): string {
  const configuredOrigin = process.env.IPL_TRADER_API_ORIGIN?.trim()
  return configuredOrigin && configuredOrigin.length > 0 ? configuredOrigin : DEFAULT_BACKEND_ORIGIN
}

async function fetchBackend(url: URL, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...init.headers,
      },
    })
  } catch {
    return null
  }
}

function backendUnavailableResponse(url: URL): Response {
  return Response.json(
    {
      error: `IPL Trader backend is unavailable at ${url.origin}. Start the Express API with pnpm dev, or set IPL_TRADER_API_ORIGIN to the running backend origin.`,
      backendOrigin: url.origin,
    },
    { status: BACKEND_UNAVAILABLE_STATUS },
  )
}
