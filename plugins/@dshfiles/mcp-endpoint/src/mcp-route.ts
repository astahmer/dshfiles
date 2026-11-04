import type { IncomingMessage, ServerResponse } from 'node:http'
import { Effect, Option, Result, Schema } from 'effect'
import { EndpointTokens } from './endpoint-tokens.js'
import { isLocalAddress } from './local-address.js'
import { McpServers } from './mcp-sdk-promise.js'

export const MCP_PATH = '/mcp'

const MAX_BODY_BYTES = 1_048_576
const SETTINGS_HINT = 'Open DSH Settings › MCP endpoint'

const decodeJsonBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))

/** Only the JSON-RPC method and tool name are read, to name the request span. */
const rpcSummarySchema = Schema.Struct({
  method: Schema.String.check(Schema.isMaxLength(100)),
  params: Schema.optionalKey(Schema.Struct({ name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))) })),
})
const decodeRpcSummary = Schema.decodeUnknownOption(rpcSummarySchema)

class BodyTooLarge extends Schema.TaggedError<BodyTooLarge>()('BodyTooLarge', { limit: Schema.Number, cause: Schema.optional(Schema.Defect()) }) {
  override get message(): string {
    return `The request body is over ${String(this.limit)} bytes.`
  }
}

class BodyUnreadable extends Schema.TaggedError<BodyUnreadable>()('BodyUnreadable', { cause: Schema.optional(Schema.Defect()) }) {
  override get message(): string {
    return 'The request body could not be read.'
  }
}

/** Collect the request body up to MAX_BODY_BYTES; a larger body destroys the request. */
const readBody = (request: IncomingMessage) =>
  Effect.callback<string, BodyTooLarge | BodyUnreadable>(resume => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resume(Effect.fail(new BodyTooLarge({ limit: MAX_BODY_BYTES })))
        request.destroy()
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => resume(Effect.succeed(Buffer.concat(chunks).toString('utf8')))
    const onError = (cause: Error) => resume(Effect.fail(new BodyUnreadable({ cause })))
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    return Effect.sync(() => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
    })
  })

const refuse = (input: { readonly response: ServerResponse; readonly status: number; readonly message: string; readonly headers?: Record<string, string> }) =>
  Effect.sync(() => {
    input.response.writeHead(input.status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...input.headers })
    input.response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_000, message: input.message }, id: null }))
  })

const refuseUnparsable = (response: ServerResponse) =>
  Effect.sync(() => {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_700, message: 'Parse error: the body is not JSON.' }, id: null }))
  })

const bearerOf = (header: string | undefined): string | undefined => /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')?.[1]

const sameOrigin = (request: IncomingMessage): boolean => {
  const origin = request.headers.origin
  if (origin === undefined) return true
  return URL.canParse(origin) && new URL(origin).host === request.headers.host
}

const describeRpc = (body: Schema.Json) =>
  Option.match(decodeRpcSummary(Array.isArray(body) ? body[0] : body), {
    onNone: () => Effect.void,
    onSome: rpc =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan('mcp.method.name', rpc.method)
        if (rpc.method === 'tools/call' && rpc.params?.name !== undefined) yield* Effect.annotateCurrentSpan('gen_ai.tool.name', rpc.params.name)
      }),
  })

const outcome = (value: string) => Effect.annotateCurrentSpan('dshx.mcp.outcome', value)

/**
 * Serve MCP's streamable HTTP transport, stateless: each POST gets its own server and transport. The bearer token
 * and the peer address are checked before any MCP parsing; the DSH launch cookie plays no part.
 */
export const handleMcpRequest = Effect.fn('mcp request', { kind: 'server' })(function* (input: {
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly version: string
}) {
  const request = input.request
  const response = input.response
  const tokens = yield* EndpointTokens
  yield* Effect.annotateCurrentSpan('http.request.method', request.method ?? 'unknown')
  if (!isLocalAddress(request.socket.remoteAddress) && !(yield* tokens.lanEnabled)) {
    yield* outcome('refused-remote')
    return yield* refuse({
      response,
      status: 403,
      message: `This MCP endpoint only accepts clients on the DSH machine. To allow others, ${SETTINGS_HINT} and turn on LAN access.`,
    })
  }
  if (!sameOrigin(request)) {
    yield* outcome('refused-origin')
    return yield* refuse({
      response,
      status: 403,
      message: 'Browser requests from another origin are refused. Call this endpoint from an MCP client, not a web page.',
    })
  }
  const verdict = yield* tokens.verify(bearerOf(request.headers.authorization) ?? '')
  if (verdict !== 'valid') {
    yield* outcome(verdict === 'missing' ? 'no-token' : 'unauthorized')
    return yield* refuse({
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
    return yield* refuse({ response, status: 405, headers: { allow: 'POST' }, message: 'This MCP endpoint is stateless: send JSON-RPC requests with POST.' })
  }
  const text = yield* Effect.result(readBody(request))
  if (Result.isFailure(text) && text.failure._tag === 'BodyTooLarge') {
    yield* outcome('too-large')
    return yield* refuse({ response, status: 413, message: 'The request body is over 1 MiB. Send a smaller message.' })
  }
  const body = Result.isSuccess(text) ? decodeJsonBody(text.success) : Option.none()
  if (Option.isNone(body)) {
    yield* outcome('parse-error')
    return yield* refuseUnparsable(response)
  }
  yield* describeRpc(body.value)
  yield* outcome('accepted')
  const servers = yield* McpServers
  yield* servers.serve({ request, response, body: body.value, version: input.version })
})
