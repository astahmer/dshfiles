import { MessageId, ToolCallId, type GenerateOptions, type RequestMessage, type StreamChunk, type ToolSchema } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { explainSilentRejections } from './silent-rejection.js'

const tool = (name: string): ToolSchema => ({ name, description: name, parameters: { type: 'object', properties: {} } })
const user: RequestMessage = { role: 'user', content: [{ type: 'text', text: 'go' }] }
const assistantCalling = (callId: string): RequestMessage => ({
  role: 'assistant',
  id: MessageId(`assistant-${callId}`),
  source: { kind: 'model', provider: 'opencode-go-alex', model: 'deepseek-v4.1-flash' },
  content: [{ type: 'tool-call', id: ToolCallId(callId), name: 'bash', arguments: '{}' }],
})
const resultOf = (callId: string): RequestMessage => ({
  role: 'tool',
  id: MessageId(`result-${callId}`),
  source: { kind: 'tool', callId: ToolCallId(callId) },
  toolCallId: ToolCallId(callId),
  content: [{ type: 'text', text: 'ok' }],
})

const turnError = async (options: GenerateOptions, message: string): Promise<string | undefined> => {
  async function* provider(): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', message } } }
  }
  let failure: string | undefined
  for await (const chunk of explainSilentRejections(provider(), options)) {
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') failure = chunk.reason.failure.message
  }
  return failure
}

const request = (input: Partial<GenerateOptions>): GenerateOptions => ({
  provider: 'opencode-go-alex',
  model: 'deepseek-v4.1-flash',
  messages: [user],
  ...input,
})

describe('explainSilentRejections', () => {
  it('names the tool declared twice when the provider rejects without a body', async () => {
    const message = await turnError(request({ tools: [tool('mcp__db__query'), tool('read'), tool('mcp__db__query')] }), '400 status code (no body)')
    expect(message).toBe('400 status code (no body): opencode-go-alex gave no reason; the request declares these tools more than once: mcp__db__query.')
  })

  it('names a tool result whose call is missing from the history', async () => {
    const message = await turnError(
      request({ messages: [user, assistantCalling('call-1'), resultOf('call-1'), resultOf('call-9')] }),
      '400 status code (no body)',
    )
    expect(message).toContain('tool results answer calls no earlier assistant message made: call-9')
  })

  it('reports the request shape and the latest tool update when no known cause is present', async () => {
    const message = await turnError(
      request({
        tools: [tool('read'), tool('mcp__dadabase__query_database')],
        toolHistory: { tools: [tool('read')], updates: [{ messageId: MessageId('update-1'), additions: [tool('mcp__dadabase__query_database')] }] },
      }),
      '400 status code (no body)',
    )
    expect(message).toContain('no known cause found in 1 messages and 2 tools; the latest tool update added mcp__dadabase__query_database')
  })

  it('leaves failures that already carry a reason alone', async () => {
    expect(await turnError(request({ tools: [tool('a'), tool('a')] }), '400 Invalid model')).toBe('400 Invalid model')
  })
})
