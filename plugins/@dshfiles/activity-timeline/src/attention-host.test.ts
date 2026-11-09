import { Context as CordisContext } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostContext } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { describe, expect, it } from '@effect/vitest'
import { NodeServices } from '@effect/platform-node'
import { Effect, Exit, FileSystem, Layer } from 'effect'
import { ActivityTimeline } from './activity-timeline.js'
import type { AttentionActRequest, AttentionPublish } from './attention-api.js'
import { attentionHandlers } from './attention-host.js'
import { AttentionInbox } from './attention-store.js'
import { temporaryStatePath, timelineLayer } from './test-support.js'

const SOURCE = 'agent-questions.child-question'
const plugin = { caller: { kind: 'plugin', packageId: '@dshfiles/agent-questions' }, peer: undefined } as const
const browser = { caller: { kind: 'client' }, peer: undefined } as const

const question: AttentionPublish = {
  source: SOURCE,
  dedupeKey: 'q1',
  subject: { kind: 'session', id: 'session-parent' },
  reason: 'A subagent asks: deploy now?',
  severity: 'blocking',
  verbs: ['Answer', 'Open', 'Done'],
  choices: [
    { id: 'yes', label: 'Deploy' },
    { id: 'no', label: 'Wait' },
  ],
}

const world = (headers: Readonly<Record<string, { readonly origin?: 'subagent'; readonly parentSession?: string }>> = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'attention-host-' })
    const statePath = yield* temporaryStatePath
    const ctx = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const context = new CordisContext()
        await context.plugin(Storage)
        await context.plugin(StorageJson, { root })
        await context.plugin(StorageDomainPlugin, { backend: 'json' })
        context.provide('sessionPersistence', {
          stat: async (sessionId: SessionId) => {
            const header = headers[sessionId]
            return header === undefined ? undefined : { header: { ...header, id: sessionId }, revision: 0 }
          },
        })
        return context
      }),
      context => Effect.promise(() => context.fiber.dispose()),
    )
    const hostLayer = Layer.succeed(HostContext, HostContext.of({ ctx, packageId: '@dshfiles/activity-timeline' }))
    const layer = Layer.mergeAll(AttentionInbox.layer.pipe(Layer.provide(StorageDomain.layer)), timelineLayer({ statePath })).pipe(
      Layer.provideMerge(hostLayer),
    )
    return { ctx, layer }
  }).pipe(Effect.provide(NodeServices.layer))

describe('attention handlers', () => {
  it.effect('accepts publish, resolve and reconcile only from a Host plugin', () =>
    Effect.gen(function* () {
      const { layer } = yield* world()
      yield* Effect.gen(function* () {
        const refused = yield* Effect.exit(attentionHandlers.publish(question, browser))
        expect(Exit.isFailure(refused)).toBe(true)
        expect(JSON.stringify(refused)).toContain('AttentionProviderOnly')
        const published = yield* attentionHandlers.publish(question, plugin)
        expect(published.changed).toBe(true)
        expect(Exit.isFailure(yield* Effect.exit(attentionHandlers.resolve({ source: SOURCE, dedupeKey: 'q1' }, browser)))).toBe(true)
        expect(yield* attentionHandlers.resolve({ source: SOURCE, dedupeKey: 'q1' }, plugin)).toEqual({ resolved: true })
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live('sends info items to the Activity log instead of the inbox', () =>
    Effect.gen(function* () {
      const { layer } = yield* world()
      yield* Effect.gen(function* () {
        const outcome = yield* attentionHandlers.publish({ ...question, dedupeKey: 'note', severity: 'info', reason: 'Digest written' }, plugin)
        expect(outcome).toEqual({ item: null, changed: false })
        const listed = yield* attentionHandlers.list({ view: 'needs-you' })
        expect(listed.counts.needsYou).toBe(0)
        const page = yield* ActivityTimeline.use(timeline => timeline.page({ detailed: true }))
        expect(JSON.stringify(page)).toContain('Digest written')
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('lists an item about a subagent under the thread the user acts on', () =>
    Effect.gen(function* () {
      const { layer } = yield* world({
        'session-child': { origin: 'subagent', parentSession: 'session-parent' },
        'session-parent': {},
      })
      yield* Effect.gen(function* () {
        const published = yield* attentionHandlers.publish(
          { ...question, dedupeKey: 'subagent-turn', subject: { kind: 'session', id: 'session-child', label: 'You are doing a narrow,' } },
          plugin,
        )
        expect(published.item?.subject).toEqual({ kind: 'session', id: 'session-child', label: 'You are doing a narrow,' })
        const listed = yield* attentionHandlers.list({ view: 'needs-you' })
        expect(listed.items.map(item => item.subject)).toEqual([{ kind: 'session', id: 'session-parent' }])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('hands a provider verb to the owning plugin and explains when none answers', () =>
    Effect.gen(function* () {
      const { ctx, layer } = yield* world()
      yield* Effect.gen(function* () {
        const { item } = yield* attentionHandlers.publish(question, plugin)
        if (item === null) throw new Error('expected a stored item')
        const unhandled = yield* attentionHandlers.act({ id: item.id, verb: 'Answer', choiceId: 'yes' })
        expect(unhandled.ok).toBe(false)
        expect(unhandled.message).toContain('Open the item')

        const seen: AttentionActRequest[] = []
        ctx.on('dshfiles/attention/act', async request => {
          if (request.item.source !== SOURCE) return undefined
          seen.push(request)
          return { ok: true, message: 'Answered Deploy.' }
        })
        expect(yield* attentionHandlers.act({ id: item.id, verb: 'Answer', choiceId: 'yes' })).toEqual({ ok: true, message: 'Answered Deploy.' })
        expect(seen.map(request => [request.verb, request.choiceId])).toEqual([['Answer', 'yes']])
        const offered = yield* attentionHandlers.act({ id: item.id, verb: 'Land' })
        expect(offered.ok).toBe(false)
      }).pipe(Effect.provide(layer))
    }),
  )
})
