import { assistantStreamFirstTokenTime, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
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
        Object.freeze({ type: 'chunk', time: 2, chunk: Object.freeze({ type: 'text-delta', index: 0, text: 'hi' }) }),
        Object.freeze({ type: 'chunk', time: 3, chunk: Object.freeze({ type: 'finish', replayState }) }),
      ]),
    }),
  })

describe('BrowserEvent', () => {
  it('drops provider replay state and the settled stream past its first token, and keeps everything else', () => {
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
                "index": 0,
                "text": "hi",
                "type": "text-delta",
              },
              "time": 2,
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

  const settled = (stream: readonly AssistantStreamRecord[]) =>
    Object.freeze({ seq: 9, type: 'assistant/message', time: 1, data: Object.freeze({ turn: 1, step: 1, message: { id: 'm', role: 'assistant' }, stream }) })
  const streamOf = (event: { readonly data: unknown }): readonly AssistantStreamRecord[] =>
    // SAFETY: test events are built from AssistantStreamRecord arrays above.
    (event.data as { readonly stream: readonly AssistantStreamRecord[] }).stream

  it('keeps the first-token time Trajectory reads, through every record shape', () => {
    const cases: readonly (readonly AssistantStreamRecord[])[] = [
      [
        { type: 'chunk', time: 10, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
        { type: 'reasoning-chunks', time0: 20, index: 0, dt: [5, 7, 9], texts: ['', '', 'think', 'more'] },
        { type: 'text-chunks', time0: 60, index: 1, dt: [1], texts: ['a', 'b'] },
        { type: 'chunk', time: 70, chunk: { type: 'block-end', index: 1, block: { type: 'text', text: 'ab' } } },
      ],
      [{ type: 'tool-call-chunks', time0: 30, index: 0, dt: [2, 3], id: ToolCallId('call_1'), name: 'bash', args: ['{"a"', ':1', '}'] }],
      [{ type: 'tool-call-chunks', time0: 30, index: 0, dt: [2, 3], id: ToolCallId('call_1'), args: ['', '{"a"', '}'] }],
      [{ type: 'chunk', time: 40, chunk: { type: 'block-start', index: 0, blockType: 'text' } }],
    ]
    for (const stream of cases) {
      const slimmed = BrowserEvent.of(settled(stream))
      expect(assistantStreamFirstTokenTime(streamOf(slimmed))).toBe(assistantStreamFirstTokenTime(stream))
      expect(streamOf(slimmed).length).toBeLessThanOrEqual(1)
    }
    expect(streamOf(BrowserEvent.of(settled(cases[0] ?? [])))).toEqual([
      { type: 'reasoning-chunks', time0: 20, index: 0, dt: [5, 7], texts: ['', '', 'think'] },
    ])
  })

  it('keeps a stream that is already its own first-token record', () => {
    const event = settled([{ type: 'text-chunks', time0: 60, index: 1, dt: [], texts: ['a'] }])
    expect(BrowserEvent.of(event)).toBe(event)
  })
})
