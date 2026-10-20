import { describe, expect, test } from 'vitest'
import { reduceTranscript } from '../src/transcript.js'

const event = (seq: number, type: string, data: unknown) => ({ type: 'event', event: { type, seq, time: seq, data } })

// Shapes recorded from a real DSH 0.2.0-rc.2 session on the Raspberry Pi scratch runtime.
const records = [
  event(3, 'turn/start', { turn: 1 }),
  event(8, 'user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Run hostname and uname -m' }] }),
  event(9, 'user/message', { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'Current runtime context.' }] }),
  event(10, 'request/header', { header: { config: { provider: 'opencode-go_work', model: 'longcat-2.0' } } }),
  event(15, 'assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"command":"hostname"}' },
      ],
    },
  }),
  event(16, 'tool/call', { callId: 'call-1', name: 'bash', arguments: '{"command":"hostname","description":"Get the hostname"}' }),
  event(17, 'tool/result', { message: { role: 'tool', toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: 'raspberrypi\n' }] } }),
  event(22, 'session/title', { title: 'Get hostname and architecture' }),
  event(23, 'assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'x' },
        { type: 'text', text: 'HOST=raspberrypi ARCH=aarch64' },
      ],
    },
  }),
  event(25, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
]

describe('remote transcript reduction', () => {
  test('keeps the user prompt, tool calls with their output and the answer; drops runtime context and reasoning', () => {
    expect(reduceTranscript(records)).toEqual({
      running: false,
      title: 'Get hostname and architecture',
      model: { provider: 'opencode-go_work', model: 'longcat-2.0' },
      entries: [
        { seq: 8, kind: 'user', text: 'Run hostname and uname -m' },
        { seq: 16, kind: 'tool', text: 'bash: hostname\nraspberrypi' },
        { seq: 23, kind: 'assistant', text: 'HOST=raspberrypi ARCH=aarch64' },
      ],
    })
  })

  test('reports a turn in progress and a turn that did not complete', () => {
    expect(reduceTranscript(records.slice(0, 6)).running).toBe(true)
    const cancelled = reduceTranscript([...records.slice(0, 2), event(30, 'turn/end', { reason: { kind: 'cancelled' } })])
    expect(cancelled.running).toBe(false)
    expect(cancelled.entries.at(-1)).toEqual({ seq: 30, kind: 'status', text: 'Turn ended: cancelled' })
  })
})

const toolCall = (seq: number, name: string) => event(seq, 'tool/call', { callId: 'call-1', name, arguments: '{}' })
const toolResult = (seq: number) =>
  event(seq, 'tool/result', { message: { role: 'tool', toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: 'done' }] } })

describe('remote transcript pending detection', () => {
  test('an open ask_user_question call while the turn runs is a question, including an MCP-prefixed name', () => {
    expect(reduceTranscript([event(1, 'turn/start', { turn: 1 }), toolCall(2, 'ask_user_question')]).waiting).toEqual({
      kind: 'question',
      tool: 'ask_user_question',
      since: 2,
    })
    expect(reduceTranscript([event(1, 'turn/start', { turn: 1 }), toolCall(2, 'mcp__dsh__ask_user_question')]).waiting).toEqual({
      kind: 'question',
      tool: 'mcp__dsh__ask_user_question',
      since: 2,
    })
    expect(reduceTranscript([event(1, 'turn/start', { turn: 1 }), toolCall(2, 'ask_parent_question')]).waiting?.kind).toBe('question')
  })

  test('the question result clears the wait', () => {
    expect(reduceTranscript([event(1, 'turn/start', { turn: 1 }), toolCall(2, 'ask_user_question'), toolResult(3)]).waiting).toBeUndefined()
  })

  test('an open bash call is a tool wait', () => {
    expect(reduceTranscript([event(1, 'turn/start', { turn: 1 }), toolCall(2, 'bash')]).waiting).toEqual({ kind: 'tool', tool: 'bash', since: 2 })
  })

  test('a turn end clears the wait', () => {
    expect(
      reduceTranscript([event(1, 'turn/start', { turn: 1 }), toolCall(2, 'ask_user_question'), event(3, 'turn/end', { reason: { kind: 'completed' } })]).waiting,
    ).toBeUndefined()
  })
})
