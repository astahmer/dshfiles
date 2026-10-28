import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'

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

export interface ChunkedSummaryOptions {
  readonly input: SummarizeInput
  readonly maxInputBytes: number
  readonly messageBytes: (message: Message) => number
  readonly summarize: (input: SummarizeInput, signal?: AbortSignal) => Promise<SummaryProjection>
  readonly signal?: AbortSignal
}

const serializedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

const toolCallIds = (message: Message) => (message.role === 'assistant' ? message.content.flatMap(block => (block.type === 'tool-call' ? [block.id] : [])) : [])

const toolResultId = (message: Message) => (message.role === 'tool' ? message.source.callId : undefined)

const transactionUnits = (messages: readonly Message[]) => {
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

  if (pendingCallIds.size > 0) throw new Error('Compaction input ends with an unmatched tool call.')
  if (current.length > 0) units.push(current.splice(0))
  return units
}

const systemPrefix = (messages: readonly Message[]) => {
  const firstMessage = messages[0]
  if (firstMessage?.role !== 'system') return []
  return [firstMessage]
}

const withMessages = (input: SummarizeInput, messages: readonly Message[]): SummarizeInput =>
  input.tools === undefined ? { messages } : { messages, tools: input.tools }

const inputBytes = (input: SummarizeInput, messageBytes: (message: Message) => number) =>
  input.messages.reduce((sum, message) => sum + messageBytes(message), 0) + serializedBytes(input.tools ?? [])

const chunksFromUnits = ({
  input,
  units,
  maxInputBytes,
  messageBytes,
}: {
  readonly input: SummarizeInput
  readonly units: readonly Message[][]
  readonly maxInputBytes: number
  readonly messageBytes: (message: Message) => number
}) => {
  const prefix = systemPrefix(input.messages)
  const prefixInput = withMessages(input, prefix)
  const prefixBytes = inputBytes(prefixInput, messageBytes)
  if (prefixBytes > maxInputBytes) throw new Error('The system prompt and tools exceed the safe compaction request budget.')

  const chunks: SummarizeInput[] = []
  let current: Message[] = [...prefix]
  let currentBytes = prefixBytes

  for (const unit of units) {
    const unitBytes = unit.reduce((sum, message) => sum + messageBytes(message), 0)
    if (prefixBytes + unitBytes > maxInputBytes) {
      throw new Error('One indivisible conversation or tool-call unit exceeds the safe compaction request budget.')
    }
    if (currentBytes + unitBytes > maxInputBytes && current.length > prefix.length) {
      chunks.push(withMessages(input, current))
      current = [...prefix]
      currentBytes = prefixBytes
    }
    current.push(...unit)
    currentBytes += unitBytes
  }

  if (current.length > prefix.length || chunks.length === 0) chunks.push(withMessages(input, current))
  return chunks
}

export const splitSummarizationInput = ({ input, maxInputBytes, messageBytes }: Pick<ChunkedSummaryOptions, 'input' | 'maxInputBytes' | 'messageBytes'>) => {
  const prefix = systemPrefix(input.messages)
  const history = input.messages.slice(prefix.length)
  return chunksFromUnits({ input, units: transactionUnits(history), maxInputBytes, messageBytes })
}

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

const splitInHalf = ({ input }: Pick<ChunkedSummaryOptions, 'input'>) => {
  const prefix = systemPrefix(input.messages)
  const units = transactionUnits(input.messages.slice(prefix.length))
  if (units.length < 2) return undefined

  const middle = Math.ceil(units.length / 2)
  const left = units.slice(0, middle).flat()
  const right = units.slice(middle).flat()
  return [withMessages(input, [...prefix, ...left]), withMessages(input, [...prefix, ...right])] as const
}

const hasContextOverflowCode = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'CONTEXT_WINDOW_EXCEEDED'

const withoutOneCallProvenance = (result: SummaryProjection): SummaryProjection => ({
  summary: result.summary,
  provider: result.provider,
  model: result.model,
  ...(result.maxTokens === undefined ? {} : { maxTokens: result.maxTokens }),
})

export const summarizeInChunks = ({ input, maxInputBytes, messageBytes, summarize, signal }: ChunkedSummaryOptions): Promise<SummaryProjection> =>
  withSpan('context compaction summarize', { kind: 'internal' }, async span => {
    let madeMultipleCalls = false
    let initialChunkCount = 0
    let summaryRequestCount = 0

    const summarizeOrSplit = async (candidate: SummarizeInput, overflowDepth = 0): Promise<SummaryProjection> => {
      signal?.throwIfAborted()
      summaryRequestCount += 1
      try {
        return await summarize(candidate, signal)
      } catch (error) {
        if (!hasContextOverflowCode(error)) throw error
        if (overflowDepth > 0) throw error
        const halves = splitInHalf({ input: candidate })
        if (halves === undefined) throw error
        madeMultipleCalls = true
        const left = await summarizeOrSplit(halves[0])
        const right = await summarizeOrSplit(halves[1])
        const reducedInput = inputFromSummaries(candidate, [left, right])
        if (inputBytes(reducedInput, messageBytes) > maxInputBytes) {
          throw new Error('The overflow summaries exceed the safe request budget and cannot be merged.')
        }
        return summarizeOrSplit(reducedInput, overflowDepth + 1)
      }
    }

    try {
      const initialChunks = splitSummarizationInput({ input, maxInputBytes, messageBytes })
      initialChunkCount = initialChunks.length
      if (initialChunks.length === 1) {
        const result = await summarizeOrSplit(initialChunks[0]!)
        return madeMultipleCalls ? withoutOneCallProvenance(result) : result
      }

      madeMultipleCalls = true
      let summaries: SummaryProjection[] = []
      for (const chunk of initialChunks) summaries.push(await summarizeOrSplit(chunk))

      while (summaries.length > 1) {
        const nextInput = inputFromSummaries(input, summaries)
        const reduceChunks = splitSummarizationInput({ input: nextInput, maxInputBytes, messageBytes })
        if (reduceChunks.length >= summaries.length) throw new Error('Compaction summaries cannot be reduced within the safe request budget.')
        const nextSummaries: SummaryProjection[] = []
        for (const chunk of reduceChunks) nextSummaries.push(await summarizeOrSplit(chunk))
        summaries = nextSummaries
      }

      const result = summaries[0]!
      return madeMultipleCalls ? withoutOneCallProvenance(result) : result
    } finally {
      span.setAttributes(
        pluginAttributes({
          plugin: 'context-compaction',
          attributes: {
            input_messages: input.messages.length,
            initial_chunks: initialChunkCount,
            summary_requests: summaryRequestCount,
          },
        }),
      )
    }
  })

export const serializedMessageBytes = serializedBytes
