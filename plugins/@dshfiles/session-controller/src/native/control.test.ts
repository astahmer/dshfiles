import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { ProjectionPatches } from '@dshfiles/session-source-port/projection-patch'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ControlQueue, ProjectionPatchEncoder } from './control.ts'

const projection = (sessionId: string, key: string, value: string) => ({
  type: 'projection' as const,
  sessionId: SessionId(sessionId),
  key,
  value,
  seq: 1,
})

describe('the control queue', () => {
  it('drops the oldest frames instead of buffering every change a slow client missed', async () => {
    const queue = new ControlQueue(() => true)
    for (let index = 0; index < 5_000; index += 1) queue.push(projection(`session-${index}`, 'turn', String(index)), 64)
    queue.end()
    const frames: string[] = []
    for await (const frame of queue.iterate(new AbortController().signal)) {
      if (frame.type === 'projection') frames.push(String(frame.value))
    }
    expect(frames).toHaveLength(4_096)
    // The newest change is still delivered; only the ones nobody read in time are gone.
    expect(frames.at(-1)).toBe('4999')
  })

  it('frees the byte budget of the frames the client already read', async () => {
    const queue = new ControlQueue(() => true)
    const reader = queue.iterate(new AbortController().signal)[Symbol.asyncIterator]()
    const first = projection('a', 'turn', 'first')
    const second = projection('a', 'turn', 'second')
    queue.push(first, 3 * 1024 * 1024)
    expect((await reader.next()).value).toEqual(first)
    queue.push(second, 3 * 1024 * 1024)
    queue.end()
    expect((await reader.next()).value).toEqual(second)
  })

  it('never lets frames a client cannot read evict the ones it can', async () => {
    const queue = new ControlQueue(sessionId => sessionId === 'readable')
    const readable = projection('readable', 'turn', 'kept')
    queue.push(readable, 64)
    for (let index = 0; index < 5_000; index += 1) queue.push(projection('hidden', 'turn', String(index)), 64)
    queue.end()
    const frames: unknown[] = []
    for await (const frame of queue.iterate(new AbortController().signal)) frames.push(frame)
    expect(frames).toEqual([readable])
  })

  it('sends a projection whole once per stream, then only what changed against the value it sent last', () => {
    const encoder = new ProjectionPatchEncoder()
    const turn = (index: number) => ({ turn: index, groups: [{ provider: 'anthropic', model: 'claude-opus', input: index * 1_000, output: index * 37 }] })
    const cost = (turns: number): JsonValue => ({ turn: turn(turns - 1), turns: Array.from({ length: turns }, (_, index) => turn(index)) })
    const frame = (sessionId: string, turns: number) => ({ type: 'projection' as const, sessionId: SessionId(sessionId), key: 'aiAccountsCost', value: cost(turns), seq: turns })
    expect(encoder.encode(frame('a', 30))).toEqual(frame('a', 30))
    expect(encoder.encode(frame('b', 30))).toEqual(frame('b', 30))
    let held = cost(30)
    for (const turns of [31, 32, 32, 35]) {
      const sent = encoder.encode(frame('a', turns))
      if (sent.type !== 'projection-patch') throw new Error(`expected a patch, got ${sent.type}`)
      expect(JSON.stringify(sent).length).toBeLessThan(JSON.stringify(frame('a', turns)).length / 5)
      held = ProjectionPatches.apply(held, ProjectionPatches.decode(JSON.parse(JSON.stringify(sent.patch))))
      expect(held).toEqual(cost(turns))
      expect(sent.seq).toBe(turns)
    }
    expect(encoder.encode({ ...frame('a', 1), value: 'scalar' }).type).toBe('projection')
  })
})
