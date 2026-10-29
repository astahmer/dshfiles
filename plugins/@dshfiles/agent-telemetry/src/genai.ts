// Ported from @loongsuite/dsh-plugin 0.1.3 (src/mapping.ts) and the span attribute rules of
// @loongsuite/otel-util-genai 0.1.1; Apache-2.0, see NOTICE and UPSTREAM.md.
import type { StreamChunk, TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm'
import { decodeJson } from '@dshfiles/dshx/json'
import type { SpanAttributeValue } from '@dshfiles/dshx/tracing'
import { z } from 'zod'

export type Attributes = Record<string, SpanAttributeValue | undefined>

export const AGENT_SYSTEM = 'deepseek-harness'

/** Span names and GenAI operation/kind values, as LoongSuite's ExtendedTelemetryHandler emits them. */
export const GenAiNames = {
  entrySpan: 'enter_ai_application_system',
  reactStepSpan: 'react step',
  invokeAgentSpan: (agentName: string) => `invoke_agent ${agentName}`,
  chatSpan: (model: string) => `chat ${model}`.trim(),
  executeToolSpan: (toolName: string) => `execute_tool ${toolName}`.trim(),
} as const

/** Attributes whose values are message content; present only when content capture is on. */
const CONTENT_ATTRIBUTES = {
  inputMessages: 'gen_ai.input.messages',
  outputMessages: 'gen_ai.output.messages',
  systemInstructions: 'gen_ai.system_instructions',
  toolDefinitions: 'gen_ai.tool.definitions',
  toolArguments: 'gen_ai.tool.call.arguments',
  toolResult: 'gen_ai.tool.call.result',
} as const

/** dshx bounds every attribute string to 1,024 characters; content longer than that becomes a valid JSON marker. */
export const CONTENT_MAX_CHARS = 1_024

export const operationAttributes = {
  entry: { 'gen_ai.operation.name': 'enter', 'gen_ai.span.kind': 'ENTRY' },
  agent: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.span.kind': 'AGENT' },
  step: { 'gen_ai.operation.name': 'react', 'gen_ai.span.kind': 'STEP' },
  chat: { 'gen_ai.operation.name': 'chat', 'gen_ai.span.kind': 'LLM' },
  tool: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.span.kind': 'TOOL', 'gen_ai.tool.type': 'function' },
} as const satisfies Record<string, Attributes>

/** Normalize DSH finish kinds to the GenAI spellings LoongSuite put on spans. */
const finishReason = (kind: string | undefined): string => {
  switch (kind) {
    case 'tool-calls':
      return 'tool_calls'
    case 'max-tokens':
      return 'length'
    case 'aborted':
      return 'cancelled'
    case undefined:
      return 'unknown'
    default:
      return kind
  }
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

const emptyTotals = (): UsageTotals => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

const addUsage = (total: UsageTotals, usage: TokenUsage): void => {
  total.inputTokens += usage.inputTokens
  total.outputTokens += usage.outputTokens
  total.cacheReadTokens += usage.cacheReadTokens ?? 0
  total.cacheWriteTokens += usage.cacheWriteTokens ?? 0
}

/**
 * DSH reports uncached input, cache reads and cache writes as disjoint buckets; the GenAI conventions define the cache
 * counts as subsets of `gen_ai.usage.input_tokens`, so the three are summed back (LoongSuite's `applyUsage`).
 */
const usageAttributes = (usage: TokenUsage) => {
  const inputTokens = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  return {
    'gen_ai.usage.input_tokens': inputTokens,
    'gen_ai.usage.output_tokens': usage.outputTokens,
    'gen_ai.usage.cache_read.input_tokens': usage.cacheReadTokens,
    'gen_ai.usage.cache_creation.input_tokens': usage.cacheWriteTokens,
    'gen_ai.usage.total_tokens': inputTokens + usage.outputTokens > 0 ? inputTokens + usage.outputTokens : undefined,
    'gen_ai.usage.reasoning_tokens': usage.reasoningTokens,
  } satisfies Attributes
}

const totalsAttributes = (totals: UsageTotals) => {
  const inputTokens = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
  return {
    'gen_ai.usage.input_tokens': inputTokens,
    'gen_ai.usage.output_tokens': totals.outputTokens,
    'gen_ai.usage.cache_read.input_tokens': totals.cacheReadTokens,
    'gen_ai.usage.cache_creation.input_tokens': totals.cacheWriteTokens,
    'gen_ai.usage.total_tokens': inputTokens + totals.outputTokens,
  } satisfies Attributes
}

/** A chunk the user would see: the first one stamps time-to-first-token. */
const isVisibleToken = (chunk: StreamChunk): boolean => {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text !== ''
  if (chunk.type !== 'tool-call-delta') return false
  return chunk.name !== undefined || chunk.argumentsDelta !== ''
}

/**
 * JSON with an explicit truncation marker instead of a cut string, so a viewer always parses it.
 * Captured content is whatever the harness recorded, so it only ever flows through `JSON.stringify`.
 */
const serializeCaptured = <Captured>(value: Captured): string => {
  const serialized = JSON.stringify(value) ?? 'null'
  if (serialized.length <= CONTENT_MAX_CHARS) return serialized
  return JSON.stringify({ truncated: true, original_characters: serialized.length, limit_characters: CONTENT_MAX_CHARS })
}

const blockSchema = z.looseObject({ type: z.string() })
export type LooseBlock = z.infer<typeof blockSchema>
const contentBlocksSchema = z.array(blockSchema).catch([])

const jsonSchema = z.json()
type JsonValue = z.infer<typeof jsonSchema>

const textField = z.string().catch('')
const textBlockSchema = z.looseObject({ text: textField })
const toolCallBlockSchema = z.looseObject({ id: textField, name: textField, arguments: textField })
const toolResultBlockSchema = z.looseObject({ toolCallId: textField, content: contentBlocksSchema })
const imageBlockSchema = z.looseObject({ attachment: z.looseObject({}).catch({}) })

/** One message part in the GenAI vocabulary; a block type this mapping does not know passes through as DSH wrote it. */
type GenAiPart =
  | { readonly type: 'text' | 'reasoning'; readonly content: string }
  | { readonly type: 'tool_call'; readonly id: string | null; readonly name: string; readonly arguments: JsonValue }
  | { readonly type: 'tool_call_response'; readonly id: string | null; readonly response: readonly GenAiPart[] }
  | ({ readonly type: 'image' } & z.infer<typeof imageBlockSchema>['attachment'])
  | LooseBlock

/** One DSH content block in the GenAI message-parts vocabulary (LoongSuite `mapContentBlock`). */
const mapContentBlock = (block: LooseBlock): GenAiPart => {
  switch (block.type) {
    case 'text':
      return { type: 'text', content: textBlockSchema.parse(block).text }
    case 'reasoning':
      return { type: 'reasoning', content: textBlockSchema.parse(block).text }
    case 'tool-call': {
      const call = toolCallBlockSchema.parse(block)
      return { type: 'tool_call', id: call.id || null, name: call.name, arguments: parseToolArguments(call.arguments) }
    }
    case 'tool-result': {
      const result = toolResultBlockSchema.parse(block)
      return { type: 'tool_call_response', id: result.toolCallId || null, response: mapContent(result.content) }
    }
    case 'image':
      return { type: 'image', ...imageBlockSchema.parse(block).attachment }
    default:
      return { ...block }
  }
}

const mapContent = (blocks: readonly LooseBlock[]): GenAiPart[] => blocks.map(block => mapContentBlock(block))

const parseToolArguments = (value: string): JsonValue => {
  try {
    return decodeJson(jsonSchema, value)
  } catch {
    return value
  }
}

export const messageSchema = z.looseObject({
  role: z.string(),
  content: contentBlocksSchema,
  source: z.looseObject({ kind: z.string(), callId: z.string().optional() }).catch({ kind: 'unknown' }),
})
export type CapturedMessage = z.infer<typeof messageSchema>

export interface GenAiMessage {
  readonly role: string
  readonly parts: readonly GenAiPart[]
  readonly finishReason?: string
}

/** DSH encodes tool results as user messages; GenAI represents them with role `tool`. */
const inputMessage = (message: CapturedMessage): GenAiMessage => ({
  role: message.source.kind === 'tool' ? 'tool' : message.role,
  parts: mapContent(message.content),
})

const outputMessage = (message: CapturedMessage, reason: string): GenAiMessage => ({
  role: message.role,
  parts: mapContent(message.content),
  finishReason: reason,
})

const toolDefinitions = (tools: readonly ToolSchema[] | undefined) =>
  (tools ?? []).map(tool => ({ type: 'function', name: tool.name, description: tool.description || null, parameters: tool.parameters }))

const systemInstruction = (system: string | undefined) => (system === undefined || system === '' ? [] : [{ type: 'text', content: system }])

const withFinishReason = (messages: readonly GenAiMessage[]) =>
  messages.map(message => ({ role: message.role, parts: message.parts, finish_reason: message.finishReason }))

const capturedLlmAttributes = (input: {
  readonly system: string | undefined
  readonly tools: readonly ToolSchema[] | undefined
  readonly inputMessages: readonly GenAiMessage[]
  readonly outputMessages: readonly GenAiMessage[]
}) =>
  ({
    [CONTENT_ATTRIBUTES.inputMessages]: serializeCaptured(input.inputMessages),
    [CONTENT_ATTRIBUTES.outputMessages]: serializeCaptured(withFinishReason(input.outputMessages)),
    [CONTENT_ATTRIBUTES.systemInstructions]: serializeCaptured(systemInstruction(input.system)),
    [CONTENT_ATTRIBUTES.toolDefinitions]: serializeCaptured(toolDefinitions(input.tools)),
  }) satisfies Attributes

const capturedConversationAttributes = (input: { readonly inputs: readonly GenAiMessage[]; readonly outputs: readonly GenAiMessage[] }) =>
  ({
    [CONTENT_ATTRIBUTES.inputMessages]: serializeCaptured(input.inputs),
    [CONTENT_ATTRIBUTES.outputMessages]: serializeCaptured(withFinishReason(input.outputs.slice(-1))),
  }) satisfies Attributes

const CONTENT_MODES = new Set(['SPAN_ONLY', 'SPAN_AND_EVENT'])

/** `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` put content on spans only for these two modes (LoongSuite). */
const contentCaptureFromEnvironment = (env: Readonly<Record<string, string | undefined>>): boolean =>
  CONTENT_MODES.has(env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT?.trim().toUpperCase() ?? '')

export class GenAi {
  static readonly finishReason = finishReason
  static readonly emptyTotals = emptyTotals
  static readonly addUsage = addUsage
  static readonly usageAttributes = usageAttributes
  static readonly totalsAttributes = totalsAttributes
  static readonly isVisibleToken = isVisibleToken
  static readonly serializeCaptured = serializeCaptured
  static readonly contentBlocks = contentBlocksSchema
  static readonly contentBlock = blockSchema
  static readonly mapContent = mapContent
  static readonly parseToolArguments = parseToolArguments
  static readonly inputMessage = inputMessage
  static readonly outputMessage = outputMessage
  static readonly capturedLlmAttributes = capturedLlmAttributes
  static readonly capturedConversationAttributes = capturedConversationAttributes
  static readonly contentCaptureFromEnvironment = contentCaptureFromEnvironment
}
