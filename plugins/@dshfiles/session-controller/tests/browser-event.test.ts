import { describe, expect, it } from 'vitest'
import { BrowserEvent } from '../src/browser-event.ts'

const replayState = { response: { id: 'msg_1', stopReason: 'toolUse' }, blocks: [{ signature: 'x'.repeat(4096) }] }

const assistantMessage = () =>
  Object.freeze({
    seq: 7,
    type: 'assistant/message',
    time: 1,
    data: Object.freeze({
      turn: 1,
      step: 2,
      message: Object.freeze({ id: 'm1', role: 'assistant', source: Object.freeze({ kind: 'model', provider: 'anthropic', model: 'haiku', replayState }) }),
      stream: Object.freeze([
        Object.freeze({ type: 'chunk', time: 2, chunk: Object.freeze({ type: 'text', text: 'hi' }) }),
        Object.freeze({ type: 'chunk', time: 3, chunk: Object.freeze({ type: 'finish', replayState }) }),
      ]),
    }),
  })

describe('BrowserEvent', () => {
  it('drops provider replay state from assistant events and keeps everything else', () => {
    const event = assistantMessage()
    const slimmed = BrowserEvent.of(event)

    expect(slimmed).toMatchInlineSnapshot(`
      {
        "data": {
          "message": {
            "id": "m1",
            "role": "assistant",
            "source": {
              "kind": "model",
              "model": "haiku",
              "provider": "anthropic",
              "replayState": {
                "response": {
                  "id": "msg_1",
                  "stopReason": "toolUse",
                },
              },
            },
          },
          "step": 2,
          "stream": [
            {
              "chunk": {
                "text": "hi",
                "type": "text",
              },
              "time": 2,
              "type": "chunk",
            },
            {
              "chunk": {
                "replayState": {
                  "response": {
                    "id": "msg_1",
                    "stopReason": "toolUse",
                  },
                },
                "type": "finish",
              },
              "time": 3,
              "type": "chunk",
            },
          ],
          "turn": 1,
        },
        "seq": 7,
        "time": 1,
        "type": "assistant/message",
      }
    `)
    expect(JSON.stringify(event)).toContain('signature')
  })

  it('returns events without replay blocks unchanged', () => {
    const user = { seq: 3, type: 'user/message', time: 1, data: { message: { role: 'user', source: { replayState } } } }
    expect(BrowserEvent.of(user)).toBe(user)

    const slimmed = BrowserEvent.of(assistantMessage())
    expect(BrowserEvent.of(slimmed)).toBe(slimmed)
  })
})
