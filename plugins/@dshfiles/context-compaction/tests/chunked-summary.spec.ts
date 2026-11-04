import { createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { CompactionBudgetExceeded, serializedMessageBytes, splitSummarizationInput, summarizeInChunks, SummaryRequestFailed } from '../src/chunked-summary.js'

const summary = (text: string) => ({
  summary: [{ type: 'text' as const, text }],
  provider: 'test-provider',
  model: 'test-model',
})

describe('chunked compaction summaries', () => {
  it.effect('splits oversized input while keeping tool calls with their results', () =>
    Effect.gen(function* () {
      const callId = ToolCallId('tool-call-1')
      const systemMessage = createSystemMessage('Keep session facts.')
      const earlierMessage = createUserMessage({
        content: [{ type: 'text', text: 'Earlier context '.repeat(40) }],
        source: { kind: 'user' },
      })
      const toolCall = createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name: 'read_file', arguments: '{"path":"notes.md"}' }],
        source: { provider: 'test-provider', model: 'test-model' },
      })
      const toolResult = createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'The result belongs to this call.' }],
        isError: false,
      })
      const latestMessage = createUserMessage({
        content: [{ type: 'text', text: 'Latest context '.repeat(40) }],
        source: { kind: 'user' },
      })
      const messages = [systemMessage, earlierMessage, toolCall, toolResult, latestMessage]
      const input = { messages }
      const maxInputBytes = Math.max(
        serializedMessageBytes(systemMessage) + serializedMessageBytes(earlierMessage) + 2,
        serializedMessageBytes(systemMessage) + serializedMessageBytes(toolCall) + serializedMessageBytes(toolResult) + 2,
      )
      const chunks = yield* splitSummarizationInput({ input, maxInputBytes, messageBytes: serializedMessageBytes })

      expect(chunks).toHaveLength(3)
      expect(chunks.map(chunk => chunk.messages.filter(message => message.role === 'tool').length)).toEqual([0, 1, 0])
      expect(chunks[1]?.messages).toContain(toolCall)
      expect(chunks[1]?.messages).toContain(toolResult)
      expect(chunks.flatMap(chunk => chunk.messages.slice(1))).toEqual(messages.slice(1))

      const requests: (readonly string[])[] = []
      const result = yield* summarizeInChunks({
        input,
        maxInputBytes,
        messageBytes: serializedMessageBytes,
        summarize: candidate =>
          Effect.sync(() => {
            requests.push(candidate.messages.map(message => message.id))
            return summary(`summary-${requests.length}`)
          }),
      })

      expect(requests).toHaveLength(4)
      expect(result.summary).toEqual([{ type: 'text', text: 'summary-4' }])
    }),
  )

  it.effect('recovers from a provider-confirmed overflow by summarizing balanced halves', () =>
    Effect.gen(function* () {
      const input = {
        messages: [
          createSystemMessage('Keep session facts.'),
          createUserMessage({ content: [{ type: 'text', text: 'First half.' }], source: { kind: 'user' } }),
          createUserMessage({ content: [{ type: 'text', text: 'Second half.' }], source: { kind: 'user' } }),
        ],
      }
      const calls: string[][] = []
      const result = yield* summarizeInChunks({
        input,
        maxInputBytes: 10_000,
        messageBytes: serializedMessageBytes,
        summarize: candidate =>
          Effect.suspend(() => {
            calls.push(candidate.messages.map(message => message.id))
            if (candidate.messages.filter(message => message.role === 'user').length > 1)
              return Effect.fail(new SummaryRequestFailed({ contextOverflow: true, cause: new Error('The provider rejected this context size.') }))
            return Effect.succeed(summary(`summary-${calls.length}`))
          }),
      })

      expect(calls).toHaveLength(4)
      expect(result.summary).toEqual([{ type: 'text', text: 'summary-4' }])
    }),
  )

  it.effect('passes a failure that is not an overflow through unchanged', () =>
    Effect.gen(function* () {
      const providerError = new Error('rate limited')
      const failure = yield* summarizeInChunks({
        input: { messages: [createUserMessage({ content: [{ type: 'text', text: 'Context.' }], source: { kind: 'user' } })] },
        maxInputBytes: 10_000,
        messageBytes: serializedMessageBytes,
        summarize: () => Effect.fail(new SummaryRequestFailed({ contextOverflow: false, cause: providerError })),
      }).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(SummaryRequestFailed)
      expect(failure.cause).toBe(providerError)
    }),
  )

  it.effect('records bounded summary request metadata', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      const input = {
        messages: [
          createSystemMessage('Keep session facts.'),
          createUserMessage({ content: [{ type: 'text', text: 'The retained context.' }], source: { kind: 'user' } }),
        ],
      }

      yield* summarizeInChunks({
        input,
        maxInputBytes: 1_000,
        messageBytes: serializedMessageBytes,
        summarize: () => Effect.succeed(summary('bounded summary')),
      }).pipe(Effect.provide(DshxEffect.tracerLayer))

      expect(recorder.span('context compaction summarize').attributes).toEqual({
        'dshx.context-compaction.input_messages': 2,
        'dshx.context-compaction.initial_chunks': 1,
        'dshx.context-compaction.summary_requests': 1,
      })
    }),
  )

  it.effect('refuses to split an indivisible tool transaction that exceeds the budget', () =>
    Effect.gen(function* () {
      const callId = ToolCallId('large-call')
      const systemMessage = createSystemMessage('Keep session facts.')
      const toolCall = createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name: 'read_file', arguments: '{"path":"notes.md"}' }],
        source: { provider: 'test-provider', model: 'test-model' },
      })
      const toolResult = createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'Large result '.repeat(40) }],
        isError: false,
      })

      const failure = yield* splitSummarizationInput({
        input: { messages: [systemMessage, toolCall, toolResult] },
        maxInputBytes: serializedMessageBytes(systemMessage) + 130,
        messageBytes: serializedMessageBytes,
      }).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(CompactionBudgetExceeded)
      expect(failure.message).toBe('One indivisible conversation or tool-call unit exceeds the safe compaction request budget.')
    }),
  )
})
