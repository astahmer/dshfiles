import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { MirroredSessions } from '../../src/mirrored-sessions.ts'
import type { SessionFollowFrame } from '../../src/native/types.ts'

setFlagsFromString('--expose-gc')
// SAFETY: --expose-gc above makes a fresh context's global `gc` the full collector.
const collect = runInNewContext('gc') as () => void

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

it('keeps no delivered frame alive while a follow waits for the next one', async () => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  const mirrored = new MirroredSessions(ctx)
  let delivered: WeakRef<object> | undefined
  const local = async function* (): AsyncIterable<SessionFollowFrame> {
    // SAFETY: the relay forwards frames without reading them.
    let snapshot: SessionFollowFrame | undefined = {
      type: 'snapshot',
      records: Array.from({ length: 1_000 }, (_, seq) => ({ seq })),
    } as never as SessionFollowFrame
    delivered = new WeakRef(snapshot)
    yield snapshot
    snapshot = undefined
    await new Promise<never>(() => undefined)
  }
  const controller = new AbortController()
  const frames = mirrored
    .follow({ address: { kind: 'session', sessionId: SessionId('session-local') } } as never, controller.signal, local)
    [Symbol.asyncIterator]()
  await frames.next()
  const waiting = frames.next()
  await new Promise(resolve => setImmediate(resolve))
  collect()
  expect(delivered?.deref()).toBeUndefined()
  void waiting
})
