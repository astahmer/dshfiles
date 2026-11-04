import { Context as CordisContext } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostContext } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { describe, expect, it } from '@effect/vitest'
import { NodeServices } from '@effect/platform-node'
import { Effect, Exit, FileSystem, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import type { AttentionDraft, AttentionPublish } from './attention-api.js'
import { AttentionInbox } from './attention-store.js'

/** A real Cordis context with the JSON storage-domain backend in `root`, disposed with the layer. */
const jsonStorageHost = (root: string) =>
  Layer.effect(
    HostContext,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const ctx = new CordisContext()
        await ctx.plugin(Storage)
        await ctx.plugin(StorageJson, { root })
        await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
        return ctx
      }),
      ctx => Effect.promise(() => ctx.fiber.dispose()),
    ).pipe(Effect.map(ctx => HostContext.of({ ctx, packageId: '@dshfiles/activity-timeline' }))),
  )

const inboxIn = (root: string) => AttentionInbox.layer.pipe(Layer.provide(StorageDomain.layer), Layer.provide(jsonStorageHost(root)))

const temporaryRoot = Effect.flatMap(FileSystem.FileSystem, fs => fs.makeTempDirectoryScoped({ prefix: 'attention-store-' })).pipe(Effect.provide(NodeServices.layer))

const draft = (dedupeKey: string, overrides: Partial<AttentionDraft> = {}): AttentionDraft => ({
  dedupeKey,
  subject: { kind: 'session', id: `session-${dedupeKey}` },
  reason: `Question ${dedupeKey} waits for an answer`,
  severity: 'blocking',
  verbs: ['Answer', 'Open', 'Done', 'Snooze'],
  ...overrides,
})

const SOURCE = 'agent-questions.child-question'
const publishInput = (dedupeKey: string, overrides: Partial<AttentionDraft> = {}): AttentionPublish => ({ source: SOURCE, ...draft(dedupeKey, overrides) })

describe('attention inbox store', () => {
  it.effect('dedupes, resolves and keeps items across a restart', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      const id = yield* Effect.gen(function* () {
        const inbox = yield* AttentionInbox
        const first = yield* inbox.publish(publishInput('q1'))
        const repeat = yield* inbox.publish(publishInput('q1'))
        expect(repeat).toEqual({ item: first.item, changed: false })
        yield* inbox.publish(publishInput('q2', { severity: 'ready' }))
        const listed = yield* inbox.list({ view: 'needs-you', limit: 10 })
        expect(listed.items.map(item => item.dedupeKey)).toEqual(['q1'])
        expect(listed.counts).toMatchObject({ needsYou: 1, blocking: 1, other: 1 })
        return first.item.id
      }).pipe(Effect.provide(inboxIn(root)))

      yield* Effect.gen(function* () {
        const inbox = yield* AttentionInbox
        expect((yield* inbox.get(id)).dedupeKey).toBe('q1')
        expect(yield* inbox.resolve({ source: SOURCE, dedupeKey: 'q1' })).toBe(true)
        expect(yield* inbox.resolve({ source: SOURCE, dedupeKey: 'q1' })).toBe(false)
        const closed = yield* inbox.list({ view: 'closed', limit: 10 })
        expect(closed.items.map(item => item.id)).toEqual([id])
        expect(closed.counts.needsYou).toBe(0)
      }).pipe(Effect.provide(inboxIn(root)))
    }),
  )

  it.effect('reconcile publishes the listed items and resolves every other open item of the source', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      yield* Effect.gen(function* () {
        const inbox = yield* AttentionInbox
        yield* inbox.publish(publishInput('stale'))
        yield* inbox.publish({ ...publishInput('foreign'), source: 'thread-sidebar.finished-turn' })
        expect(yield* inbox.reconcile({ source: SOURCE, items: [draft('fresh')] })).toEqual({ published: 1, resolved: 1 })
        expect(yield* inbox.reconcile({ source: SOURCE, items: [draft('fresh')] })).toEqual({ published: 0, resolved: 0 })
        const open = yield* inbox.list({ view: 'needs-you', limit: 10 })
        expect(open.items.map(item => item.dedupeKey).sort()).toEqual(['foreign', 'fresh'])
      }).pipe(Effect.provide(inboxIn(root)))
    }),
  )

  it.effect('snoozes until a change or a time, and reopens done and snoozed items', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      yield* Effect.gen(function* () {
        const inbox = yield* AttentionInbox
        yield* TestClock.setTime(10_000)
        const { item } = yield* inbox.publish(publishInput('q1'))

        yield* inbox.snooze({ id: item.id, untilChange: true })
        yield* inbox.publish(publishInput('q1'))
        expect((yield* inbox.list({ view: 'snoozed', limit: 10 })).items).toHaveLength(1)
        yield* inbox.publish(publishInput('q1', { reason: 'Question q1 changed its options' }))
        expect((yield* inbox.list({ view: 'needs-you', limit: 10 })).items).toHaveLength(1)

        yield* inbox.snooze({ id: item.id, until: 20_000 })
        expect((yield* inbox.list({ view: 'needs-you', limit: 10 })).counts.snoozed).toBe(1)
        yield* TestClock.setTime(20_000)
        expect((yield* inbox.list({ view: 'needs-you', limit: 10 })).items).toHaveLength(1)

        yield* inbox.done({ id: item.id })
        expect((yield* inbox.list({ view: 'closed', limit: 10 })).items).toHaveLength(1)
        yield* inbox.reopen({ id: item.id })
        expect((yield* inbox.list({ view: 'needs-you', limit: 10 })).items).toHaveLength(1)

        yield* inbox.snooze({ id: item.id, untilChange: true })
        yield* inbox.reopen({ id: item.id })
        expect((yield* inbox.list({ view: 'needs-you', limit: 10 })).items).toHaveLength(1)

        yield* inbox.resolve({ source: SOURCE, dedupeKey: 'q1' })
        const refused = yield* Effect.exit(inbox.reopen({ id: item.id }))
        expect(Exit.isFailure(refused)).toBe(true)
        const missing = yield* Effect.exit(inbox.done({ id: 'missing' }))
        expect(Exit.isFailure(missing)).toBe(true)
      }).pipe(Effect.provide(inboxIn(root)))
    }),
  )

  it.effect('mutes and unmutes a source, durably', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      yield* Effect.gen(function* () {
        const inbox = yield* AttentionInbox
        yield* inbox.publish(publishInput('q1'))
        expect(yield* inbox.muteSource({ source: SOURCE, muted: true })).toEqual({ mutedSources: [SOURCE] })
      }).pipe(Effect.provide(inboxIn(root)))
      yield* Effect.gen(function* () {
        const inbox = yield* AttentionInbox
        const muted = yield* inbox.list({ view: 'muted', limit: 10 })
        expect(muted.items).toHaveLength(1)
        expect(muted.mutedSources).toEqual([SOURCE])
        expect(muted.counts.needsYou).toBe(0)
        yield* inbox.muteSource({ source: SOURCE, muted: false })
        expect((yield* inbox.list({ view: 'needs-you', limit: 10 })).items).toHaveLength(1)
      }).pipe(Effect.provide(inboxIn(root)))
    }),
  )
})
