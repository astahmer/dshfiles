import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { projectRuntimeDriverHistory } from '../src/runtime-history.ts'

describe('runtime driver history', () => {
  it('keeps ordered user-visible text and indexes tool state without exposing it', async () => {
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId('portable-history'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('private-call'),
      name: 'shell',
      arguments: '{"command":"private"}',
    })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'answer' }],
        source: { provider: 'test', model: 'test' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })

    const history = projectRuntimeDriverHistory(session.snapshotEvents())

    expect(history.messages.map(message => ({ speaker: message.speaker, text: message.parts.join('') })))
      .toEqual([
        { speaker: 'user', text: 'question' },
        { speaker: 'assistant', text: 'answer' },
      ])
    expect(history.omissions).toEqual([
      { fromSeq: 1, throughSeq: 1, reason: 'tool-state', count: 1 },
    ])
    expect(history.omissionIndexComplete).toBe(true)

    await context.fiber.dispose()
  })

  it('bounds replay messages and reports omitted earlier content', async () => {
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId('portable-history-budget'))
    for (let index = 0; index < 81; index += 1) {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `prompt-${index}` }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    }

    const history = projectRuntimeDriverHistory(session.snapshotEvents())

    expect(history.messages).toHaveLength(80)
    expect(history.messages[0]?.parts).toEqual(['prompt-1'])
    expect(history.messages.at(-1)?.parts).toEqual(['prompt-80'])
    expect(history.omissions).toEqual([
      { fromSeq: 0, throughSeq: 0, reason: 'history-budget', count: 1 },
    ])

    await context.fiber.dispose()
  })
})
