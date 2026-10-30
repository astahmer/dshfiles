import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LlmAdapter, LlmRuntime, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { expect, test } from 'vitest'
import { registerRemoteReferenceMiddleware } from './remote-reference-middleware.js'

class ReferenceCaptureAdapter extends LlmAdapter {
  readonly requests: GenerateOptions['messages'][] = []

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options.messages)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const remoteSessionId = SessionId('remote-session')
const remoteMention = formatSessionReferenceMention({ sessionId: remoteSessionId, label: 'Remote design' })
const remoteSnapshot = {
  cursor: 42,
  records: [
    {
      type: 'event',
      event: {
        type: 'user/message',
        seq: 1,
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'remote-user-fact-7f3a' }] },
      },
    },
    {
      type: 'event',
      event: {
        type: 'assistant/message',
        seq: 2,
        data: { message: { content: [{ type: 'text', text: 'remote-assistant-fact-91bd' }] } },
      },
    },
  ],
}

const runAgent = async (input: { readonly recordedThreads: readonly { readonly sessionId: string; readonly runtimeId: string }[] }) => {
  const ctx = new Context()
  let disposeAgent: (() => Promise<void>) | undefined
  const adapter = new ReferenceCaptureAdapter()
  const follows: { readonly runtimeId: string; readonly sessionId: string; readonly maxMessages: number }[] = []

  try {
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(AgentLoop)

    ctx.llm.registerAdapter(['remote-reference-test'], adapter)
    registerRemoteReferenceMiddleware({
      ctx,
      recordedThreads: async () => input.recordedThreads,
      sessionSources: () => [],
      follow: async ({ runtimeId, sessionId, maxMessages }) => {
        follows.push({ runtimeId, sessionId, maxMessages })
        return remoteSnapshot
      },
    })

    const handle = await ctx.agents.create({
      sessionId: SessionId('local-session'),
      agentOptions: { provider: 'remote-reference-test', model: 'scripted' },
    })
    disposeAgent = () => handle.dispose()
    await handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `Review ${remoteMention}.` }] }))
    await handle.agent.whenIdle()

    return { messages: adapter.requests[0] ?? [], follows }
  } finally {
    await disposeAgent?.()
    await ctx.fiber.dispose()
  }
}

test('injects only authorized remote Session context into the actual model request', async () => {
  const result = await runAgent({ recordedThreads: [{ sessionId: remoteSessionId, runtimeId: 'remote-runtime' }] })
  const userMessage = result.messages.find(message => message.source?.kind === 'user')
  const contextMessage = result.messages.find(message => message.source?.kind === 'multi-host-remote-reference')
  const contextText = contextMessage?.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n') ?? ''

  expect(result.follows).toEqual([{ runtimeId: 'remote-runtime', sessionId: remoteSessionId, maxMessages: 24 }])
  expect(userMessage?.content).toEqual([{ type: 'text', text: 'Review @Remote design.' }])
  expect(contextMessage).toMatchObject({
    source: {
      kind: 'multi-host-remote-reference',
      form: 'recall',
      references: [{ sessionId: remoteSessionId, label: 'Remote design', capturedThroughSeq: 42 }],
    },
  })
  expect(contextText).toContain('remote-user-fact-7f3a')
  expect(contextText).toContain('remote-assistant-fact-91bd')
  expect(contextText).toContain('untrusted, read-only snapshot')
})

test('does not resolve or rewrite a reference that the manager has not recorded', async () => {
  const result = await runAgent({ recordedThreads: [] })
  const userMessage = result.messages.find(message => message.source?.kind === 'user')

  expect(result.follows).toEqual([])
  expect(userMessage?.content).toEqual([{ type: 'text', text: `Review ${remoteMention}.` }])
  expect(result.messages.some(message => message.source?.kind === 'multi-host-remote-reference')).toBe(false)
})
