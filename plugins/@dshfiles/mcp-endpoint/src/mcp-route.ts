import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Effect, Schema } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
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

class McpRequestFailure extends Schema.TaggedError<McpRequestFailure>()('McpRequestFailure', {
  kind: Schema.Literals(['too-large', 'invalid-body', 'transport']),
}) {}

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

const describeRpc = (body: JsonBody) => {
  const first = Array.isArray(body) ? body[0] : body
  const rpc = rpcSummarySchema.safeParse(first).data
  if (rpc === undefined) return Effect.void
  return Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan('mcp.method.name', rpc.method)
    if (rpc.method === 'tools/call' && rpc.params?.name !== undefined) yield* Effect.annotateCurrentSpan('gen_ai.tool.name', rpc.params.name)
  })
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
    Effect.runPromise(
      Effect.provide(
        Effect.fn('mcp request', { kind: 'server', attributes: { 'http.request.method': request.method ?? 'unknown' } })(() =>
          Effect.gen(function* () {
            const outcome = (value: string) => Effect.annotateCurrentSpan('dshx.mcp.outcome', value)
            if (!isLocalAddress(request.socket.remoteAddress)) {
              const lanEnabled = yield* Effect.tryPromise({
                try: () => input.store.lanEnabled(),
                catch: () => new McpRequestFailure({ kind: 'transport' }),
              })
              if (!lanEnabled) {
                yield* outcome('refused-remote')
                return refuse({
                  response,
                  status: 403,
                  message: `This MCP endpoint only accepts clients on the DSH machine. To allow others, ${SETTINGS_HINT} and turn on LAN access.`,
                })
              }
            }
            if (!sameOrigin(request)) {
              yield* outcome('refused-origin')
              return refuse({
                response,
                status: 403,
                message: 'Browser requests from another origin are refused. Call this endpoint from an MCP client, not a web page.',
              })
            }
            const verdict = yield* Effect.tryPromise({
              try: () => input.store.verify(bearerOf(request.headers.authorization) ?? ''),
              catch: () => new McpRequestFailure({ kind: 'transport' }),
            })
            if (verdict !== 'valid') {
              yield* outcome(verdict === 'missing' ? 'no-token' : 'unauthorized')
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
              yield* outcome('method-not-allowed')
              return refuse({ response, status: 405, headers: { allow: 'POST' }, message: 'This MCP endpoint is stateless: send JSON-RPC requests with POST.' })
            }
            const bodyRead = yield* Effect.tryPromise({
              try: () => readBody(request),
              catch: error => new McpRequestFailure({ kind: error instanceof BodyTooLarge ? 'too-large' : 'invalid-body' }),
            }).pipe(
              Effect.match({
                onFailure: failure => ({ failure }),
                onSuccess: text => ({ text }),
              }),
            )
            if ('failure' in bodyRead) {
              if (bodyRead.failure.kind === 'too-large') {
                yield* outcome('too-large')
                return refuse({ response, status: 413, message: 'The request body is over 1 MiB. Send a smaller message.' })
              }
              yield* outcome('parse-error')
              response.writeHead(400, { 'content-type': 'application/json' })
              response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_700, message: 'Parse error: the body is not JSON.' }, id: null }))
              return
            }
            const text = bodyRead.text
            const parsed = yield* Effect.try({
              try: () => jsonBodySchema.parse(JSON.parse(text)),
              catch: () => new McpRequestFailure({ kind: 'invalid-body' }),
            }).pipe(
              Effect.match({
                onFailure: failure => ({ failure }),
                onSuccess: body => ({ body }),
              }),
            )
            if ('failure' in parsed) {
              yield* outcome('parse-error')
              response.writeHead(400, { 'content-type': 'application/json' })
              response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_700, message: 'Parse error: the body is not JSON.' }, id: null }))
              return
            }
            yield* describeRpc(parsed.body)
            yield* outcome('accepted')
            const server = createMcpServer({ sessions: input.sessions(), projects: input.projects, version: input.version })
            const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
            response.on('close', () => {
              void transport.close()
              void server.close()
            })
            yield* Effect.tryPromise({
              try: async () => {
                await server.connect(transport)
                await transport.handleRequest(request, response, parsed.body)
              },
              catch: () => new McpRequestFailure({ kind: 'transport' }),
            })
          }),
        )(),
        DshxEffect.tracerLayer,
      ),
    )
