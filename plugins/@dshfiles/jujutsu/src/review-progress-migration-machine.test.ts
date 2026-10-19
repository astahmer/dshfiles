import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReviewProgressSnapshot, ReviewProgressToggle } from './review-progress-api.js'
import { ReviewProgressModel, type ReviewMark, type ReviewStore } from './review-progress.js'
import { latestReviewProgressSnapshot } from './review-progress-queries.js'
import { ReviewProgressMigration, type ReviewProgressMigrationClient } from './review-progress-migration-machine.js'

const reviewedAt = '2026-10-19T00:00:00.000Z'
const repositoryRoot = '/workspace/project'
const commitId = 'a'.repeat(40)

afterEach(() => ReviewProgressMigration.stop())

const mark = (path: string, contentDigest: string): ReviewMark => ({ repositoryRoot, commitId, path, contentDigest, reviewedAt })

const store = (...marks: readonly ReviewMark[]): ReviewStore => ({ schemaVersion: 1, marks: [...marks] })

const snapshot = (revision: number, value: ReviewStore): ReviewProgressSnapshot => ({ revision, store: value })

const requireDigest = (value: string | null): string => {
  if (value === null) throw new Error('The migration test only uses digest-backed files.')
  return value
}

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => {}
  const promise = new Promise<Value>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

interface MigrationClientHarness {
  readonly client: ReviewProgressMigrationClient
  readonly calls: ReviewProgressToggle[]
  readonly completed: ReviewProgressSnapshot[]
  readonly current: () => ReviewProgressSnapshot
  readonly advance: (next: ReviewProgressSnapshot) => void
}

const createMigrationClient = (
  initial: ReviewProgressSnapshot,
  toggle?: (current: ReviewProgressSnapshot, input: ReviewProgressToggle, options: { readonly signal: AbortSignal }) => Promise<ReviewProgressSnapshot>,
): MigrationClientHarness => {
  let current = initial
  const calls: ReviewProgressToggle[] = []
  const completed: ReviewProgressSnapshot[] = []

  const client: ReviewProgressMigrationClient = {
    toggle: async (input, options) => {
      calls.push(input)
      const next =
        toggle === undefined
          ? snapshot(
              current.revision + 1,
              ReviewProgressModel.toggle(
                current.store,
                {
                  repositoryRoot: input.repositoryRoot,
                  commitId: input.commitId,
                  path: input.file.path,
                  contentDigest: requireDigest(input.file.contentDigest),
                  reviewedAt,
                },
                input.reviewed,
              ),
            )
          : await toggle(current, input, options)
      current = latestReviewProgressSnapshot(current, next)
      return current
    },
    adoptSnapshot: incoming => {
      current = latestReviewProgressSnapshot(current, incoming)
      return current
    },
    completeMigration: incoming => {
      current = latestReviewProgressSnapshot(current, incoming)
      completed.push(current)
    },
  }

  return { client, calls, completed, current: () => current, advance: next => (current = next) }
}

