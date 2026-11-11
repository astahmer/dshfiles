/**
 * Pure rules of the stateless MCP revision `2026-07-28` over Streamable HTTP: per-request `_meta`, the mirrored
 * `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` / `Mcp-Param-*` headers, SSE response framing, and the
 * modern-versus-legacy decision a dual-era client makes from its `server/discover` probe.
 *
 * Spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
 */

/** The only modern revision this client speaks. */
const MODERN_PROTOCOL_VERSION = '2026-07-28'

/** Identity sent in every request's `_meta`; serverInfo is never trusted, clientInfo is only informational. */
const CLIENT_INFO = { name: 'dshfiles-mcp-servers', version: '0.1.0' } as const

/** JSON-RPC codes a modern server returns on `400`; any of them proves the server is modern. */
const MODERN_ERROR_CODES = { headerMismatch: -32020, missingClientCapability: -32021, unsupportedVersion: -32022 } as const

const MODERN_CODES: ReadonlySet<number> = new Set(Object.values(MODERN_ERROR_CODES))

export type JsonRecord = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What one `server/discover` answer says; `serverInfo` is display-only. */
export interface Discovery {
  readonly version: string
  readonly capabilities: JsonRecord
  readonly instructions: string
}

/**
 * How the client continues after its `server/discover` probe:
 * - `modern`: speak 2026-07-28 statelessly.
 * - `legacy`: the answer is not a recognized modern answer; use the 2025-11-25 `initialize` handshake.
 * - `incompatible`: a modern server that does not offer our revision, or refuses our request; a legacy
 *   handshake is still tried, but the reason is logged so the user sees why the server stays empty.
 */
export type ProbeOutcome =
  | { readonly kind: 'modern'; readonly discovery: Discovery }
  | { readonly kind: 'legacy'; readonly reason: string }
  | { readonly kind: 'incompatible'; readonly reason: string }

/** A JSON-RPC error object, when `body` is one. */
const jsonRpcError = (body: unknown): { readonly code: number; readonly message: string; readonly data: unknown } | undefined => {
  if (!isRecord(body) || !isRecord(body['error'])) return undefined
  const { code, message, data } = body['error']
  if (typeof code !== 'number') return undefined
  return { code, message: typeof message === 'string' ? message.slice(0, 240) : '', data }
}

const stringList = (value: unknown): ReadonlyArray<string> => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

/** Classify the probe's HTTP status and parsed JSON body (undefined when the body was empty or not JSON). */
const classifyProbe = (status: number, body: unknown): ProbeOutcome => {
  const error = jsonRpcError(body)
  if (status >= 200 && status < 300 && isRecord(body) && isRecord(body['result'])) {
    const result = body['result']
    const versions = stringList(result['supportedVersions'])
    if (!versions.includes(MODERN_PROTOCOL_VERSION))
      return { kind: 'incompatible', reason: `server/discover offered ${versions.join(', ') || 'no versions'}, not ${MODERN_PROTOCOL_VERSION}` }
    return {
      kind: 'modern',
      discovery: {
        version: MODERN_PROTOCOL_VERSION,
        capabilities: isRecord(result['capabilities']) ? result['capabilities'] : {},
        instructions: typeof result['instructions'] === 'string' ? result['instructions'] : '',
      },
    }
  }
  if (error !== undefined && MODERN_CODES.has(error.code)) {
    if (error.code === MODERN_ERROR_CODES.unsupportedVersion) {
      const supported = isRecord(error.data) ? stringList(error.data['supported']) : []
      return { kind: 'incompatible', reason: `the server supports ${supported.join(', ') || 'no listed versions'}, not ${MODERN_PROTOCOL_VERSION}` }
    }
    return { kind: 'incompatible', reason: `server/discover was refused with code ${error.code}${error.message ? `: ${error.message}` : ''}` }
  }
  return { kind: 'legacy', reason: `server/discover answered HTTP ${status}${error === undefined ? '' : ` with JSON-RPC code ${error.code}`}` }
}

/** RFC 9110 visible ASCII, space and tab, without leading/trailing whitespace or the base64 sentinel shape. */
const plainHeaderValue = /^[\x21-\x7e](?:[\x20-\x7e\t]*[\x21-\x7e])?$/

/** Encode one header value: plain ASCII as-is, anything else as `=?base64?…?=` of its UTF-8 bytes. */
const encodeHeaderValue = (value: string): string => {
  const sentinel = value.startsWith('=?base64?') && value.endsWith('?=')
  if (plainHeaderValue.test(value) && !sentinel) return value
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/** RFC 9110 `tchar`. */
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** One `x-mcp-header` annotation: where its value lives in the arguments and which header carries it. */
export interface ParamHeader {
  readonly path: ReadonlyArray<string>
  readonly header: string
}

/**
 * Collect a tool's `x-mcp-header` annotations, or explain why the tool must be rejected. Annotations are valid only on
 * integer, string or boolean properties reachable through `properties` keys alone, with unique token names.
 */
const paramHeaders = (inputSchema: unknown): { readonly ok: true; readonly headers: ReadonlyArray<ParamHeader> } | { readonly ok: false; readonly reason: string } => {
  const found: Array<ParamHeader> = []
  const allowed = new Set<unknown>()
  const reachable = (schema: unknown, path: ReadonlyArray<string>): string | undefined => {
    if (!isRecord(schema)) return undefined
    allowed.add(schema)
    const properties = schema['properties']
    if (isRecord(properties))
      for (const [key, child] of Object.entries(properties)) {
        const failure = reachable(child, [...path, key])
        if (failure !== undefined) return failure
      }
    const name = schema['x-mcp-header']
    if (name === undefined) return undefined
    if (typeof name !== 'string' || !token.test(name)) return `x-mcp-header at ${path.join('.') || '(root)'} is not an HTTP token`
    if (!['integer', 'string', 'boolean'].includes(String(schema['type']))) return `x-mcp-header ${name} is not on an integer, string or boolean property`
    if (found.some(header => header.header.toLowerCase() === name.toLowerCase())) return `x-mcp-header ${name} is declared twice`
    found.push({ path, header: name })
    return undefined
  }
  const failure = reachable(inputSchema, [])
  if (failure !== undefined) return { ok: false, reason: failure }
  // An annotation anywhere else (items, anyOf, $ref, …) invalidates the tool.
  const stray = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(stray)
    if (!isRecord(value)) return false
    if (!allowed.has(value) && value['x-mcp-header'] !== undefined) return true
    return Object.values(value).some(stray)
  }
  if (stray(inputSchema)) return { ok: false, reason: 'x-mcp-header is only allowed on properties reachable through `properties` keys' }
  return { ok: true, headers: found }
}

