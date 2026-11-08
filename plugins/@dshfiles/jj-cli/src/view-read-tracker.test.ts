import { describe, expect, it } from '@effect/vitest'
import { Cache, Effect } from 'effect'
import { trackViewRead, viewReadSignature, type TrackedViewReads, type ViewReadKey } from './view-read-tracker.ts'

const STORE = '/repo/.jj/repo/op_heads/heads'
const OTHER_STORE = '/other/.jj/repo/op_heads/heads'

const read = (heads: string, args: readonly string[]): ViewReadKey => ({ operationHeads: heads, command: { args, cwd: '/repo' } })

const tracked = (reads: readonly { readonly store: string; readonly key: ViewReadKey }[]): TrackedViewReads =>
  reads.reduce<TrackedViewReads>(
    (current, entry) => trackViewRead(current, { store: entry.store, heads: entry.key.operationHeads, key: entry.key }).next,
    new Map(),
  )

describe('view-read tracking', () => {
  it('keeps every read at one head without invalidating anything', () => {
    const first = trackViewRead(new Map(), { store: STORE, heads: 'a', key: read('a', ['--ignore-working-copy', 'log']) })
    expect(first.invalidated).toHaveLength(0)
    const second = trackViewRead(first.next, { store: STORE, heads: 'a', key: read('a', ['--ignore-working-copy', 'root']) })
    expect(second.invalidated).toHaveLength(0)
    expect(second.next.get(STORE)?.keys.size).toBe(2)
  })

  it('invalidates exactly the reads of the store whose head moved', () => {
    const current = tracked([
      { store: STORE, key: read('a', ['--ignore-working-copy', 'log']) },
      { store: STORE, key: read('a', ['--ignore-working-copy', 'root']) },
      { store: OTHER_STORE, key: read('a', ['--ignore-working-copy', 'log']) },
    ])
    const moved = trackViewRead(current, { store: STORE, heads: 'b', key: read('b', ['--ignore-working-copy', 'log']) })
    expect(moved.invalidated.map(viewReadSignature).sort()).toEqual(
      [read('a', ['--ignore-working-copy', 'log']), read('a', ['--ignore-working-copy', 'root'])].map(viewReadSignature).sort(),
    )
    expect(moved.next.get(STORE)?.keys.size).toBe(1)
    expect(moved.next.get(OTHER_STORE)?.keys.size).toBe(1)
  })

  it('drops the previous head’s reads from the store it tracked, not from every store', () => {
    const current = tracked([{ store: OTHER_STORE, key: read('a', ['--ignore-working-copy', 'log']) }])
    const moved = trackViewRead(current, { store: STORE, heads: 'b', key: read('b', ['--ignore-working-copy', 'log']) })
    expect(moved.invalidated).toHaveLength(0)
    expect([...moved.next.keys()].sort()).toEqual([OTHER_STORE, STORE].sort())
  })

  it('replaces a repeated read at the same head instead of accumulating it', () => {
    const first = trackViewRead(new Map(), { store: STORE, heads: 'a', key: read('a', ['--ignore-working-copy', 'log']) })
    const repeated = trackViewRead(first.next, { store: STORE, heads: 'a', key: read('a', ['--ignore-working-copy', 'log']) })
    expect(repeated.invalidated).toHaveLength(0)
    expect(repeated.next.get(STORE)?.keys.size).toBe(1)
  })

  it.effect('retains one head’s entries, not every head the store ever had', () =>
    Effect.gen(function* () {
      const cache = yield* Cache.make<string, number, never, never>({ lookup: key => Effect.succeed(key.length), capacity: 512 })
      const invalidateAll = (invalidated: readonly ViewReadKey[]) =>
        Effect.forEach(invalidated, key => Cache.invalidate(cache, viewReadSignature(key)), { discard: true })
      let state: TrackedViewReads = new Map()
      for (let heads = 0; heads < 25; heads += 1) {
        const key = read(`head-${heads}`, ['--ignore-working-copy', 'log'])
        const trackedRead = trackViewRead(state, { store: STORE, heads: key.operationHeads, key })
        state = trackedRead.next
        yield* invalidateAll(trackedRead.invalidated)
        yield* Cache.get(cache, viewReadSignature(key))
      }
      expect(yield* Cache.size(cache)).toBe(1)
    }),
  )
})
