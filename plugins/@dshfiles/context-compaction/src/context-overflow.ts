import { CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError } from '@deepseek-ai/dsh-llm'
import { Schema } from 'effect'

/**
 * Provider wording the core classifier (`isContextWindowExceededError`) misses. Each names a request too large for
 * the model; none matches a per-minute token rate limit.
 */
const OVERFLOW_WORDING: readonly RegExp[] = [
  // Anthropic: "prompt is too long: 213000 tokens > 200000 maximum"
  /\bprompt is too long\b/i,
  // Anthropic: "input length and `max_tokens` exceed context limit"
  /\bexceeds? (?:the )?context limit\b/i,
  // Gemini: "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)."
  /\binput token count\b.{0,40}\bexceeds the maximum number of tokens\b/i,
  // Bedrock: "Input is too long for requested model."
  /\binput is too long for (?:the )?requested model\b/i,
  // llama.cpp server: "the request exceeds the available context size"
  /\bexceeds the available context size\b/i,
  // xAI: "This model's maximum prompt length is 131072 but the request contains 140000 tokens."
  /\bmaximum prompt length is \d+/i,
  // OpenAI-compatible legacy: "Please reduce the length of the messages or completion."
  /\breduce the length of the messages\b/i,
  // Moonshot/Kimi: "Invalid request: exceeded model token limit: 262144"
  /\bexceeded model token limit\b/i,
  // GitHub Copilot: "prompt token count of 140000 exceeds the limit of 128000"
  /\bprompt token count of \d+ exceeds the limit\b/i,
  // Zhipu GLM: "Prompt exceeds max length"
  /\bprompt exceeds max(?:imum)? length\b/i,
  // Cohere: "too many tokens: total number of tokens in the prompt cannot exceed 128000"
  /\btotal number of tokens in the prompt cannot exceed\b/i,
]

const ErrorShape = Schema.Struct({
  code: Schema.optional(Schema.Unknown),
  type: Schema.optional(Schema.Unknown),
  message: Schema.optional(Schema.Unknown),
  status: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
  cause: Schema.optional(Schema.Unknown),
})
const decodeErrorShape = Schema.decodeUnknownOption(ErrorShape)

const MAX_DEPTH = 6

/** What a provider failure says about itself: its codes, types and messages, and the HTTP statuses it carries. */
interface ErrorDetails {
  readonly texts: readonly string[]
  readonly statuses: readonly number[]
}

const NO_DETAILS: ErrorDetails = { texts: [], statuses: [] }

/** Every code, type and message along an error's `cause` chain and nested provider `error` bodies. */
const errorDetails = (cause: unknown, depth = 0): ErrorDetails => {
  if (depth > MAX_DEPTH) return NO_DETAILS
  if (typeof cause === 'string') return { texts: [cause], statuses: [] } satisfies ErrorDetails
  const shape = decodeErrorShape(cause)
  if (shape._tag === 'None') return NO_DETAILS
  const own = [shape.value.code, shape.value.type, shape.value.message].filter((part): part is string => typeof part === 'string')
  const status = typeof shape.value.status === 'number' ? [shape.value.status] : []
  const nested = [shape.value.error, shape.value.cause].map(child => errorDetails(child, depth + 1))
  return { texts: [...own, ...nested.flatMap(entry => entry.texts)], statuses: [...status, ...nested.flatMap(entry => entry.statuses)] } satisfies ErrorDetails
}

/**
 * Whether a provider failure says the request exceeded the model's context window: the core code, the core
 * wording classifier, or provider wording it misses, anywhere along the cause chain. An HTTP 413 counts only when it
 * also talks about tokens or context, since a 413 alone can be an attachment size limit.
 */
export const isProviderContextOverflow = (error: unknown): boolean => {
  const details = errorDetails(error)
  if (details.texts.includes(CONTEXT_WINDOW_EXCEEDED_CODE)) return true
  const detail = details.texts.join(' ')
  if (isContextWindowExceededError(detail) || OVERFLOW_WORDING.some(pattern => pattern.test(detail))) return true
  return details.statuses.includes(413) && /\b(?:tokens?|context)\b/i.test(detail)
}
