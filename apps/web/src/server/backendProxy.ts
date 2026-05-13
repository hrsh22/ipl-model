const BACKEND_UNAVAILABLE_STATUS = 503

export async function proxyBackendJson(path: string, init: RequestInit = {}): Promise<Response> {
  const origin = backendOrigin()
  if (!origin) {
    return missingBackendOriginResponse()
  }
  const url = new URL(path, origin)
  const response = await fetchBackend(url, path, init)

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
  const authorization = request.headers.get('authorization')
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const init: RequestInit = {
    method: request.method,
    headers: {
      ...(hasBody ? { 'content-type': request.headers.get('content-type') ?? 'application/json' } : {}),
      ...(authorization ? { authorization } : {}),
    },
  }

  if (hasBody) {
    init.body = await request.text()
  }

  return await proxyBackendJson(path, init)
}

function backendOrigin(): string | null {
  const configuredOrigin = process.env.IPL_TRADER_API_ORIGIN?.trim()
  return configuredOrigin && configuredOrigin.length > 0 ? configuredOrigin : null
}

async function fetchBackend(url: URL, path: string, init: RequestInit): Promise<Response | null> {
  const authorization = backendAuthorization(path)
  try {
    return await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...init.headers,
        ...(authorization ? { authorization } : {}),
      },
    })
  } catch {
    return null
  }
}

function backendAuthorization(path: string): string | null {
  if (!requiresObserverAuthorization(path)) {
    return null
  }

  const token = process.env.OBSERVER_API_TOKEN?.trim()
  return token && token.length > 0 ? `Bearer ${token}` : null
}

function requiresObserverAuthorization(path: string): boolean {
  return path === '/observer' || path.startsWith('/observer/') || path === '/trading' || path.startsWith('/trading/')
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

function missingBackendOriginResponse(): Response {
  return Response.json(
    {
      error: 'IPL_TRADER_API_ORIGIN must be set to the running Express API origin for web API proxy routes.',
    },
    { status: BACKEND_UNAVAILABLE_STATUS },
  )
}
