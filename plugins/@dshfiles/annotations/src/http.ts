import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Both routes are called by the extension from `chrome-extension://<id>`, which is a
 * cross-origin caller: without these headers the browser hides the response and the
 * extension would look connected while receiving nothing.
 */
const corsFor = ({ origin, allowed }: { readonly origin: string | undefined; readonly allowed: readonly string[] }): Record<string, string> => {
  if (origin === undefined) return {}
  if (allowed.length > 0 && !allowed.includes(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

const respond = ({
  response,
  status,
  body,
  headers = {},
}: {
  readonly response: ServerResponse
  readonly status: number
  readonly body: unknown
  readonly headers?: Record<string, string>
}): void => {
  const payload = body === undefined ? '' : JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  })
  response.end(payload)
}

/** Answers a preflight, and reports whether the request was one. */
const answerPreflight = ({
  request,
  response,
  allowed,
}: {
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly allowed: readonly string[]
}): boolean => {
  if (request.method !== 'OPTIONS') return false
  respond({ response, status: 204, body: undefined, headers: corsFor({ origin: request.headers.origin, allowed }) })
  return true
}

export const HttpResponses = {
  corsFor,
  respond,
  answerPreflight,
}
