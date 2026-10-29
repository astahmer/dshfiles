import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { withSpan, type Span } from '@dshfiles/dshx/tracing'
import { z } from 'zod'
import type { EndpointStore } from './endpoint-store.js'
import { isLocalAddress } from './local-address.js'
import { createMcpServer, type ProjectRow } from './mcp-server.js'
import type { SessionsClient } from './sessions-client.js'

export const MCP_PATH = '/mcp'

const MAX_BODY_BYTES = 1_048_576
const SETTINGS_HINT = 'Open DSH Settings › MCP endpoint'

const jsonBodySchema = z.json()
type JsonBody = z.infer<typeof jsonBodySchema>

const rpcSummarySchema = z.looseObject({ method: z.string().max(100), params: z.looseObject({ name: z.string().max(100).optional() }).optional() })

class BodyTooLarge extends Error {}

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge())
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })

const refuse = (input: { readonly response: ServerResponse; readonly status: number; readonly message: string; readonly headers?: Record<string, string> }) => {
  input.response.writeHead(input.status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...input.headers })
  input.response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_000, message: input.message }, id: null }))
}

const bearerOf = (header: string | undefined): string | undefined => /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')?.[1]

const sameOrigin = (request: IncomingMessage): boolean => {
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

const describeRpc = (span: Span, body: JsonBody) => {
  const first = Array.isArray(body) ? body[0] : body
  const rpc = rpcSummarySchema.safeParse(first).data
  if (rpc === undefined) return
  span.setAttribute('mcp.method.name', rpc.method)
  if (rpc.method === 'tools/call' && rpc.params?.name !== undefined) span.setAttribute('gen_ai.tool.name', rpc.params.name)
}

/**
 * Serve MCP's streamable HTTP transport, stateless (no session id generator): each POST gets its own server and
 * transport. The bearer token and the peer address are checked before any MCP parsing; the DSH launch cookie plays no
 * part.
 */
export const createMcpRoute =
  (input: {
    readonly store: EndpointStore
    readonly sessions: () => SessionsClient
    readonly projects: () => readonly ProjectRow[]
    readonly version: string
  }) =>
  (request: IncomingMessage, response: ServerResponse): Promise<void> =>
    withSpan('mcp request', { kind: 'server', attributes: { 'http.request.method': request.method ?? 'unknown' } }, async span => {
      const outcome = (value: string) => span.setAttribute('dshx.mcp.outcome', value)
      if (!isLocalAddress(request.socket.remoteAddress) && !(await input.store.lanEnabled())) {
        outcome('refused-remote')
        return refuse({
          response,
          status: 403,
          message: `This MCP endpoint only accepts clients on the DSH machine. To allow others, ${SETTINGS_HINT} and turn on LAN access.`,
        })
      }
      if (!sameOrigin(request)) {
        outcome('refused-origin')
        return refuse({
          response,
          status: 403,
          message: 'Browser requests from another origin are refused. Call this endpoint from an MCP client, not a web page.',
        })
      }
      const verdict = await input.store.verify(bearerOf(request.headers.authorization) ?? '')
      if (verdict !== 'valid') {
        outcome(verdict === 'missing' ? 'no-token' : 'unauthorized')
        return refuse({
          response,
          status: 401,
          headers: { 'www-authenticate': 'Bearer realm="dsh"' },
          message:
            verdict === 'missing'
              ? `No MCP token has been issued yet. ${SETTINGS_HINT}, generate a token and add it as an Authorization: Bearer header.`
              : `Missing or wrong bearer token. ${SETTINGS_HINT} to copy the setup command, or rotate the token.`,
        })
      }
      if (request.method !== 'POST') {
        // Stateless: no session to resume or delete and no server-initiated stream, so only POST is served.
        outcome('method-not-allowed')
        return refuse({ response, status: 405, headers: { allow: 'POST' }, message: 'This MCP endpoint is stateless: send JSON-RPC requests with POST.' })
      }
      let body: JsonBody
      try {
        body = jsonBodySchema.parse(JSON.parse(await readBody(request)))
      } catch (error) {
        outcome(error instanceof BodyTooLarge ? 'too-large' : 'parse-error')
        if (error instanceof BodyTooLarge) return refuse({ response, status: 413, message: 'The request body is over 1 MiB. Send a smaller message.' })
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_700, message: 'Parse error: the body is not JSON.' }, id: null }))
        return
      }
      describeRpc(span, body)
      outcome('accepted')
      const server = createMcpServer({ sessions: input.sessions(), projects: input.projects, version: input.version })
      // JSON responses, not SSE: the Web server may gzip a response, which would hold back an event stream.
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
      response.on('close', () => {
        void transport.close()
        void server.close()
      })
      // SAFETY: the SDK declares its optional callbacks without `| undefined`, which exactOptionalPropertyTypes rejects; the class implements Transport.
      await server.connect(transport as Transport)
      await transport.handleRequest(request, response, body)
    })
