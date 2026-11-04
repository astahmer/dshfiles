import { attentionApi, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import type { BacklogSummaryView } from './api.js'
import { BACKLOG_ATTENTION_SOURCE, BacklogAttention } from './attention-provider.js'
import { BacklogStore } from './store.js'
import { backlogStoreLayer } from './test-support.js'

const user = { kind: 'user' } as const

const summary = (overrides: Partial<BacklogSummaryView>): BacklogSummaryView =>
  // SAFETY: the provider reads only id, title, status, attention and activity.last.
  ({
    id: 7,
    title: 'Pick a cache key',
    status: 'doing',
    attention: 'needs-input',
    activity: { count: 1, agents: 1, comments: 0, last: null },
    ...overrides,
  }) as BacklogSummaryView

describe('backlog inbox provider', () => {
  it('states needs-input and blocked items as Needs you, waiting as Other, and nothing for closed or quiet items', () => {
    const drafts = BacklogAttention.draftsOf([
      summary({ activity: { count: 2, agents: 1, comments: 1, last: { at: 1, actor: 'agent:s', kind: 'commented', detail: 'Hash or path?' } } }),
      summary({ id: 8, title: 'Ship it', attention: 'blocked' }),
      summary({ id: 9, title: 'CI run', attention: 'waiting' }),
      summary({ id: 10, attention: 'none' }),
      summary({ id: 11, status: 'done' }),
    ])
    expect(drafts).toEqual([
      {
        dedupeKey: '7:needs-input',
        subject: { kind: 'backlog-item', id: '7', label: 'Pick a cache key' },
        reason: 'b:7 Pick a cache key needs your input.',
        detail: 'Hash or path?',
        severity: 'blocking',
        verbs: ['Done', 'Snooze', 'MuteSource'],
      },
      expect.objectContaining({ dedupeKey: '8:blocked', reason: 'b:8 Ship it is blocked.', severity: 'blocking' }),
      expect.objectContaining({ dedupeKey: '9:waiting', reason: 'b:9 CI run is waiting.', severity: 'ready' }),
    ])
  })

  it('states an item to the inbox when it asks for input and resolves it when its attention clears', async () => {
    const host = await createTestHost()
    const stated: (readonly AttentionDraft[])[] = []
    const refuse = () => {
      throw new Error('not used by the backlog provider')
    }
    const inbox = await host.mount(
      defineHost({
        name: 'activity-timeline',
        apis: [
          attentionApi.host({
            list: refuse,
            publish: refuse,
            resolve: refuse,
            done: refuse,
            snooze: refuse,
            reopen: refuse,
            muteSource: refuse,
            act: refuse,
            reconcile: ({ input }) => {
              if (input.source === BACKLOG_ATTENTION_SOURCE) stated.push(input.items)
              return { published: input.items.length, resolved: 0 }
            },
          }),
        ],
      }),
      { packageId: '@dshfiles/activity-timeline' },
    )
    const until = async (done: (items: readonly AttentionDraft[]) => boolean): Promise<readonly AttentionDraft[]> => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const last = stated.at(-1)
        if (last !== undefined && done(last)) return last
        await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
      }
      throw new Error(`the provider never stated the expected items; last: ${JSON.stringify(stated.at(-1))}`)
    }
    const runtime = ManagedRuntime.make(
      BacklogAttention.layer.pipe(
        Layer.provideMerge(backlogStoreLayer()),
        Layer.provideMerge(HostApis.layer),
        Layer.provideMerge(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/backlog' }))),
      ),
    )
    try {
      const store = await runtime.runPromise(BacklogStore)
      const captured = await runtime.runPromise(store.capture({ text: 'Pick a cache key', actor: user }))
      const id = captured.item.id
      await until(items => items.length === 0)

      await runtime.runPromise(store.update({ id, attention: 'needs-input', actor: { kind: 'agent', sessionId: 'session-a', cwd: '/w' } }))
      const asking = await until(items => items.length === 1)
      expect(asking[0]).toMatchObject({ dedupeKey: `${String(id)}:needs-input`, severity: 'blocking', subject: { kind: 'backlog-item', id: String(id) } })

      await runtime.runPromise(store.update({ id, attention: 'waiting', actor: user }))
      expect((await until(items => items[0]?.severity === 'ready'))[0]?.dedupeKey).toBe(`${String(id)}:waiting`)

      await runtime.runPromise(store.update({ id, attention: 'none', actor: user }))
      await until(items => items.length === 0)
    } finally {
      await runtime.dispose()
      await inbox.dispose()
      await host.dispose()
    }
  }, 120_000)
})
