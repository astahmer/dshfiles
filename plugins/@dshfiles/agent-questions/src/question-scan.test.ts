import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import {
  QuestionScan,
  type SessionQuestionFacts,
  type SessionQuestionFactsCache,
  type SessionQuestionLoad,
  type SessionQuestionTarget,
} from './question-scan.js'
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

describe('shared session question reads', () => {
  it('shares one in-flight read among concurrent callers and keeps nothing afterwards', async () => {
    const reads = QuestionScan.createReads()
    let loads = 0
    let release: (() => void) | undefined
    const start = async (): Promise<SessionQuestionLoad> => {
      loads += 1
      await new Promise<void>(resolve => {
        release = resolve
      })
      return { facts: factsFor('s1'), projectionUnavailable: false }
    }
    const callers = Array.from({ length: 20 }, () => reads.read({ key: 's1', start }))
    expect(reads.inFlight).toBe(1)
    expect(loads).toBe(1)

    release?.()
    const results = await Promise.all(callers)
    expect(results.filter(result => result.facts !== undefined)).toHaveLength(20)
    expect(reads.inFlight).toBe(0)

    // Nothing is served from the settled read: the next caller starts a fresh one.
    await reads.read({
      key: 's1',
      start: async () => {
        loads += 1
        return { projectionUnavailable: false }
      },
    })
    expect(loads).toBe(2)
  })

  it('keeps a shared read alive for the callers that remain and cancels it with the last one', async () => {
    const reads = QuestionScan.createReads()
    const signals: AbortSignal[] = []
    let release: (() => void) | undefined
    const start = async (signal: AbortSignal): Promise<SessionQuestionLoad> =>
      new Promise<SessionQuestionLoad>((resolve, reject) => {
        signals.push(signal)
        signal.addEventListener('abort', () => reject(new Error('read aborted')), { once: true })
        release = () => resolve({ facts: factsFor('s1'), projectionUnavailable: false })
      })

    const first = new AbortController()
    const second = new AbortController()
    const firstRead = reads.read({ key: 's1', start, callerSignal: first.signal })
    const secondRead = reads.read({ key: 's1', start, callerSignal: second.signal })
    expect(signals).toHaveLength(1)

    first.abort()
    expect(signals[0]?.aborted).toBe(false)
    release?.()
    await expect(secondRead).resolves.toMatchObject({ projectionUnavailable: false })
    await expect(firstRead).resolves.toMatchObject({ projectionUnavailable: false })

    const solo = new AbortController()
    const soloRead = reads.read({ key: 's2', start, callerSignal: solo.signal })
    solo.abort()
    expect(signals[1]?.aborted).toBe(true)
    await expect(soloRead).rejects.toThrow('read aborted')
    expect(reads.inFlight).toBe(0)
  })

  it('reads a different availability scope separately', async () => {
    const reads = QuestionScan.createReads()
    const loaded: string[] = []
    const start = (key: string, sessionId: string) => async (): Promise<SessionQuestionLoad> => {
      loaded.push(key)
      return { facts: factsFor(sessionId), projectionUnavailable: false }
    }
    await Promise.all([
      reads.read({ key: 's1:false:true:false', start: start('s1:false:true:false', 's1') }),
      reads.read({ key: 's1:true:true:true', start: start('s1:true:true:true', 's1') }),
    ])
    expect(loaded).toEqual(['s1:false:true:false', 's1:true:true:true'])
    expect(reads.inFlight).toBe(0)
  })
})
