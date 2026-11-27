import { jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { Option, Schema } from 'effect'

// The `secret mcp` wire protocol: newline-delimited JSON-RPC. The process itself lives in secret-mcp-service.ts.

/** One JSON-RPC answer: `id` pairs it with its request, `result` carries the server's own payload. */
const answerSchema = Schema.Struct({
  id: Schema.Number,
  result: Schema.optionalKey(jsonValueSchema),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
})

export type SecretMcpAnswer = typeof answerSchema.Type

/** One tool answer: `content` carries the tool's text payload, `isError` says the call itself failed. */
const toolAnswerSchema = Schema.Struct({
  content: Schema.optionalKey(Schema.Array(Schema.Struct({ type: Schema.optionalKey(Schema.String), text: Schema.optionalKey(Schema.String) }))),
  isError: Schema.optionalKey(Schema.Boolean),
})

/** The `secret_run` payload; only the fields the tool reads are named, and the rest stays readable. */
const runPayloadSchema = Schema.StructWithRest(
  Schema.Struct({
    exitCode: Schema.optionalKey(Schema.Number),
    timedOut: Schema.optionalKey(Schema.Boolean),
    stdout: Schema.optionalKey(Schema.String),
    stderr: Schema.optionalKey(Schema.String),
    injectedAliases: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  [Schema.Record(Schema.String, jsonValueSchema)],
)

export type SecretMcpRunPayload = typeof runPayloadSchema.Type

/** One line written to the child's stdin. */
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id?: number
  readonly method: string
  readonly params?: JsonValue
}

const decodeJsonText = Schema.decodeUnknownOption(Schema.fromJsonString(jsonValueSchema))
const decodeToolAnswer = Schema.decodeUnknownOption(toolAnswerSchema)
const decodeRunPayload = Schema.decodeUnknownOption(runPayloadSchema)

/** One stdout line as an answer; a line that is not JSON-RPC is dropped, like a message for nobody. */
export const decodeAnswerLine = Schema.decodeUnknownOption(Schema.fromJsonString(answerSchema))

export const initializeParams = {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: '@dshfiles/secret-catalog', version: '1' },
} satisfies JsonValue

/** A `tools/call` result: the tool's JSON payload, or the refusal text the tool reported. */
export type ToolOutcome = { readonly kind: 'payload'; readonly payload: SecretMcpRunPayload } | { readonly kind: 'refused'; readonly message: string }

export const toolOutcomeOf = (name: string, answer: SecretMcpAnswer): ToolOutcome | undefined => {
  const toolAnswer = Option.getOrUndefined(decodeToolAnswer(answer.result))
  if (toolAnswer === undefined) return undefined
  const text = (toolAnswer.content ?? []).map(part => part.text ?? '').join('')
  const parsed = decodeJsonText(text)
  if (toolAnswer.isError === true) {
    const message = Option.match(parsed, {
      onNone: () => `secret mcp ${name} failed`,
      onSome: value => (Schema.is(Schema.String)(value) ? value : `secret mcp ${name} failed`),
    })
    return { kind: 'refused', message }
  }
  return { kind: 'payload', payload: Option.getOrElse(Option.flatMap(parsed, decodeRunPayload), () => ({})) }
}

export interface SecretMcpRunResult {
  readonly exitCode: number
  readonly timedOut: boolean
  readonly stdout: string
  readonly stderr: string
  readonly injectedAliases: readonly string[]
}

export const toRunResult = (value: SecretMcpRunPayload): SecretMcpRunResult => ({
  exitCode: value.exitCode ?? 0,
  timedOut: value.timedOut === true,
  stdout: value.stdout ?? '',
  stderr: value.stderr ?? '',
  injectedAliases: value.injectedAliases ?? [],
})