describe('ReviewProgressMigration.machine', () => {
  it('imports only marks missing from the Host and commits the completed fallback mirror', async () => {
    const existing = mark('src/existing.ts', 'b'.repeat(64))
    const missing = mark('src/missing.ts', 'c'.repeat(64))
    const initial = snapshot(10, store(existing))
    const harness = createMigrationClient(initial)
    const actor = createActor(ReviewProgressMigration.machine, { input: { client: harness.client } }).start()

    actor.send({ type: 'host.snapshot', snapshot: initial, localStore: store(existing, missing), migrationDone: false })
    await waitFor(actor, current => current.matches('complete'))

    expect(harness.calls.map(toggle => toggle.file.path)).toEqual(['src/missing.ts'])
    expect(harness.completed[0]?.store.marks.map(item => item.path)).toEqual(['src/existing.ts', 'src/missing.ts'])
    actor.stop()
  })

  it('does not replay fallback marks after the migration marker is set', async () => {
    const hostMark = mark('src/host.ts', 'd'.repeat(64))
    const fallbackMark = mark('src/fallback.ts', 'e'.repeat(64))
    const initial = snapshot(20, store(hostMark))
    const harness = createMigrationClient(initial)
    const actor = createActor(ReviewProgressMigration.machine, { input: { client: harness.client } }).start()

    actor.send({ type: 'host.snapshot', snapshot: initial, localStore: store(fallbackMark), migrationDone: true })
    await waitFor(actor, current => current.matches('complete'))

    expect(harness.calls).toEqual([])
    expect(harness.completed[0]).toEqual(initial)
    actor.stop()
  })

  it('keeps fallback on partial failure and retries only remaining marks after a newer Host snapshot', async () => {
    const first = mark('src/first.ts', 'f'.repeat(64))
    const second = mark('src/second.ts', '1'.repeat(64))
    let failSecond = true
    const initial = snapshot(30, store())
    const harness = createMigrationClient(initial, async (current, input) => {
      if (input.file.path === 'src/second.ts' && failSecond) {
        failSecond = false
        throw new Error('temporary failure')
      }
      return snapshot(
        current.revision + 1,
        ReviewProgressModel.toggle(
          current.store,
          {
            repositoryRoot: input.repositoryRoot,
            commitId: input.commitId,
            path: input.file.path,
            contentDigest: requireDigest(input.file.contentDigest),
            reviewedAt,
          },
          input.reviewed,
        ),
      )
    })
    const localStore = store(first, second)
    const actor = createActor(ReviewProgressMigration.machine, { input: { client: harness.client } }).start()

    actor.send({ type: 'host.snapshot', snapshot: initial, localStore, migrationDone: false })
    await waitFor(actor, current => current.matches('failed'))
    expect(harness.completed).toEqual([])
    expect(harness.current().store.marks.map(item => item.path)).toEqual(['src/first.ts'])

    actor.send({ type: 'host.snapshot', snapshot: harness.current(), localStore, migrationDone: false })
    expect(actor.getSnapshot().matches('failed')).toBe(true)
    expect(harness.calls.map(toggle => toggle.file.path)).toEqual(['src/first.ts', 'src/second.ts'])

    harness.advance(snapshot(harness.current().revision + 1, harness.current().store))
    actor.send({ type: 'host.snapshot', snapshot: harness.current(), localStore, migrationDone: false })
    await waitFor(actor, current => current.matches('complete'))

    expect(harness.calls.map(toggle => toggle.file.path)).toEqual(['src/first.ts', 'src/second.ts', 'src/second.ts'])
    expect(harness.completed[0]?.store.marks.map(item => item.path)).toEqual(['src/first.ts', 'src/second.ts'])
    actor.stop()
  })

  it('aborts an in-flight Host toggle when the migration actor stops', async () => {
    const pending = deferred<ReviewProgressSnapshot>()
    const initial = snapshot(40, store())
    let signal: AbortSignal | undefined
    const harness = createMigrationClient(initial, (_current, _input, options) => {
      signal = options.signal
      return pending.promise
    })
    const actor = createActor(ReviewProgressMigration.machine, { input: { client: harness.client } }).start()

    actor.send({ type: 'host.snapshot', snapshot: initial, localStore: store(mark('src/pending.ts', '2'.repeat(64))), migrationDone: false })
    await waitFor(actor, current => current.matches('migrating'))
    actor.stop()

    expect(signal?.aborted).toBe(true)
    pending.resolve(snapshot(41, store(mark('src/pending.ts', '2'.repeat(64)))))
    await pending.promise
    await Promise.resolve()
    expect(harness.completed).toEqual([])
  })

  it('shares one migration actor across mounted panel surfaces', async () => {
    const pendingMark = mark('src/shared.ts', '4'.repeat(64))
    const initial = snapshot(45, store())
    const localStore = store(pendingMark)
    const first = createMigrationClient(initial)
    const second = createMigrationClient(initial)
    const firstActor = ReviewProgressMigration.dispatch({ client: first.client, snapshot: initial, localStore, migrationDone: false })
    const secondActor = ReviewProgressMigration.dispatch({ client: second.client, snapshot: initial, localStore, migrationDone: false })

    expect(secondActor).toBe(firstActor)
    await waitFor(firstActor, current => current.matches('complete'))

    expect(first.calls.map(toggle => toggle.file.path)).toEqual(['src/shared.ts'])
    expect(second.calls).toEqual([])
  })

  it('mirrors later Host snapshots after migration completes', async () => {
    const existing = mark('src/existing.ts', '5'.repeat(64))
    const later = mark('src/later.ts', '6'.repeat(64))
    const initial = snapshot(55, store(existing))
    const harness = createMigrationClient(initial)
    const localStore = store(existing)
    const actor = ReviewProgressMigration.dispatch({ client: harness.client, snapshot: initial, localStore, migrationDone: false })

    await waitFor(actor, current => current.matches('complete'))
    ReviewProgressMigration.dispatch({
      client: harness.client,
      snapshot: snapshot(56, store(existing, later)),
      localStore,
      migrationDone: true,
    })

    expect(harness.completed[1]?.store.marks.map(item => item.path)).toContain('src/later.ts')
  })

  it('cancels the shared migration only after the last panel releases it', async () => {
    const pending = deferred<ReviewProgressSnapshot>()
    const initial = snapshot(57, store())
    let signal: AbortSignal | undefined
    const harness = createMigrationClient(initial, (_current, _input, options) => {
      signal = options.signal
      return pending.promise
    })
    const releaseFirst = ReviewProgressMigration.retain()
    const releaseSecond = ReviewProgressMigration.retain()
    const actor = ReviewProgressMigration.dispatch({
      client: harness.client,
      snapshot: initial,
      localStore: store(mark('src/shared-pending.ts', '7'.repeat(64))),
      migrationDone: false,
    })
    await waitFor(actor, current => current.matches('migrating'))

    releaseFirst()
    expect(signal?.aborted).toBe(false)
    releaseSecond()
    expect(signal?.aborted).toBe(true)
    pending.resolve(snapshot(58, store(mark('src/shared-pending.ts', '7'.repeat(64)))))
    await pending.promise
    await Promise.resolve()
    expect(harness.completed).toEqual([])
  })

  it('keeps the newest monotone Host snapshot when a stale response arrives', () => {
    const newest = snapshot(50, store(mark('src/new.ts', '3'.repeat(64))))
    const stale = snapshot(49, store())

    expect(latestReviewProgressSnapshot(newest, stale)).toBe(newest)
    expect(latestReviewProgressSnapshot(newest, newest)).toBe(newest)
    expect(latestReviewProgressSnapshot(undefined, stale)).toBe(stale)
  })
})
