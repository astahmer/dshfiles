import { attentionApi, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { ALERT_FIRING_SOURCE, AlertAttention } from './alert-attention.js'
import { AlertEngine } from './alert-engine.js'
import type { AlertRuleView, AlertsSnapshot } from './alert-types.js'

const NOW = 1_700_000_000_000

const rule = (overrides: Partial<AlertRuleView> = {}): AlertRuleView => ({
  id: 'model-errors',
  name: 'Model errors',
  kind: 'error-rate',
  filter: { service: null, operation: 'chat *', attribute: null },
  windowMinutes: 10,
  threshold: 0.2,
  comparator: 'above',
  percentile: 95,
  minSamples: 4,
  severity: 'warning',
  enabled: true,
  notify: true,
  markThreads: false,
  mutedUntil: null,
  builtin: true,
  createdAt: 1,
  updatedAt: 1,
  state: { status: 'firing', since: NOW - 60_000, value: 0.5, sampleCount: 8, evaluatedAt: NOW, clearEvaluations: 0 },
  ...overrides,
})

const okState = { status: 'ok', since: null, value: 0, sampleCount: 8, evaluatedAt: NOW, clearEvaluations: 0 } as const

describe('traces alert inbox provider', () => {
  it('states each firing, unmuted, enabled rule as a Failed item keyed by its incident', () => {
    const drafts = AlertAttention.draftsOf(
      [
        rule(),
        rule({ id: 'muted', mutedUntil: NOW + 60_000 }),
        rule({ id: 'mute-expired', mutedUntil: NOW - 1 }),
        rule({ id: 'disabled', enabled: false }),
        rule({ id: 'ok', state: okState }),
      ],
      NOW,
    )
    expect(drafts.map(draft => draft.dedupeKey)).toEqual([`model-errors:${String(NOW - 60_000)}`, `mute-expired:${String(NOW - 60_000)}`])
    expect(drafts[0]).toEqual({
      dedupeKey: `model-errors:${String(NOW - 60_000)}`,
      subject: { kind: 'url', id: 'dsh-traces://alerts/model-errors', label: 'Model errors' },
      reason: 'Alert “Model errors” is firing (warning).',
      detail:
        'Last value 0.500, threshold above 0.200, over 10 min (8 spans). Inspect it in Observe › Traces › Alerts, or mute the rule there while you fix the cause.',
      severity: 'failed',
      verbs: ['Done', 'Snooze', 'MuteSource'],
    })
  })

  it('states a firing alert to the inbox and resolves it when the rule is muted or resolves', async () => {
    const host = await createTestHost()
    /** The inbox as the provider sees it: what each reconcile stated for this source. */
    const stated: (readonly AttentionDraft[])[] = []
    const refuse = () => {
      throw new Error('not used by the alert provider')
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
              if (input.source === ALERT_FIRING_SOURCE) stated.push(input.items)
              return { published: input.items.length, resolved: 0 }
            },
          }),
        ],
      }),
      { packageId: '@dshfiles/activity-timeline' },
    )
    let rules: AlertRuleView[] = [rule({ state: { ...rule().state, since: NOW } })]
    const unused = () => Effect.die('not used by the inbox provider')
    const engine = Layer.succeed(
      AlertEngine,
      AlertEngine.of({
        evaluate: unused,
        save: unused,
        remove: unused,
        mute: unused,
        feed: unused,
        snapshot: () =>
          Effect.sync(
            (): AlertsSnapshot => ({
              rules,
              firing: rules.filter(entry => entry.state.status === 'firing').length,
              history: [],
              latestEventId: 0,
              lastEvaluatedAt: null,
              intervalSeconds: 60,
            }),
          ),
      }),
    )
    const lastStated = async (count: number): Promise<readonly AttentionDraft[]> => {
      for (let attempt = 0; attempt < 400 && stated.length < count; attempt += 1) await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
      expect(stated).toHaveLength(count)
      return stated.at(-1) ?? []
    }
    const runtime = ManagedRuntime.make(
      AlertAttention.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(engine, HostApis.layer)),
        Layer.provideMerge(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/traces' }))),
      ),
    )
    try {
      await runtime.runPromise(Effect.void)
      expect((await lastStated(1)).map(draft => [draft.dedupeKey, draft.severity])).toEqual([[`model-errors:${String(NOW)}`, 'failed']])

      // A ready inbox always hears the current set again; an unchanged routine pass would write nothing.
      host.ctx.emit('dshfiles/attention/ready', { version: 1 })
      expect(await lastStated(2)).toHaveLength(1)

      // The user mutes the rule on the Alerts page: the next pass states nothing, so the inbox resolves the item.
      rules = rules.map(entry => ({ ...entry, mutedUntil: Date.now() + 60 * 60_000 }))
      host.ctx.emit('dshfiles/attention/ready', { version: 1 })
      expect(await lastStated(3)).toEqual([])

      // Unmuted and still firing it is stated again; once the rule resolves it is gone.
      rules = rules.map(entry => ({ ...entry, mutedUntil: null }))
      host.ctx.emit('dshfiles/attention/ready', { version: 1 })
      expect(await lastStated(4)).toHaveLength(1)
      rules = rules.map(entry => ({ ...entry, state: okState }))
      host.ctx.emit('dshfiles/attention/ready', { version: 1 })
      expect(await lastStated(5)).toEqual([])
    } finally {
      await runtime.dispose()
      await inbox.dispose()
      await host.dispose()
    }
  }, 120_000)
})
