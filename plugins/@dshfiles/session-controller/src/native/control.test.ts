import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { ControlQueue } from './control.ts'

const projection = (sessionId: string, key: string, value: string) => ({
  type: 'projection' as const,
  sessionId: SessionId(sessionId),
  key,
  value,
  seq: 1,
})

describe('the control queue', () => {
  it('drops the oldest frames instead of buffering every change a slow client missed', async () => {
    const queue = new ControlQueue()
    for (let index = 0; index < 5_000; index += 1) queue.push(projection(`session-${index}`, 'turn', String(index)))
    queue.end()
    const frames: string[] = []
    for await (const frame of queue.iterate(new AbortController().signal)) {
      if (frame.type === 'projection') frames.push(String(frame.value))
    }
    expect(frames).toHaveLength(4_096)
    // The newest change is still delivered; only the ones nobody read in time are gone.
    expect(frames.at(-1)).toBe('4999')
  })
})
