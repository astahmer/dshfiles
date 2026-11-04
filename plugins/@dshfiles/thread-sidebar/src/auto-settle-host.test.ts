import { DshxEffect } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { AutoSettle, AutoSettleSources } from './auto-settle-host.js'
import { AutoSettleScanModel, type ScannedSession } from './auto-settle-scan.js'
import { DEFAULT_PREFERENCES, type AutoSettlePolicy } from './organization.js'
import { OutsideReload } from './outside-reload-promise.js'
import type { RebasedThread } from './rebased-threads.js'
import { threadSidebarSettings } from './settings.js'
import { HostCallFailed } from './sidebar-errors.js'
import { SidebarSettings, ThreadSidebarSettings, type SidebarSettingsValue } from './sidebar-settings.js'

const MINUTE = 60_000

const policy = (overrides: Partial<AutoSettlePolicy> = {}): AutoSettlePolicy => ({
  autoSettleEnabled: true,
  autoSettleSessionIds: [],
  autoSettleDisabledSessionIds: [],
  parkedSessionIds: [],
  excludedSessionIds: [],
  excludedWorkspaceIds: [],
  idleMinutes: DEFAULT_PREFERENCES.idleMinutes,
  rebasedThreadSettleDelay: 'disabled',
  scanIntervalMinutes: 10,
  ...overrides,
})

const session = (overrides: Partial<ScannedSession> & Pick<ScannedSession, 'id' | 'updatedAt'>): ScannedSession => ({
  running: false,
  blank: false,
  pendingInteraction: false,
  ...overrides,
})

const BOOT = 1_000_000_000

const settingsValue = (autoSettle: AutoSettlePolicy): SidebarSettingsValue => ({ ...threadSidebarSettings.schema({}), ...autoSettle })

/** The Host a scan reads: fixed Sessions, a pinned set the test changes, and a session list that can time out. */
const fakeSources = (input: {
  readonly sessions: readonly ScannedSession[]
  readonly pinned: Ref.Ref<ReadonlySet<string>>
  readonly failing: Ref.Ref<boolean>
}) =>
  Layer.effect(
    AutoSettleSources,
    Effect.gen(function* () {
      const settings = yield* SidebarSettings
      return AutoSettleSources.of({
        snapshot: Effect.gen(function* () {
          if (yield* Ref.get(input.failing)) return yield* new HostCallFailed({ operation: 'list sessions' })
          return {
            sessions: input.sessions,
            workspaceBySession: new Map(),
            archivedSessionIds: new Set(),
            pinnedSessionIds: yield* Ref.get(input.pinned),
            settledSessionIds: new Set(yield* settings.settledSessionIds),
          }
        }),
        rebasedThreads: Effect.succeedNone,
      })
    }),
  )

/** Auto-settle over in-memory settings at BOOT; `scheduled` also runs the Host's scan loop. */
const withAutoSettle = <A, E>(
  input: { readonly sessions: readonly ScannedSession[]; readonly policy: AutoSettlePolicy; readonly scheduled?: boolean },
  body: (host: {
    readonly pinned: Ref.Ref<ReadonlySet<string>>
    readonly failing: Ref.Ref<boolean>
  }) => Effect.Effect<A, E, AutoSettle | SidebarSettings | Settings.SettingsOf<SidebarSettingsValue>>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(BOOT)
    const pinned = yield* Ref.make<ReadonlySet<string>>(new Set())
    const failing = yield* Ref.make(false)
    const service = AutoSettle.layer.pipe(Layer.provideMerge(fakeSources({ sessions: input.sessions, pinned, failing })))
    const withLoop = input.scheduled === true ? AutoSettle.schedule().pipe(Layer.provideMerge(service), Layer.provide(OutsideReload.layerTest)) : service
    const layer = withLoop.pipe(
      Layer.provideMerge(SidebarSettings.layer),
      Layer.provideMerge(Settings.layerTest<SidebarSettingsValue>('thread-sidebar', settingsValue(input.policy))),
    )
    return yield* body({ pinned, failing }).pipe(Effect.provide(layer))
  })

const settledIds = SidebarSettings.use(settings => settings.settledSessionIds)
const revision = ThreadSidebarSettings.use(settings => settings.snapshot)

