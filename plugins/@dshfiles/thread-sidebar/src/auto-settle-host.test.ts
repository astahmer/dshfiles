import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { createAutoSettleScanner, type AutoSettleClock, type AutoSettleSnapshot } from './auto-settle-host.js'
import { AutoSettleScanModel, type ScannedSession } from './auto-settle-scan.js'
import { DEFAULT_PREFERENCES, type AutoSettlePolicy } from './organization.js'
import type { RebasedThread } from './rebased-threads.js'

const MINUTE = 60_000

const createFakeClock = (start: number) => {
  let current = start
  let timers: { readonly at: number; readonly run: () => void }[] = []
  const clock: AutoSettleClock = {
    now: () => current,
    schedule: (run, delayMs) => {
      const timer = { at: current + delayMs, run }
      timers.push(timer)
      return () => {
        timers = timers.filter(candidate => candidate !== timer)
      }
    },
  }
  /** Move time forward, firing each due timer in order and letting the scan it starts settle. */
  const advance = async (ms: number): Promise<void> => {
    const target = current + ms
    for (;;) {
      const due = timers.filter(timer => timer.at <= target).sort((left, right) => left.at - right.at)[0]
      if (due === undefined) break
      timers = timers.filter(timer => timer !== due)
      current = due.at
      due.run()
      for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()
    }
    current = target
  }
  return { clock, advance, pending: () => timers.length }
}

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

interface FakeHostState {
  policy: AutoSettlePolicy | undefined
  readonly settled: Set<string>
  readonly pinned: Set<string>
  writes: number
}

/** A Host whose sessions, settings and settled ids live in plain values the test changes. */
const createHost = (input: { readonly sessions: ScannedSession[]; readonly policy: AutoSettlePolicy; readonly rebasedThreads?: RebasedThread[] }) => {
  const state: FakeHostState = { policy: input.policy, settled: new Set(), pinned: new Set(), writes: 0 }
  const snapshot = (): AutoSettleSnapshot => ({
    sessions: input.sessions,
    workspaceBySession: new Map(),
    archivedSessionIds: new Set(),
    pinnedSessionIds: state.pinned,
    settledSessionIds: new Set(state.settled),
  })
  const fake = createFakeClock(BOOT)
  const scanner = createAutoSettleScanner({
    clock: fake.clock,
    bootDelayMs: 30_000,
    sources: {
      readPolicy: () => state.policy,
      readSnapshot: async () => snapshot(),
      readRebasedThreads: async () => input.rebasedThreads,
      settle: async sessionIds => {
        state.writes += 1
        for (const sessionId of sessionIds) state.settled.add(sessionId)
      },
    },
  })
  return { scanner, state, ...fake }
}

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

describe('createAutoSettleScanner', () => {
  it('waits for the boot delay, then scans on the configured interval with no browser', async () => {
    const host = createHost({ sessions: [session({ id: 'a', updatedAt: BOOT - 115 * MINUTE })], policy: policy() })
    host.scanner.start()
    expect(host.scanner.status().nextScanAt).toBe(BOOT + 30_000)

    await host.advance(29_999)
    expect(host.state.settled.size).toBe(0)
    await host.advance(1)
    // Idle for 115.5 min: not yet.
    expect(host.state.settled.size).toBe(0)
    expect(host.scanner.status().lastScan).toMatchObject({ idleSettled: 0, rebasedSettled: 0 })
    expect(host.scanner.status().nextScanAt).toBe(BOOT + 30_000 + 10 * MINUTE)

    await host.advance(10 * MINUTE)
    expect([...host.state.settled]).toEqual(['a'])
    expect(host.scanner.status().recent).toEqual([{ sessionId: 'a', reason: 'idle for 120 min', source: 'idle', at: BOOT + 30_000 + 10 * MINUTE }])
    host.scanner.stop()
    expect(host.pending()).toBe(0)
  })

  it('reads nothing and settles nothing while auto-settle is off', async () => {
    const host = createHost({ sessions: [session({ id: 'a', updatedAt: BOOT - 500 * MINUTE })], policy: policy({ autoSettleEnabled: false }) })
    host.scanner.start()
    await host.advance(60 * MINUTE)
    expect(host.state.writes).toBe(0)
    expect(host.scanner.status()).toMatchObject({ active: false, nextScanAt: null, lastScan: null })
  })

  it('rescans at once when the policy changes, but not for other sidebar writes', async () => {
    const host = createHost({ sessions: [session({ id: 'a', updatedAt: BOOT - 500 * MINUTE })], policy: policy({ autoSettleEnabled: false }) })
    host.scanner.start()
    await host.advance(30_000)

    host.scanner.settingsChanged()
    await host.advance(0)
    expect(host.state.writes).toBe(0)

    host.state.policy = policy()
    host.scanner.settingsChanged()
    await host.advance(0)
    expect([...host.state.settled]).toEqual(['a'])
  })

  it('records one auto-settle scan span with the settled counts', async () => {
    using recorder = recordSpans()
    const host = createHost({ sessions: [session({ id: 'a', updatedAt: BOOT - 500 * MINUTE })], policy: policy() })
    await host.scanner.scan()
    const spans = recorder.spans.filter(span => span.name === 'auto-settle scan')
    expect(spans).toHaveLength(1)
    expect(spans[0]?.attributes).toMatchObject({ 'thread_sidebar.sessions.count': 1, 'thread_sidebar.settled.idle': 1, 'thread_sidebar.settled.rebased': 0 })
  })

  it('reports a failed scan and keeps scanning', async () => {
    const fake = createFakeClock(BOOT)
    let fail = true
    const scanner = createAutoSettleScanner({
      clock: fake.clock,
      bootDelayMs: 0,
      sources: {
        readPolicy: () => policy(),
        readSnapshot: async () => {
          if (fail) throw new Error('session list timed out')
          return { sessions: [], workspaceBySession: new Map(), archivedSessionIds: new Set(), pinnedSessionIds: new Set(), settledSessionIds: new Set() }
        },
        readRebasedThreads: async () => undefined,
        settle: async () => undefined,
      },
    })
    scanner.start()
    await fake.advance(0)
    expect(scanner.status().lastScan?.error).toBe('session list timed out')
    fail = false
    await fake.advance(10 * MINUTE)
    expect(scanner.status().lastScan?.error).toBeUndefined()
  })

  it('settles a trigger request with its reason and reports what it skipped', async () => {
    const host = createHost({
      sessions: [
        session({ id: 'merged', updatedAt: BOOT }),
        session({ id: 'busy', updatedAt: BOOT, running: true }),
        session({ id: 'pinned', updatedAt: BOOT }),
      ],
      policy: policy({ autoSettleEnabled: false }),
    })
    host.state.pinned.add('pinned')
    const result = await host.scanner.requestSettle({
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
    expect([...host.state.settled]).toEqual(['merged'])
    expect(host.scanner.status().recent[0]).toEqual({ sessionId: 'merged', reason: 'pull request #12 merged', source: '@dshfiles/pull-requests', at: BOOT })
    expect((await host.scanner.requestSettle({ sessionIds: ['merged'], reason: 'again', source: 'test' })).results).toEqual([
      { sessionId: 'merged', outcome: 'already-settled' },
    ])
  })

  it('refuses a trigger request while the settings namespace is unavailable', async () => {
    const host = createHost({ sessions: [], policy: policy() })
    host.state.policy = undefined
    await expect(host.scanner.requestSettle({ sessionIds: ['a'], reason: 'r', source: 's' })).rejects.toThrow('restart DSH')
  })
})
