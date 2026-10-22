import { describe, expect, test } from 'vitest'
import { createSessionActivityCache, readWorkspaceSessionActivity, type SessionActivity } from './session-activity-cache.js'
import { ThreadRebaseEligibilityModel } from './thread-rebase-eligibility.js'

const activityOf = (sessionId: string, running: boolean): SessionActivity => new Map([[sessionId, { running, pendingUserQuestion: false }]])

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(done => {
    resolve = done
  })
  return { promise, resolve }
}

const cacheOf = (
  read: (signal: AbortSignal) => Promise<SessionActivity | undefined>,
  options: { readonly now?: () => number; readonly guardBudgetMs?: number; readonly guardAttempts?: number } = {},
) =>
  createSessionActivityCache({
    read,
    ttlMs: 30_000,
    displayBudgetMs: 2_500,
    guardBudgetMs: options.guardBudgetMs ?? 15_000,
    guardAttempts: options.guardAttempts ?? 2,
    guardCeilingMs: 60_000,
    ...(options.now === undefined ? {} : { now: options.now }),
  })

describe('session activity cache', () => {
  test('a question blocks integration even when the Session Agent is idle', async () => {
    const projectionsRead: string[] = []
    const activity = await readWorkspaceSessionActivity({
      sessionIds: ['waiting-session', 'other-session'],
      signal: new AbortController().signal,
      getRunning: () => false,
      readProjections: async sessionId => {
        projectionsRead.push(sessionId)
        return { values: { userQuestions: { active: sessionId === 'waiting-session' ? [{ callId: 'call' }] : [] } } }
      },
    })

    expect(projectionsRead).toEqual(['waiting-session', 'other-session'])
    expect(activity.get('waiting-session')).toEqual({ running: false, pendingUserQuestion: true, title: undefined, blank: undefined })
    expect(ThreadRebaseEligibilityModel.canRebaseIfKnown(['waiting-session'], activity)).toBe(false)
  })

  test('a workspace guard reads only its Sessions without replacing the full display snapshot', async () => {
    let fullReads = 0
    const guardedSessions: string[][] = []
    const cache = createSessionActivityCache({
      read: async () => {
        fullReads += 1
        return activityOf('unrelated-session', true)
      },
      readGuard: async sessionIds => {
        guardedSessions.push([...sessionIds])
        return new Map(sessionIds.map(sessionId => [sessionId, { running: false, pendingUserQuestion: false }]))
      },
      ttlMs: 30_000,
      displayBudgetMs: 2_500,
      guardBudgetMs: 15,
      guardAttempts: 1,
      guardCeilingMs: 60_000,
    })

    await expect(cache.guard(['workspace-session-a', 'workspace-session-b'])).resolves.toEqual(
      new Map([
        ['workspace-session-a', { running: false, pendingUserQuestion: false }],
        ['workspace-session-b', { running: false, pendingUserQuestion: false }],
      ]),
    )
    expect(guardedSessions).toEqual([['workspace-session-a', 'workspace-session-b']])
    expect(fullReads).toBe(0)
    await expect(cache.display()).resolves.toEqual(activityOf('unrelated-session', true))
    expect(fullReads).toBe(1)
  })

  test('a first display read that outlives its budget resolves as unknown instead of hanging', async () => {
    const cache = cacheOf(async signal => {
      expect(signal).toBeInstanceOf(AbortSignal)
      return undefined
    })

    await expect(cache.display()).resolves.toBeUndefined()
  })

  test('concurrent display reads share one bounded read', async () => {
    let reads = 0
    const pending = deferred<SessionActivity | undefined>()
    const cache = cacheOf(async () => {
      reads += 1
      return await pending.promise
    })

    const first = cache.display()
    const second = cache.display()
    expect(reads).toBe(1)
    pending.resolve(activityOf('session-a', true))
    await expect(first).resolves.toEqual(activityOf('session-a', true))
    await expect(second).resolves.toEqual(activityOf('session-a', true))
    expect(reads).toBe(1)
  })

  test('a stale display value is served at once while one background read refreshes it', async () => {
    let clock = 0
    let reads = 0
    const refreshValue = deferred<SessionActivity | undefined>()
    const cache = cacheOf(
      async () => {
        reads += 1
        return reads === 1 ? activityOf('session-a', true) : await refreshValue.promise
      },
      { now: () => clock },
    )

    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    clock = 30_001
    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    expect(reads).toBe(2)

    refreshValue.resolve(activityOf('session-a', false))
    await new Promise(done => setTimeout(done, 0))
    await expect(cache.display()).resolves.toEqual(activityOf('session-a', false))
    expect(reads).toBe(2)
  })

  test('a guard read bypasses the cache and publishes what it read', async () => {
    let reads = 0
    const cache = cacheOf(async () => {
      reads += 1
      return activityOf('session-a', reads === 1)
    })

    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    await expect(cache.guard()).resolves.toEqual(activityOf('session-a', false))
    await expect(cache.display()).resolves.toEqual(activityOf('session-a', false))
    expect(reads).toBe(2)
  })

  test('a failed read keeps the last good value for display and reports unknown to the guard', async () => {
    let clock = 0
    let fail = false
    const cache = cacheOf(async () => (fail ? undefined : activityOf('session-a', true)), { now: () => clock })

    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    fail = true
    clock = 30_001
    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    await expect(cache.guard()).resolves.toBeUndefined()
  })

  test('a failed read after an invalidation reports unknown instead of a stale value', async () => {
    let fail = false
    const cache = cacheOf(async () => (fail ? undefined : activityOf('session-a', true)))

    await expect(cache.display()).resolves.toEqual(activityOf('session-a', true))
    fail = true
    cache.reset()
    await expect(cache.display()).resolves.toBeUndefined()
  })

  test('a throwing read is unknown rather than an unhandled rejection', async () => {
    const cache = cacheOf(async () => {
      throw new Error('session controller unavailable')
    })

    await expect(cache.display()).resolves.toBeUndefined()
    await expect(cache.guard()).resolves.toBeUndefined()
  })

  test('a guard read that outlives one budget keeps waiting on the fold instead of restarting it', async () => {
    const pending = deferred<SessionActivity | undefined>()
    let reads = 0
    const cache = cacheOf(
      async () => {
        reads += 1
        return await pending.promise
      },
      { guardBudgetMs: 20, guardAttempts: 3 },
    )

    const guarded = cache.guard()
    await new Promise(done => setTimeout(done, 30))
    pending.resolve(activityOf('session-a', false))
    await expect(guarded).resolves.toEqual(activityOf('session-a', false))
    expect(reads).toBe(1)
  })

  test('a guard read that never settles reports unknown once every attempt elapsed', async () => {
    const cache = cacheOf(async () => await new Promise<SessionActivity | undefined>(() => undefined), {
      guardBudgetMs: 10,
      guardAttempts: 2,
    })

    await expect(cache.guard()).resolves.toBeUndefined()
  })

  test('a guard read that came back empty is read again within its attempts', async () => {
    let reads = 0
    const cache = cacheOf(async () => {
      reads += 1
      return reads === 1 ? undefined : activityOf('session-a', true)
    })

    await expect(cache.guard()).resolves.toEqual(activityOf('session-a', true))
    expect(reads).toBe(2)
  })

  test('a guard scan aborted at its ceiling is retried by the next guard', async () => {
    const cache = createSessionActivityCache({
      read: async signal =>
        await new Promise<SessionActivity | undefined>(resolve => {
          signal.addEventListener('abort', () => resolve(undefined), { once: true })
        }),
      ttlMs: 30_000,
      displayBudgetMs: 2_500,
      guardBudgetMs: 10,
      guardAttempts: 1,
      guardCeilingMs: 5,
    })

    await expect(cache.guard()).resolves.toBeUndefined()
    await expect(cache.guard()).resolves.toBeUndefined()
  })
})