describe('AutoSettleScanModel.decide', () => {
  const base = {
    workspaceBySession: new Map<string, string>(),
    archivedSessionIds: new Set<string>(),
    pinnedSessionIds: new Set<string>(),
    settledSessionIds: new Set<string>(),
    rebasedThreads: undefined,
  }

  it('settles a thread only once it has been idle for the threshold', () => {
    const sessions = [session({ id: 'a', updatedAt: BOOT })]
    expect(AutoSettleScanModel.decide({ ...base, now: BOOT + 119 * MINUTE, policy: policy(), sessions }).idle).toEqual([])
    expect(AutoSettleScanModel.decide({ ...base, now: BOOT + 120 * MINUTE, policy: policy(), sessions }).idle).toEqual(['a'])
  })

  it('keeps running, waiting, blank, pinned and opted-out threads and parents of a running subagent', () => {
    const sessions = [
      session({ id: 'running', updatedAt: BOOT, running: true }),
      session({ id: 'question', updatedAt: BOOT, pendingInteraction: true }),
      session({ id: 'blank', updatedAt: BOOT, blank: true }),
      session({ id: 'pinned', updatedAt: BOOT }),
      session({ id: 'opted-out', updatedAt: BOOT }),
      session({ id: 'parent', updatedAt: BOOT }),
      session({ id: 'child', updatedAt: BOOT, parentId: 'parent', running: true }),
      session({ id: 'idle', updatedAt: BOOT }),
    ]
    const decision = AutoSettleScanModel.decide({
      ...base,
      now: BOOT + 200 * MINUTE,
      policy: policy({ autoSettleDisabledSessionIds: ['opted-out'] }),
      sessions,
      pinnedSessionIds: new Set(['pinned']),
    })
    expect(decision.idle).toEqual(['idle'])
  })

  it('settles a per-thread opt-in with the global policy off, and nothing else', () => {
    const sessions = [session({ id: 'opted-in', updatedAt: BOOT }), session({ id: 'other', updatedAt: BOOT })]
    const decision = AutoSettleScanModel.decide({
      ...base,
      now: BOOT + 200 * MINUTE,
      policy: policy({ autoSettleEnabled: false, autoSettleSessionIds: ['opted-in'] }),
      sessions,
    })
    expect(decision.idle).toEqual(['opted-in'])
  })

  it('settles a rebased thread after its delay, without counting it twice', () => {
    const rebasedAt = BOOT + 10 * MINUTE
    const sessions = [session({ id: 'rebased', updatedAt: BOOT }), session({ id: 'fresh', updatedAt: BOOT + 100 * MINUTE })]
    const rebasedThreads: RebasedThread[] = [
      { sessionIds: ['rebased'], rebasedAt, unlanded: [] },
      { sessionIds: ['fresh'], rebasedAt, unlanded: [] },
    ]
    const rebasedPolicy = policy({ autoSettleEnabled: false, rebasedThreadSettleDelay: 'after-1-hour' })
    expect(AutoSettleScanModel.decide({ ...base, now: rebasedAt + 59 * MINUTE, policy: rebasedPolicy, sessions, rebasedThreads }).rebased).toEqual([])
    expect(AutoSettleScanModel.decide({ ...base, now: rebasedAt + 60 * MINUTE, policy: rebasedPolicy, sessions, rebasedThreads }).rebased).toEqual(['rebased'])
    // Idle and rebased at once: settled once, reported as idle.
    const both = AutoSettleScanModel.decide({
      ...base,
      now: BOOT + 200 * MINUTE,
      policy: policy({ rebasedThreadSettleDelay: 'immediately' }),
      sessions,
      rebasedThreads,
    })
    expect(both.idle).toEqual(['rebased'])
    expect(both.rebased).toEqual([])
  })
})

