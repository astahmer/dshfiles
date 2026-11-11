import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { pluginAttributes } from '@dshfiles/dshx/tracing'
import { Effect, Ref, Schema } from 'effect'

export interface SummaryProjection {
  readonly summary: ContentBlock[]
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
}

export interface SummarizeInput {
  readonly messages: readonly Message[]
  readonly tools?: readonly ToolSchema[]
}

const budgetMessages = {
  'unmatched-tool-call': 'Compaction input ends with an unmatched tool call.',
  'prefix-too-large':
    'The system prompt and tools exceed the safe compaction request budget. Choose a model route with a larger declared context window, or reduce the enabled tools.',
  'unit-too-large': 'One indivisible conversation or tool-call unit exceeds the safe compaction request budget.',
  'overflow-merge-too-large': 'The overflow summaries exceed the safe request budget and cannot be merged.',
  'summaries-irreducible': 'Compaction summaries cannot be reduced within the safe request budget.',
} as const

/** The conversation cannot be split into summary requests that fit the route's safe input budget. */
export class CompactionBudgetExceeded extends Schema.TaggedError<CompactionBudgetExceeded>()('CompactionBudgetExceeded', {
  reason: Schema.Literals(['unmatched-tool-call', 'prefix-too-large', 'unit-too-large', 'overflow-merge-too-large', 'summaries-irreducible']),
}) {
  override get message(): string {
    return budgetMessages[this.reason]
  }
}

/** One summary request failed; `contextOverflow` when the provider confirmed the input exceeded its context window. */
export class SummaryRequestFailed extends Schema.TaggedError<SummaryRequestFailed>()('SummaryRequestFailed', {
  contextOverflow: Schema.Boolean,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.contextOverflow ? 'The summary request exceeded the model context window.' : 'The summary request failed.'
  }
}

export interface ChunkedSummaryOptions {
  readonly input: SummarizeInput
  readonly maxInputBytes: number
  readonly messageBytes: (message: Message) => number
  readonly summarize: (input: SummarizeInput) => Effect.Effect<SummaryProjection, SummaryRequestFailed>
}

const serializedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

const toolCallIds = (message: Message) => (message.role === 'assistant' ? message.content.flatMap(block => (block.type === 'tool-call' ? [block.id] : [])) : [])

const toolResultId = (message: Message) => (message.role === 'tool' ? message.source.callId : undefined)

const transactionUnits = Effect.fnUntraced(function* (messages: readonly Message[]) {
  const units: Message[][] = []
  const current: Message[] = []
  const pendingCallIds = new Set<string>()

  for (const message of messages) {
    current.push(message)
    for (const callId of toolCallIds(message)) pendingCallIds.add(callId)
    const resultId = toolResultId(message)
    if (resultId !== undefined) pendingCallIds.delete(resultId)
    if (pendingCallIds.size === 0) units.push(current.splice(0))
  }

  if (pendingCallIds.size > 0) return yield* new CompactionBudgetExceeded({ reason: 'unmatched-tool-call' })
  if (current.length > 0) units.push(current.splice(0))
  return units
})

const systemPrefix = (messages: readonly Message[]) => {
  const firstMessage = messages[0]
  if (firstMessage?.role !== 'system') return []
  return [firstMessage]
}

const withMessages = (input: SummarizeInput, messages: readonly Message[]): SummarizeInput =>
  input.tools === undefined ? { messages } : { messages, tools: input.tools }

const inputBytes = (input: SummarizeInput, messageBytes: (message: Message) => number) =>
  input.messages.reduce((sum, message) => sum + messageBytes(message), 0) + serializedBytes(input.tools ?? [])

/** Text blocks shorter than this stay whole: shortening them saves too little to be worth the lost detail. */
const SHORTEN_MIN_CHARS = 2_048
const SHORTEN_HEAD_CHARS = 1_024
const SHORTEN_TAIL_CHARS = 512
/** On a provider-confirmed overflow, the shortened request aims at this share of the rejected one. */
const OVERFLOW_SHORTEN_RATIO = 0.6

const shortenText = (text: string) => {
  if (text.length <= SHORTEN_MIN_CHARS) return text
  const omitted = text.length - SHORTEN_HEAD_CHARS - SHORTEN_TAIL_CHARS
  return `${text.slice(0, SHORTEN_HEAD_CHARS)}\n[… ${String(omitted)} characters omitted to fit the compaction request …]\n${text.slice(-SHORTEN_TAIL_CHARS)}`
}

const shortenMessage = (message: Message): Message => {
  if (message.role === 'system') return message
  if (message.role === 'tool')
    return { ...message, content: message.content.map(block => (block.type === 'text' ? { ...block, text: shortenText(block.text) } : block)) }
  if (message.role === 'assistant')
    return { ...message, content: message.content.map(block => (block.type === 'text' ? { ...block, text: shortenText(block.text) } : block)) }
  return { ...message, content: message.content.map(block => (block.type === 'text' ? { ...block, text: shortenText(block.text) } : block)) }
}

