import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Queue, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { PullRequestRefreshTriggers, type ThreadEvent } from '../src/refresh-triggers.js'

const { make: makeRefreshTriggers, refreshOnThreadEvents, sweepWatched } = PullRequestRefreshTriggers

/** A Session event keeps its payload: `ThreadEvent` names only the `type` every event carries. */
const threadEvent = (sessionId: string, event: ThreadEvent['event']): ThreadEvent => ({ sessionId, event })

const call = (sessionId: string, callId: string, command: string): ThreadEvent => {
  const event = { type: 'tool/call', data: { callId, name: 'bash', arguments: JSON.stringify({ command }) } }
  return threadEvent(sessionId, event)
}
const result = (sessionId: string, callId: string): ThreadEvent => {
  const event = { type: 'tool/result', data: { message: { toolCallId: callId } } }
  return threadEvent(sessionId, event)
}
const turnEnd = (sessionId: string, kind = 'completed', reason?: string): ThreadEvent => {
  const event = { type: 'turn/end', data: { reason: reason === undefined ? { kind } : { kind, reason: { kind: reason } } } }
  return threadEvent(sessionId, event)
}

/** Lets the forked listener move every offered event into its burst before the test clock moves. */
const drained = Effect.repeat(Effect.yieldNow, { times: 10 })

/** A monitor that counts `gh pr view` calls the way the real one makes them: one per watched pull request per pass. */
const countingMonitor = (watchedBySession: ReadonlyMap<string, readonly string[]>) => {
  const ghCalls: string[] = []
  const pullRequests = [...new Set([...watchedBySession.values()].flat())]
  return {
    ghCalls,
    monitor: {
      pollAll: Effect.sync(() => void ghCalls.push(...pullRequests)),
      refresh: (input: { readonly sessionIds: readonly string[] }) =>
        Effect.sync(() => {
          const due = [...new Set(input.sessionIds.flatMap(sessionId => watchedBySession.get(sessionId) ?? []))]
          ghCalls.push(...due)
          return due.length
        }),
    },
  }
}

describe('pull-request refresh triggers', () => {
  it('a publishing command refreshes its thread when its result returns; other commands do not', () => {
    const triggerOf = makeRefreshTriggers()
    expect(triggerOf(call('a', 'c1', 'jj git push --bookmark feat'))).toBeNull()
    expect(triggerOf(result('a', 'c1'))).toBe('a')
    expect(triggerOf(result('a', 'c1'))).toBeNull()
    for (const command of ['git push origin HEAD', 'gh pr create --fill', 'gh pr merge 7', 'glab mr create']) {
      expect(triggerOf(call('b', command, command))).toBeNull()
      expect(triggerOf(result('b', command))).toBe('b')
    }
    expect(triggerOf(call('c', 'c2', 'jj log -r @'))).toBeNull()
    expect(triggerOf(result('c', 'c2'))).toBeNull()
  })

  it('a turn end refreshes its thread, except one the Host shutdown disposed', () => {
    const triggerOf = makeRefreshTriggers()
    expect(triggerOf(turnEnd('a'))).toBe('a')
    expect(triggerOf(turnEnd('a', 'error'))).toBe('a')
    expect(triggerOf(turnEnd('a', 'aborted', 'disposed'))).toBeNull()
    expect(triggerOf({ sessionId: 'a', event: { type: 'turn/start' } })).toBeNull()
  })

  it.effect('a push and the turn end after it cost one refresh, seconds later instead of at the next sweep', () =>
    Effect.gen(function* () {
      const { monitor, ghCalls } = countingMonitor(new Map([['thread-a', ['acme/widget#7']]]))
      const events = yield* Queue.unbounded<ThreadEvent>()
      const fiber = yield* Effect.forkChild(refreshOnThreadEvents({ monitor, events: Stream.fromQueue(events) }))
      yield* Queue.offerAll(events, [call('thread-a', 'c1', 'jj git push -b feat'), result('thread-a', 'c1'), turnEnd('thread-a'), turnEnd('thread-b')])
      yield* drained
      yield* TestClock.adjust(Duration.seconds(3))
      expect(ghCalls).toEqual(['acme/widget#7'])
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect('the settings switch event refresh off and set its debounce, read for every burst', () =>
    Effect.gen(function* () {
      const { monitor, ghCalls } = countingMonitor(new Map([['thread-a', ['acme/widget#7']]]))
      const events = yield* Queue.unbounded<ThreadEvent>()
      let config = { enabled: false, debounce: Duration.seconds(10) }
      const fiber = yield* Effect.forkChild(refreshOnThreadEvents({ monitor, events: Stream.fromQueue(events), config: Effect.sync(() => config) }))
      yield* Queue.offer(events, turnEnd('thread-a'))
      yield* drained
      yield* TestClock.adjust(Duration.seconds(10))
      expect(ghCalls).toEqual([])

      config = { enabled: true, debounce: Duration.seconds(10) }
      yield* Queue.offer(events, turnEnd('thread-a'))
      yield* drained
      yield* TestClock.adjust(Duration.seconds(9))
      expect(ghCalls).toEqual([])
      yield* TestClock.adjust(Duration.seconds(1))
      expect(ghCalls).toEqual(['acme/widget#7'])
      yield* Fiber.interrupt(fiber)
    }),
  )

  /**
   * The probe behind the README's numbers: five watched pull requests over one hour with two pushes. Before, a two-minute
   * sweep was the only path (150 `gh pr view` calls, a push seen up to two minutes late); after, a ten-minute sweep plus
   * the event refreshes (32 calls, each push seen within the three-second debounce).
   */
  it.effect('one hour, five watched pull requests, two pushes: gh calls before and after', () =>
    Effect.gen(function* () {
      const watched = new Map([
        ['thread-a', ['acme/widget#1']],
        ['thread-b', ['acme/widget#2']],
        ['thread-c', ['acme/widget#3']],
        ['thread-d', ['acme/widget#4']],
        ['thread-e', ['acme/widget#5']],
      ])
      const callsOver = (sweep: Duration.Input, withEvents: boolean) =>
        Effect.gen(function* () {
          const { monitor, ghCalls } = countingMonitor(watched)
          const events = yield* Queue.unbounded<ThreadEvent>()
          const sweeper = yield* Effect.forkChild(sweepWatched({ monitor, every: Effect.succeed(sweep) }))
          const listener = withEvents ? yield* Effect.forkChild(refreshOnThreadEvents({ monitor, events: Stream.fromQueue(events) })) : undefined
          for (const minute of [17, 41]) {
            yield* TestClock.adjust(Duration.minutes(minute === 17 ? 17 : 24))
            yield* Queue.offerAll(events, [call('thread-a', `push-${String(minute)}`, 'jj git push'), result('thread-a', `push-${String(minute)}`)])
            yield* drained
            const before = ghCalls.length
            yield* TestClock.adjust(Duration.seconds(3))
            if (withEvents) expect(ghCalls.slice(before)).toEqual(['acme/widget#1'])
          }
          yield* TestClock.adjust(Duration.minutes(60 - 41).pipe(Duration.subtract(Duration.seconds(7))))
          yield* Fiber.interrupt(sweeper)
          if (listener !== undefined) yield* Fiber.interrupt(listener)
          return ghCalls.length
        })
      expect(yield* callsOver(Duration.minutes(2), false)).toBe(150)
      expect(yield* callsOver(Duration.minutes(10), true)).toBe(32)
    }),
  )
})
