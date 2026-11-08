import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { expandAssistantStream } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { AssistantStreamAttempt } from '../src/native/assistant-stream.ts'

const attempt = () =>
  new AssistantStreamAttempt('session-1' as SessionId, 1, () => 1, 1, 1, () => undefined)

const blocks = [{ signature: 'sig-1' }]

const settledChunks: readonly StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'reasoning' },
  { type: 'reasoning-delta', index: 0, text: 'thinking' },
  {
    type: 'block-end',
    index: 0,
    block: { type: 'reasoning', text: 'thinking' },
  },
  { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { id: 'resp-1' }, blocks } },
]

describe('settled attempt stream', () => {
  it('a settled message stores the response envelope once', () => {
    const live = attempt()
    for (const chunk of settledChunks) live.push(chunk)

    const stream = live.settledStream
    const finish = expandAssistantStream(stream).find(entry => entry.chunk.type === 'finish')
    expect(finish?.chunk.type).toBe('finish')
    expect(finish?.chunk.type === 'finish' ? finish.chunk.replayState : undefined).toEqual({ response: { id: 'resp-1' } })

    // The message source keeps the envelope a provider replay needs.
    expect(live.replayState).toEqual({ response: { id: 'resp-1' }, blocks })
    // The unsettled attempt stream keeps the whole envelope.
    const raw = expandAssistantStream(live.stream).find(entry => entry.chunk.type === 'finish')
    expect(raw?.chunk.type === 'finish' ? raw.chunk.replayState : undefined).toEqual({ response: { id: 'resp-1' }, blocks })
  })

  it('leaves a stream without replay metadata alone', () => {
    const live = attempt()
    live.push({ type: 'text-delta', index: 0, text: 'hi' })
    live.push({ type: 'finish', reason: { kind: 'stop' } })
    expect(live.settledStream).toEqual(live.stream)
  })
})