describe('AutoSettle', () => {
  it.effect('waits for the boot delay, then scans on the configured interval with no browser', () =>
    withAutoSettle({ sessions: [session({ id: 'a', updatedAt: BOOT - 115 * MINUTE })], policy: policy(), scheduled: true }, () =>
      Effect.gen(function* () {
        const autoSettle = yield* AutoSettle
        yield* Effect.yieldNow
        expect((yield* autoSettle.status).nextScanAt).toBe(BOOT + 30_000)

        yield* TestClock.adjust(29_999)
        expect(yield* settledIds).toEqual([])
        yield* TestClock.adjust(1)
        // Idle for 115.5 min: not yet.
        expect(yield* settledIds).toEqual([])
        expect((yield* autoSettle.status).lastScan).toMatchObject({ idleSettled: 0, rebasedSettled: 0 })
        expect((yield* autoSettle.status).nextScanAt).toBe(BOOT + 30_000 + 10 * MINUTE)

        yield* TestClock.adjust(10 * MINUTE)
        expect(yield* settledIds).toEqual(['a'])
        expect((yield* autoSettle.status).recent).toEqual([{ sessionId: 'a', reason: 'idle for 120 min', source: 'idle', at: BOOT + 30_000 + 10 * MINUTE }])
      }),
    ),
  )

  it.effect('reads nothing and settles nothing while auto-settle is off', () =>
    withAutoSettle({ sessions: [session({ id: 'a', updatedAt: BOOT - 500 * MINUTE })], policy: policy({ autoSettleEnabled: false }), scheduled: true }, () =>
      Effect.gen(function* () {
        const before = yield* revision
        yield* TestClock.adjust(60 * MINUTE)
        expect((yield* revision).revision).toBe(before.revision)
        expect(yield* AutoSettle.use(autoSettle => autoSettle.status)).toMatchObject({ active: false, nextScanAt: null, lastScan: null })
      }),
    ),
  )

  it.effect('rescans at once when the policy changes, but not for other sidebar writes', () =>
    withAutoSettle({ sessions: [session({ id: 'a', updatedAt: BOOT - 500 * MINUTE })], policy: policy({ autoSettleEnabled: false }), scheduled: true }, () =>
      Effect.gen(function* () {
        const settings = yield* ThreadSidebarSettings
        yield* TestClock.adjust(30_000)

        yield* settings.update({ collapsedGroups: ['other'] })
        yield* TestClock.adjust(0)
        expect(yield* settledIds).toEqual([])

        yield* settings.update({ autoSettleEnabled: true })
        yield* TestClock.adjust(0)
        expect(yield* settledIds).toEqual(['a'])
      }),
    ),
  )

  it.effect('records one auto-settle scan span with the settled counts', () =>
    withAutoSettle({ sessions: [session({ id: 'a', updatedAt: BOOT - 500 * MINUTE })], policy: policy() }, () =>
      Effect.gen(function* () {
        using recorder = recordSpans()
        yield* AutoSettle.use(autoSettle => autoSettle.scan).pipe(Effect.provide(DshxEffect.tracerLayer))
        const spans = recorder.spans.filter(span => span.name === 'auto-settle scan')
        expect(spans).toHaveLength(1)
        expect(spans[0]?.attributes).toMatchObject({
          'thread_sidebar.sessions.count': 1,
          'thread_sidebar.settled.idle': 1,
          'thread_sidebar.settled.rebased': 0,
        })
      }),
    ),
  )

  it.effect('reports a failed scan and keeps scanning', () =>
    withAutoSettle({ sessions: [], policy: policy(), scheduled: true }, host =>
      Effect.gen(function* () {
        const autoSettle = yield* AutoSettle
        yield* Ref.set(host.failing, true)
        yield* TestClock.adjust(30_000)
        expect((yield* autoSettle.status).lastScan?.error).toBe('The Host could not list sessions. Retry in a moment.')
        yield* Ref.set(host.failing, false)
        yield* TestClock.adjust(10 * MINUTE)
        expect((yield* autoSettle.status).lastScan?.error).toBeUndefined()
      }),
    ),
  )

  it.effect('settles a trigger request with its reason and reports what it skipped', () =>
    withAutoSettle(
      {
        sessions: [
          session({ id: 'merged', updatedAt: BOOT }),
          session({ id: 'busy', updatedAt: BOOT, running: true }),
          session({ id: 'pinned', updatedAt: BOOT }),
        ],
        policy: policy({ autoSettleEnabled: false }),
      },
      host =>
        Effect.gen(function* () {
          const autoSettle = yield* AutoSettle
          yield* Ref.set(host.pinned, new Set(['pinned']))
          const result = yield* autoSettle.requestSettle({
            sessionIds: ['merged', 'busy', 'pinned', 'gone'],
            reason: 'pull request #12 merged',
            source: '@dshfiles/pull-requests',
          })
          expect(result.results).toEqual([
            { sessionId: 'merged', outcome: 'settled' },
            { sessionId: 'busy', outcome: 'skipped', skipReason: 'running' },
            { sessionId: 'pinned', outcome: 'skipped', skipReason: 'pinned' },
            { sessionId: 'gone', outcome: 'skipped', skipReason: 'unknown' },
          ])
          expect(yield* settledIds).toEqual(['merged'])
          expect((yield* autoSettle.status).recent[0]).toEqual({
            sessionId: 'merged',
            reason: 'pull request #12 merged',
            source: '@dshfiles/pull-requests',
            at: BOOT,
          })
          expect((yield* autoSettle.requestSettle({ sessionIds: ['merged'], reason: 'again', source: 'test' })).results).toEqual([
            { sessionId: 'merged', outcome: 'already-settled' },
          ])
        }),
    ),
  )
})
