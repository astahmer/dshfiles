import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import { ProjectionPatches } from '@dshfiles/session-source-port/projection-patch'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ControlQueue, ProjectionPatchEncoder, SessionControlController } from './control.ts'

const projection = (sessionId: string, key: string, value: string) => ({
  type: 'projection' as const,
  sessionId: SessionId(sessionId),
  seq: 1,
  changes: [{ key, val: value }],
})

describe('the control queue', () => {
  it('drops the oldest frames instead of buffering every change a slow client missed', async () => {
    const queue = new ControlQueue(() => true)
    for (let index = 0; index < 5_000; index += 1) queue.push(projection(`session-${index}`, 'turn', String(index)), 64)
    queue.end()
    const frames: string[] = []
    for await (const frame of queue.iterate(new AbortController().signal)) {
      if (frame.type === 'projection') frames.push(String(frame.changes[0]?.val))
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
    const frame = (sessionId: string, turns: number) => ({ type: 'projection' as const, sessionId: SessionId(sessionId), seq: turns, changes: [{ key: 'aiAccountsCost', val: cost(turns) }] })
    expect(encoder.encode(frame('a', 30))).toEqual(frame('a', 30))
    expect(encoder.encode(frame('b', 30))).toEqual(frame('b', 30))
    let held = cost(30)
    for (const turns of [31, 32, 32, 35]) {
      const sent = encoder.encode(frame('a', turns))
      if (sent.type !== 'projection-patch') throw new Error(`expected a patch, got ${sent.type}`)
      expect(JSON.stringify(sent).length).toBeLessThan(JSON.stringify(frame('a', turns)).length / 5)
      const [change] = sent.changes
      if (change === undefined || !('patch' in change)) throw new Error('expected a patched change')
      held = ProjectionPatches.apply(held, ProjectionPatches.decode(JSON.parse(JSON.stringify(change.patch))))
      expect(held).toEqual(cost(turns))
      expect(sent.seq).toBe(turns)
    }
    expect(encoder.encode({ ...frame('a', 1), changes: [{ key: 'aiAccountsCost', val: 'scalar' }] }).type).toBe('projection')
  })

  it('patches only the changed cells of one event and sends the others whole', () => {
    const encoder = new ProjectionPatchEncoder()
    const list = (length: number): JsonValue => Array.from({ length }, (_, index) => ({ index, label: `item-${index}` }))
    const id = SessionId('a')
    encoder.encode({ type: 'projection', sessionId: id, seq: 1, changes: [{ key: 'turnOutline', val: list(40) }] })
    const sent = encoder.encode({ type: 'projection', sessionId: id, seq: 2, changes: [{ key: 'title', val: 'New' }, { key: 'turnOutline', val: list(41) }] })
    if (sent.type !== 'projection-patch') throw new Error(`expected a patch, got ${sent.type}`)
    expect(sent.changes.map(change => [change.key, 'patch' in change])).toEqual([['title', false], ['turnOutline', true]])
  })
})

describe('the control controller', () => {
  it('does not encode a projection change while no control stream is open', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    try {
      const controller = new SessionControlController(ctx)
      // JSON.stringify throws on a cycle, so encoding at all fails the publish.
      const cyclic: Record<string, JsonValue> = {}
      cyclic['self'] = cyclic
      expect(() => controller.publishMirrored({ sessionId: SessionId('idle'), key: 'title', value: cyclic, seq: 1 })).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
