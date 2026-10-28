import { createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { serializedMessageBytes, splitSummarizationInput, summarizeInChunks } from '../src/chunked-summary.js'

const summary = (text: string) => ({
  summary: [{ type: 'text' as const, text }],
  provider: 'test-provider',
  model: 'test-model',
})

describe('chunked compaction summaries', () => {
  it('splits oversized input while keeping tool calls with their results', async () => {
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
    const chunks = splitSummarizationInput({ input, maxInputBytes, messageBytes: serializedMessageBytes })

    expect(chunks).toHaveLength(3)
    expect(chunks.map(chunk => chunk.messages.filter(message => message.role === 'tool').length)).toEqual([0, 1, 0])
    expect(chunks[1]?.messages).toContain(toolCall)
    expect(chunks[1]?.messages).toContain(toolResult)
    expect(chunks.flatMap(chunk => chunk.messages.slice(1))).toEqual(messages.slice(1))

    const requests: (readonly string[])[] = []
    const result = await summarizeInChunks({
      input,
      maxInputBytes,
      messageBytes: serializedMessageBytes,
      summarize: async candidate => {
        requests.push(candidate.messages.map(message => message.id))
        return summary(`summary-${requests.length}`)
      },
    })

    expect(requests).toHaveLength(4)
    expect(result.summary).toEqual([{ type: 'text', text: 'summary-4' }])
  })

  it('recovers from a provider-confirmed overflow by summarizing balanced halves', async () => {
    const input = {
      messages: [
        createSystemMessage('Keep session facts.'),
        createUserMessage({ content: [{ type: 'text', text: 'First half.' }], source: { kind: 'user' } }),
        createUserMessage({ content: [{ type: 'text', text: 'Second half.' }], source: { kind: 'user' } }),
      ],
    }
    const calls: string[][] = []
    const result = await summarizeInChunks({
      input,
      maxInputBytes: 10_000,
      messageBytes: serializedMessageBytes,
      summarize: async candidate => {
        calls.push(candidate.messages.map(message => message.id))
        if (candidate.messages.filter(message => message.role === 'user').length > 1) {
          throw Object.assign(new Error('The provider rejected this context size.'), { code: 'CONTEXT_WINDOW_EXCEEDED' })
        }
        return summary(`summary-${calls.length}`)
      },
    })

    expect(calls).toHaveLength(4)
    expect(result.summary).toEqual([{ type: 'text', text: 'summary-4' }])
  })

  it('records bounded summary request metadata', async () => {
    using recorder = recordSpans()
    const input = {
      messages: [
        createSystemMessage('Keep session facts.'),
        createUserMessage({ content: [{ type: 'text', text: 'The retained context.' }], source: { kind: 'user' } }),
      ],
    }

    await summarizeInChunks({
      input,
      maxInputBytes: 1_000,
      messageBytes: serializedMessageBytes,
      summarize: async () => summary('bounded summary'),
    })

    expect(recorder.span('context compaction summarize').attributes).toEqual({
      'dshx.context-compaction.input_messages': 2,
      'dshx.context-compaction.initial_chunks': 1,
      'dshx.context-compaction.summary_requests': 1,
    })
  })

  it('refuses to split an indivisible tool transaction that exceeds the budget', () => {
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

    expect(() =>
      splitSummarizationInput({
        input: { messages: [systemMessage, toolCall, toolResult] },
        maxInputBytes: serializedMessageBytes(systemMessage) + 130,
        messageBytes: serializedMessageBytes,
      }),
    ).toThrow('One indivisible conversation or tool-call unit exceeds the safe compaction request budget.')
  })
})