/** The `Mcp-Param-*` headers for one call; a missing or null value omits its header. */
const paramHeaderValues = (headers: ReadonlyArray<ParamHeader>, args: JsonRecord): Readonly<Record<string, string>> => {
  const values: Record<string, string> = {}
  for (const { path, header } of headers) {
    let value: unknown = args
    for (const key of path) value = isRecord(value) ? value[key] : undefined
    if (value === undefined || value === null) continue
    if (typeof value === 'string') values[`Mcp-Param-${header}`] = encodeHeaderValue(value)
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value))) values[`Mcp-Param-${header}`] = String(value)
  }
  return values
}

/** The methods whose `params.name` or `params.uri` is mirrored into `Mcp-Name`. */
const NAMED_METHODS: Readonly<Record<string, 'name' | 'uri'>> = { 'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri' }

/** One modern JSON-RPC request: its body and the headers that mirror it. */
const request = (input: {
  readonly id: number
  readonly method: string
  readonly params: JsonRecord
  readonly extraHeaders?: Readonly<Record<string, string>> | undefined
}): { readonly body: string; readonly headers: Readonly<Record<string, string>> } => {
  const params = {
    ...input.params,
    _meta: {
      ...(isRecord(input.params['_meta']) ? input.params['_meta'] : {}),
      'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
      'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  }
  const nameField = NAMED_METHODS[input.method]
  const name = nameField === undefined ? undefined : input.params[nameField]
  return {
    body: JSON.stringify({ jsonrpc: '2.0', id: input.id, method: input.method, params }),
    headers: {
      ...input.extraHeaders,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
      'Mcp-Method': input.method,
      ...(typeof name === 'string' && { 'Mcp-Name': encodeHeaderValue(name) }),
    },
  }
}

/** The JSON-RPC response for `id` among the messages of one response, ignoring request-scoped notifications. */
const responseFor = (id: number, message: unknown): JsonRecord | undefined =>
  isRecord(message) && message['id'] === id && ('result' in message || 'error' in message) ? message : undefined

/**
 * Incremental SSE decoder for one request-scoped response stream: feed decoded text, get each event's `data`.
 * Comment lines (`:`) and other fields are ignored; streams are not resumable, so `id` is unused.
 */
const sseDecoder = () => {
  let buffer = ''
  let data: Array<string> = []
  return (text: string): ReadonlyArray<string> => {
    buffer += text
    const events: Array<string> = []
    for (;;) {
      const newline = buffer.search(/\r\n|\r|\n/)
      if (newline === -1) return events
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + (buffer.startsWith('\r\n', newline) ? 2 : 1))
      if (line === '') {
        if (data.length > 0) events.push(data.join('\n'))
        data = []
      } else if (line.startsWith('data:')) data.push(line.slice(line.startsWith('data: ') ? 6 : 5))
    }
  }
}

/** A modern result: `resultType` absent or `complete`; `input_required` (MRTR) needs elicitation/sampling DSH lacks. */
const completeResult = (result: unknown): { readonly ok: true; readonly result: JsonRecord } | { readonly ok: false; readonly reason: string } => {
  if (!isRecord(result)) return { ok: false, reason: 'the server returned a result that is not an object' }
  const { resultType, ...rest } = result
  if (resultType === undefined || resultType === 'complete') return { ok: true, result: rest }
  if (resultType === 'input_required') return { ok: false, reason: 'the server asked for client input (sampling, elicitation or roots), which DSH does not provide yet' }
  return { ok: false, reason: `the server returned an unknown resultType ${String(resultType).slice(0, 40)}` }
}

/** The 2026-07-28 wire rules, grouped for the client, the bridge and tests. */
export class StatelessMcpModel {
  static readonly MODERN_PROTOCOL_VERSION = MODERN_PROTOCOL_VERSION
  static readonly CLIENT_INFO = CLIENT_INFO
  static readonly MODERN_ERROR_CODES = MODERN_ERROR_CODES
  static readonly classifyProbe = classifyProbe
  static readonly completeResult = completeResult
  static readonly encodeHeaderValue = encodeHeaderValue
  static readonly jsonRpcError = jsonRpcError
  static readonly paramHeaders = paramHeaders
  static readonly paramHeaderValues = paramHeaderValues
  static readonly request = request
  static readonly responseFor = responseFor
  static readonly sseDecoder = sseDecoder
}
