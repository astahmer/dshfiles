import { attentionApi, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from 'vitest'
import type { DeferredPackage } from '../api.js'
import { DEFERRED_UPDATE_SOURCE, DeferredUpdateAttention } from './attention.js'

const held = (id: string): DeferredPackage => ({ id, reason: 'host-artifact-changed' })

describe('hmr-gate inbox provider', () => {
  it('states held-back rebuilds as one Ready item with recovery text and no restart verb', () => {
    expect(DeferredUpdateAttention.draftsOf([])).toEqual([])
    const [draft] = DeferredUpdateAttention.draftsOf([held('@dshfiles/traces'), held('@dshfiles/backlog')])
    expect(draft).toEqual({
      dedupeKey: 'host-restart',
      subject: { kind: 'host', id: 'local', label: 'This DSH' },
      reason: '2 plugin updates wait for a DSH restart.',
      detail:
        'Waiting: @dshfiles/backlog, @dshfiles/traces. Their new Host code is built but not loaded, so their pages keep the last matching version. Restart DSH when no agent is working (Restart when idle in the sidebar when the supervisor runs it, or your own launcher); nothing restarts by itself.',
      severity: 'ready',
      verbs: ['Done', 'Snooze', 'MuteSource'],
    })
    expect(draft?.verbs.some(verb => verb === 'Retry' || verb === 'Approve')).toBe(false)
  })

  it('states the deferred set to the inbox after a burst, again when the inbox is ready, and nothing once it applied', async () => {
    const host = await createTestHost()
    const stated: (readonly AttentionDraft[])[] = []
    const refuse = () => {
      throw new Error('not used by the hmr-gate provider')
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
              if (input.source === DEFERRED_UPDATE_SOURCE) stated.push(input.items)
              return { published: input.items.length, resolved: 0 }
            },
          }),
        ],
      }),
      { packageId: '@dshfiles/activity-timeline' },
    )
    const statedCount = async (count: number): Promise<readonly AttentionDraft[]> => {
      for (let attempt = 0; attempt < 200 && stated.length < count; attempt += 1) await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
      expect(stated).toHaveLength(count)
      return stated.at(-1) ?? []
    }
    let deferred: DeferredPackage[] = []
    const provider = DeferredUpdateAttention.install(host.ctx, () => deferred)
    try {
      expect(await statedCount(1)).toEqual([])

      deferred = [held('@dshfiles/traces')]
      provider.changed()
      provider.changed()
      provider.changed()
      expect((await statedCount(2)).map(draft => draft.reason)).toEqual(['1 plugin update waits for a DSH restart.'])

      host.ctx.emit('dshfiles/attention/ready', { version: 1 })
      expect(await statedCount(3)).toHaveLength(1)

      // The user restarted (or the Host loaded the new code): the rebuild applied and the item resolves.
      deferred = []
      provider.changed()
      expect(await statedCount(4)).toEqual([])
    } finally {
      provider.dispose()
      await inbox.dispose()
      await host.dispose()
    }
  })
})