/**
 * Shorten long text in `messages`, oldest first, until they fit `targetBytes`: tool outputs first, then the text of
 * older exchanges. Each shortened block keeps its head and tail. The last `protectedCount` messages stay intact.
 * Returns the messages unchanged when nothing long enough was found.
 */
const shortenOldest = (options: {
  readonly messages: readonly Message[]
  readonly protectedCount: number
  readonly targetBytes: number
  readonly messageBytes: (message: Message) => number
}): { readonly messages: readonly Message[]; readonly shortened: number } => {
  const messages = [...options.messages]
  const shortenable = messages.length - options.protectedCount
  let total = messages.reduce((sum, message) => sum + options.messageBytes(message), 0)
  let shortened = 0
  for (const pass of [(message: Message) => message.role === 'tool', (message: Message) => message.role === 'user' || message.role === 'assistant']) {
    for (let index = 0; index < shortenable && total > options.targetBytes; index += 1) {
      const message = messages[index]
      if (message === undefined || !pass(message)) continue
      const replacement = shortenMessage(message)
      const saved = options.messageBytes(message) - options.messageBytes(replacement)
      if (saved <= 0) continue
      messages[index] = replacement
      total -= saved
      shortened += 1
    }
  }
  return { messages, shortened }
}

/**
 * The rejected request with its older tool outputs and exchanges shortened, its newest transaction intact; undefined
 * when nothing could be shortened.
 */
const shortenOlderContent = Effect.fnUntraced(function* (options: {
  readonly input: SummarizeInput
  readonly targetBytes: number
  readonly messageBytes: (message: Message) => number
}) {
  const prefix = systemPrefix(options.input.messages)
  const units = yield* transactionUnits(options.input.messages.slice(prefix.length))
  const newest = units.at(-1) ?? []
  const prefixBytes = inputBytes(withMessages(options.input, prefix), options.messageBytes)
  const result = shortenOldest({
    messages: units.flat(),
    protectedCount: newest.length,
    targetBytes: options.targetBytes - prefixBytes,
    messageBytes: options.messageBytes,
  })
  if (result.shortened === 0) return undefined
  return { input: withMessages(options.input, [...prefix, ...result.messages]), shortened: result.shortened }
})

const chunksFromUnits = Effect.fnUntraced(function* (options: {
  readonly input: SummarizeInput
  readonly units: readonly Message[][]
  readonly maxInputBytes: number
  readonly messageBytes: (message: Message) => number
}) {
  const prefix = systemPrefix(options.input.messages)
  const prefixBytes = inputBytes(withMessages(options.input, prefix), options.messageBytes)
  if (prefixBytes > options.maxInputBytes) return yield* new CompactionBudgetExceeded({ reason: 'prefix-too-large' })

  const unitBytes = (unit: readonly Message[]) => unit.reduce((sum, message) => sum + options.messageBytes(message), 0)
  // A single transaction larger than one request keeps its structure and loses only the middle of its long outputs.
  const fitted = options.units.map(unit =>
    prefixBytes + unitBytes(unit) <= options.maxInputBytes
      ? unit
      : [
          ...shortenOldest({ messages: unit, protectedCount: 0, targetBytes: options.maxInputBytes - prefixBytes, messageBytes: options.messageBytes })
            .messages,
        ],
  )
  const sized = fitted.map(unit => ({ unit, bytes: unitBytes(unit) }))
  if (sized.some(entry => prefixBytes + entry.bytes > options.maxInputBytes)) return yield* new CompactionBudgetExceeded({ reason: 'unit-too-large' })

  const chunks: SummarizeInput[] = []
  let current: Message[] = [...prefix]
  let currentBytes = prefixBytes

  for (const entry of sized) {
    if (currentBytes + entry.bytes > options.maxInputBytes && current.length > prefix.length) {
      chunks.push(withMessages(options.input, current))
      current = [...prefix]
      currentBytes = prefixBytes
    }
    current.push(...entry.unit)
    currentBytes += entry.bytes
  }

  if (current.length > prefix.length || chunks.length === 0) chunks.push(withMessages(options.input, current))
  return chunks
})

export const splitSummarizationInput = Effect.fnUntraced(function* (options: Pick<ChunkedSummaryOptions, 'input' | 'maxInputBytes' | 'messageBytes'>) {
  const prefix = systemPrefix(options.input.messages)
  const units = yield* transactionUnits(options.input.messages.slice(prefix.length))
  return yield* chunksFromUnits({ ...options, units })
})

