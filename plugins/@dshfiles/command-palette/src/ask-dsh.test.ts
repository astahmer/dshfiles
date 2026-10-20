import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { askDsh, type AskDshPorts } from './ask-dsh.js'

const sessionId = SessionId('session-ask-one')

const ports = (): { readonly calls: string[]; readonly ports: AskDshPorts<string> } => {
  const calls: string[] = []
  return {
    calls,
    ports: {
      createSession: vi.fn(async () => {
        calls.push('create')
        return sessionId
      }),
      prompt: vi.fn(async (input: { readonly sessionId: SessionId; readonly question: string }) => {
        calls.push(`prompt:${input.sessionId}:${input.question}`)
      }),
      openSession: vi.fn(() => {
        calls.push('open')
      }),
    },
  }
}

describe('askDsh', () => {
  it('creates one fresh session, sends the trimmed question, then opens the thread', async () => {
    const { calls, ports: fake } = ports()
    const created = await askDsh({ question: '  how do I rebind a shortcut?  ', target: {}, ports: fake })

    expect(created).toBe(sessionId)
    expect(fake.createSession).toHaveBeenCalledWith({})
    expect(fake.prompt).toHaveBeenCalledWith({ sessionId, question: 'how do I rebind a shortcut?' })
    expect(fake.openSession).toHaveBeenCalledWith(sessionId)
    expect(calls).toEqual(['create', `prompt:${sessionId}:how do I rebind a shortcut?`, 'open'])
  })

  it('keeps the current project so the ask thread is grouped with its siblings', async () => {
    const { ports: fake } = ports()
    const workspaceId = 'workspace-one'
    await askDsh({ question: 'what does the backlog plugin do?', target: { workspaceId }, ports: fake })

    expect(fake.createSession).toHaveBeenCalledWith({ workspaceId })
  })

  it('refuses an empty question before creating a session', async () => {
    const { ports: fake } = ports()
    await expect(askDsh({ question: '   \n ', target: {}, ports: fake })).rejects.toThrow('Ask DSH needs a question.')
    expect(fake.createSession).not.toHaveBeenCalled()
  })

  it('does not open a thread when the Host refuses the question', async () => {
    const { ports: fake } = ports()
    fake.prompt = vi.fn(async () => {
      throw new Error('no model is available')
    })
    await expect(askDsh({ question: 'hello?', target: {}, ports: fake })).rejects.toThrow('no model is available')
    expect(fake.openSession).not.toHaveBeenCalled()
  })
})
