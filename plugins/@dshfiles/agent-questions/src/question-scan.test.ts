import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { QuestionScan, type SessionQuestionFacts, type SessionQuestionFactsCache, type SessionQuestionTarget } from './question-scan.js'
import { describe, expect, it } from 'vitest'

const target = (sessionId: string, sessionLive = false): SessionQuestionTarget => ({
  sessionId,
  sessionLive,
  sessionPersisted: true,
  targetIsLiveRoot: sessionLive,
})

const factsFor = (sessionId: string): SessionQuestionFacts => ({
  pending: [{ callId: ToolCallId(`call-${sessionId}`), state: 'open', questions: [{ id: 'decision', question: 'Which approach?' }] }],
  waits: [],
})

const recordingLoader = (loaded: string[]) => async (sessionTarget: SessionQuestionTarget) => {
  loaded.push(sessionTarget.sessionId)
  return { facts: factsFor(sessionTarget.sessionId), projectionUnavailable: false }
}

const scan = (input: {
  readonly targets: readonly SessionQuestionTarget[]
  readonly cache?: SessionQuestionFactsCache
  readonly load: (sessionTarget: SessionQuestionTarget) => Promise<{ readonly facts?: SessionQuestionFacts; readonly projectionUnavailable: boolean }>
  readonly now?: number
  readonly concurrency?: number
}) => {
  const request = {
    targets: input.targets,
    concurrency: input.concurrency ?? 4,
    now: input.now ?? 0,
    load: input.load,
  }
  return input.cache === undefined ? QuestionScan.scan(request) : QuestionScan.scan({ ...request, cache: input.cache })
}

describe('session question scans', () => {
  it('reuses a non-live Session instead of reading its projection again', async () => {
    const loaded: string[] = []
    const cache = QuestionScan.createFactsCache({ capacity: 8, ttlMs: 30_000 })
    const load = recordingLoader(loaded)

    const first = await scan({ targets: [target('paused-session')], cache, load, now: 1_000 })
    const second = await scan({ targets: [target('paused-session')], cache, load, now: 2_000 })

    expect(loaded).toEqual(['paused-session'])
    expect(first.reused).toBe(0)
    expect(second.reused).toBe(1)
    expect(second.reads[0]?.facts).toEqual(factsFor('paused-session'))
  })

  it('re-reads a live Session every scan because it can still change', async () => {
    const loaded: string[] = []
    const cache = QuestionScan.createFactsCache({ capacity: 8, ttlMs: 30_000 })
    const load = recordingLoader(loaded)

    await scan({ targets: [target('live-session', true)], cache, load, now: 1_000 })
    const second = await scan({ targets: [target('live-session', true)], cache, load, now: 2_000 })

    expect(loaded).toEqual(['live-session', 'live-session'])
    expect(second.reused).toBe(0)
    expect(cache.size).toBe(0)
  })

  it('reads a Session freshly again once its cached facts expire', async () => {
    const loaded: string[] = []
    const cache = QuestionScan.createFactsCache({ capacity: 8, ttlMs: 5_000 })
    const load = recordingLoader(loaded)

    await scan({ targets: [target('paused-session')], cache, load, now: 1_000 })
    const expired = await scan({ targets: [target('paused-session')], cache, load, now: 7_000 })

    expect(loaded).toEqual(['paused-session', 'paused-session'])
    expect(expired.reused).toBe(0)
  })

  it('stops reusing the least recently read Session past the cache capacity', async () => {
    const loaded: string[] = []
    const cache = QuestionScan.createFactsCache({ capacity: 1, ttlMs: 30_000 })
    const load = recordingLoader(loaded)

    await scan({ targets: [target('first-session')], cache, load, now: 1_000 })
    await scan({ targets: [target('second-session')], cache, load, now: 1_100 })
    const revisited = await scan({ targets: [target('first-session')], cache, load, now: 1_200 })

    expect(loaded).toEqual(['first-session', 'second-session', 'first-session'])
    expect(revisited.reused).toBe(0)
  })

  it('retries a Session whose projection could not be read instead of caching the gap', async () => {
    const loaded: string[] = []
    const cache = QuestionScan.createFactsCache({ capacity: 8, ttlMs: 30_000 })

    const first = await scan({
      targets: [target('corrupt-session')],
      cache,
      now: 1_000,
      load: async sessionTarget => {
        loaded.push(sessionTarget.sessionId)
        return { projectionUnavailable: true }
      },
    })
    const second = await scan({ targets: [target('corrupt-session')], cache, load: recordingLoader(loaded), now: 2_000 })

    expect(first.projectionUnavailable).toBe(1)
    expect(first.reused).toBe(0)
    expect(second.reused).toBe(0)
    expect(loaded).toEqual(['corrupt-session', 'corrupt-session'])
  })

  it('keeps cached facts attributable to their own Session', async () => {
    const cache = QuestionScan.createFactsCache({ capacity: 8, ttlMs: 30_000 })
    const load = recordingLoader([])

    await scan({ targets: [target('first-session'), target('second-session')], cache, load, now: 1_000 })
    const second = await scan({ targets: [target('second-session')], cache, load, now: 2_000 })

    expect(second.reads[0]?.facts?.pending[0]?.callId).toBe(ToolCallId('call-second-session'))
    expect(second.reused).toBe(1)
  })

  it('never runs more Session reads at once than the caller allows', async () => {
    let active = 0
    let peak = 0
    const result = await scan({
      targets: Array.from({ length: 9 }, (_value, index) => target(`session-${index}`, true)),
      concurrency: 3,
      load: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 1))
        active -= 1
        return { projectionUnavailable: false }
      },
    })

    expect(result.scanned).toBe(9)
    expect(peak).toBe(3)
  })
})