const inputFromSummaries = (input: SummarizeInput, summaries: readonly SummaryProjection[]): SummarizeInput => {
  const prefix = systemPrefix(input.messages)
  const summaryMessages = summaries.map(summary =>
    createAssistantMessage({
      content: summary.summary,
      source: { provider: summary.provider, model: summary.model },
    }),
  )
  return withMessages(input, [...prefix, ...summaryMessages])
}

const splitInHalf = Effect.fnUntraced(function* (input: SummarizeInput) {
  const prefix = systemPrefix(input.messages)
  const units = yield* transactionUnits(input.messages.slice(prefix.length))
  if (units.length < 2) return undefined

  const middle = Math.ceil(units.length / 2)
  const left = units.slice(0, middle).flat()
  const right = units.slice(middle).flat()
  return [withMessages(input, [...prefix, ...left]), withMessages(input, [...prefix, ...right])] as const
})

const withoutOneCallProvenance = (result: SummaryProjection): SummaryProjection => ({
  summary: result.summary,
  provider: result.provider,
  model: result.model,
  ...(result.maxTokens !== undefined && { maxTokens: result.maxTokens }),
})

/**
 * Summarize `input` in requests that each fit `maxInputBytes`, reducing partial summaries until one remains. A
 * provider-confirmed overflow splits that request in balanced halves once.
 */
export const summarizeInChunks = Effect.fn('context compaction summarize')(function* (options: ChunkedSummaryOptions) {
  const madeMultipleCalls = yield* Ref.make(false)
  const initialChunkCount = yield* Ref.make(0)
  const summaryRequestCount = yield* Ref.make(0)

  const shortenedMessages = yield* Ref.make(0)

  const summarizeOrSplit = (
    candidate: SummarizeInput,
    overflowDepth = 0,
    shortened = false,
  ): Effect.Effect<SummaryProjection, SummaryRequestFailed | CompactionBudgetExceeded> =>
    Ref.update(summaryRequestCount, count => count + 1).pipe(
      Effect.andThen(options.summarize(candidate)),
      Effect.catchTag('SummaryRequestFailed', failure =>
        Effect.gen(function* () {
          if (!failure.contextOverflow || overflowDepth > 0) return yield* failure
          // Shortening older outputs keeps every exchange in one request; splitting is the fallback when it is not enough.
          if (!shortened) {
            const shorter = yield* shortenOlderContent({
              input: candidate,
              targetBytes: Math.floor(inputBytes(candidate, options.messageBytes) * OVERFLOW_SHORTEN_RATIO),
              messageBytes: options.messageBytes,
            })
            if (shorter !== undefined) {
              yield* Ref.update(shortenedMessages, count => count + shorter.shortened)
              return yield* summarizeOrSplit(shorter.input, overflowDepth, true)
            }
          }
          const halves = yield* splitInHalf(candidate)
          if (halves === undefined) return yield* failure
          yield* Ref.set(madeMultipleCalls, true)
          const left = yield* summarizeOrSplit(halves[0])
          const right = yield* summarizeOrSplit(halves[1])
          const reducedInput = inputFromSummaries(candidate, [left, right])
          if (inputBytes(reducedInput, options.messageBytes) > options.maxInputBytes)
            return yield* new CompactionBudgetExceeded({ reason: 'overflow-merge-too-large' })
          return yield* summarizeOrSplit(reducedInput, overflowDepth + 1)
        }),
      ),
    )

  const summarizeAll = Effect.gen(function* () {
    const initialChunks = yield* splitSummarizationInput(options)
    yield* Ref.set(initialChunkCount, initialChunks.length)
    if (initialChunks.length > 1) yield* Ref.set(madeMultipleCalls, true)

    let summaries = yield* Effect.forEach(initialChunks, chunk => summarizeOrSplit(chunk))
    while (summaries.length > 1) {
      const reduceChunks = yield* splitSummarizationInput({ ...options, input: inputFromSummaries(options.input, summaries) })
      if (reduceChunks.length >= summaries.length) return yield* new CompactionBudgetExceeded({ reason: 'summaries-irreducible' })
      summaries = yield* Effect.forEach(reduceChunks, chunk => summarizeOrSplit(chunk))
    }

    const [result] = summaries
    if (result === undefined) return yield* new CompactionBudgetExceeded({ reason: 'summaries-irreducible' })
    return (yield* Ref.get(madeMultipleCalls)) ? withoutOneCallProvenance(result) : result
  })

  return yield* summarizeAll.pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan(
          pluginAttributes({
            plugin: 'context-compaction',
            attributes: {
              input_messages: options.input.messages.length,
              initial_chunks: yield* Ref.get(initialChunkCount),
              summary_requests: yield* Ref.get(summaryRequestCount),
              shortened_messages: yield* Ref.get(shortenedMessages),
            },
          }),
        )
      }),
    ),
  )
})

export const serializedMessageBytes = serializedBytes
