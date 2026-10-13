import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'

import type { ThreadHeader } from '../digest.ts'
import type { SessionLog } from '../runtime.ts'

/** A JSON value as the session log stores it. */
type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** A thread built with DSH's own message constructors, in the shape the committed session log has. */
export const createThread = (header: ThreadHeader, start = Date.now() - 3_600_000) => {
  let seq = 0
  let time = start
  let turn = 0
  let call = 0
  const events: SessionEvent[] = []
  const next = <Event extends SessionEvent>(build: (base: { readonly seq: ReturnType<typeof SessionSeq>; readonly time: number }) => Event): Event => {
    const event = build({ seq: SessionSeq(seq++), time: (time += 1_000) })
    events.push(event)
    return event
  }
  /** Event kinds whose payload types live in modules DSH does not export are written as the log stores them. */
  const raw = (type: string, data: JsonValue): void => {
    const event = { type, seq: SessionSeq(seq++), time: (time += 1_000), data }
    // SAFETY: `type` and `data` are the log shapes of DSH event kinds the fixture writes (turn/end, todo/write, session/title, injected context).
    events.push(event as SessionEvent)
  }
  const thread = {
    header,
    events,
    turnStart: () => next(base => ({ ...base, type: 'turn/start', data: { turn: ++turn } })),
    turnEnd: () => raw('turn/end', { turn, reason: { kind: 'completed' } }),
    user: (text: string) =>
      next(base => ({
        ...base,
        type: 'user/message',
        data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
        surfaceOp: 'append',
      })),
    injected: (text: string) =>
      raw('user/message', { id: `context-${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'runtime-context' } }),
    assistant: (text: string) =>
      next(base => ({
        ...base,
        type: 'assistant/message',
        data: {
          turn,
          step: 1,
          message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'fake', model: 'fake-model' } }),
          stream: [],
        },
        surfaceOp: 'append',
      })),
    tool: (name: string, args: JsonValue, result: string) => {
      const callId = `call-${++call}`
      next(base => ({ ...base, type: 'tool/call', data: { turn, step: 1, callId: ToolCallId(callId), name, arguments: JSON.stringify(args) } }))
      next(base => ({
        ...base,
        type: 'tool/result',
        data: { turn, step: 1, message: createToolResultMessage({ callId: ToolCallId(callId), content: [{ type: 'text', text: result }], isError: false }) },
        surfaceOp: 'append',
      }))
    },
    todos: (todos: readonly { readonly content: string; readonly status: string }[]) => raw('todo/write', { todos }),
    title: (title: string) => raw('session/title', { title }),
    /** One completed turn: the user's prompt, optional tool calls, the assistant's answer. */
    exchange: (prompt: string, answer: string, tools: readonly (readonly [string, JsonValue, string])[] = []) => {
      thread.turnStart()
      thread.user(prompt)
      for (const [name, args, result] of tools) thread.tool(name, args, result)
      thread.assistant(answer)
      thread.turnEnd()
    },
    log: (): SessionLog => ({ header, inheritedEventCount: 0, events: [...events] }),
  }
  return thread
}
