import { describe, expect, it } from 'vitest'
import { createWaterfallRequest, type QuestionWaterfallChannel, type QuestionWaterfallRequest } from '../src/native/contract/slots.js'
import { createForegroundRequest, type ClaimFrame } from '../src/foreground-request.js'

type Frame = IteratorResult<ClaimFrame>

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

const flush = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

const answer = { answers: [{ id: 'q1', selected: ['A'] }] }

/** The Host claim as the Remote stream spells it: frames arrive in order and the cancel ends its pending frame. */
const createFrames = () => {
  const queue: { readonly frame: ReturnType<typeof deferred<Frame>>; settled: boolean }[] = []
  const next = (): Promise<Frame> => {
    const frame = deferred<Frame>()
    const entry = { frame, settled: false }
    queue.push(entry)
    return frame.promise.finally(() => {
      entry.settled = true
    })
  }
  return {
    next,
    queue,
    /** Cancel the stream: the open frame ends as done, as a released claim does. */
    close: () => {
      for (const entry of queue) {
        if (entry.settled) continue
        entry.settled = true
        entry.frame.resolve({ done: true, value: undefined })
      }
    },
  }
}

const createHarness = (
  options: {
    readonly claim?: boolean
    readonly callId?: string | undefined
    readonly signal?: AbortSignal
  } = {},
) => {
  const calls: string[] = []
  const labels: string[] = []
  const frames = createFrames()
  const attached: QuestionWaterfallChannel[] = []
  const waterfalls: QuestionWaterfallRequest[] = []
  let tracked: Promise<void> | undefined
  const handle = {
    [Symbol.asyncIterator]: () => ({ next: frames.next }),
    dispose: () => {
      calls.push('dispose')
      frames.close()
    },
  }
  const request = createForegroundRequest({
    callId: 'callId' in options ? options.callId : 'call-1',
    signal: options.signal,
    claim:
      options.claim === false
        ? undefined
        : {
            attach: () => handle,
            own: (body, label) => {
              labels.push(label)
              const releaseClaim = body()
              return async () => {
                calls.push('release')
                await releaseClaim()
              }
            },
          },
    next: async () => {
      calls.push('next')
      return answer
    },
    createWaterfall: ({ remainingMs, signal }) => {
      const waterfall = createWaterfallRequest(remainingMs === undefined ? undefined : Date.now() + remainingMs, signal, () => {
        calls.push('detach')
      })
      waterfalls.push(waterfall)
      return waterfall
    },
    card: {
      attachWaterfall: channel => {
        calls.push('attach')
        attached.push(channel)
      },
      remove: () => {
        calls.push('remove')
      },
      trackRequest: completion => {
        calls.push('track')
        tracked = completion
        return () => {
          calls.push('finish-request')
        }
      },
    },
  })
  return { calls, labels, frames, attached, waterfalls, request, tracked: () => tracked }
}

const reasonOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    value => value,
    (reason: unknown) => reason,
  )

describe('foreground question request', () => {
  it('presents the waterfall and releases the claim only after the Host closes it', async () => {
    const harness = createHarness()
    const answering = harness.request()
    await flush()
    harness.frames.queue[0]?.frame.resolve({ done: false, value: { remainingMs: 4_000 } })
    await flush()
    expect(harness.attached).toHaveLength(1)
    expect(harness.waterfalls[0]?.channel.deadline).toBeGreaterThan(Date.now())

    harness.attached[0]?.resolve(answer)
    await expect(answering).resolves.toEqual(answer)
    expect(harness.calls).toEqual(['track', 'attach', 'detach', 'finish-request'])

    harness.frames.close()
    await flush()
    expect(harness.calls).toEqual(['track', 'attach', 'detach', 'finish-request', 'release', 'dispose'])
    expect(harness.labels).toEqual(['ui-user-questions: foreground claim'])
  })

  it('hands the request on and releases the claim before the next listener answers', async () => {
    const harness = createHarness()
    const answering = harness.request()
    await flush()
    harness.frames.queue[0]?.frame.resolve({ done: false, value: { remainingMs: 4_000 } })
    await flush()

    harness.attached[0]?.delegate()
    await expect(answering).resolves.toEqual(answer)
    expect(harness.calls).toEqual(['track', 'attach', 'detach', 'release', 'dispose', 'next', 'finish-request'])
  })

  it('fails when the Host closes the claim first, and hands its waterfall on before releasing', async () => {
    const harness = createHarness()
    const answering = harness.request()
    await flush()
    harness.frames.queue[0]?.frame.resolve({ done: false, value: { remainingMs: 4_000 } })
    await flush()

    harness.frames.close()
    await expect(answering).rejects.toThrow('the foreground question wait ended')
    await flush()
    expect(harness.calls).toEqual(['track', 'attach', 'finish-request', 'release', 'detach', 'dispose'])
    const waterfall = harness.waterfalls[0] as QuestionWaterfallRequest
    expect(waterfall.isDelegation(await reasonOf(waterfall.result))).toBe(true)
  })

  it('calls the next listener when the claim opens already done, then releases it', async () => {
    const harness = createHarness()
    const answering = harness.request()
    await flush()
    harness.frames.queue[0]?.frame.resolve({ done: true, value: undefined })

    await expect(answering).resolves.toEqual(answer)
    expect(harness.attached).toEqual([])
    expect(harness.calls).toEqual(['track', 'next', 'release', 'dispose', 'finish-request'])
  })

  it('never attaches a waterfall cancelled between its opening frame and its presentation', async () => {
    const cancellation = new AbortController()
    const harness = createHarness({ signal: cancellation.signal })
    const answering = harness.request()
    await flush()
    harness.frames.queue[0]?.frame.resolve({ done: false, value: { remainingMs: 4_000 } })
    cancellation.abort()

    await expect(answering).rejects.toMatchObject({ name: 'UserQuestionError', code: 'ASK_ABORTED' })
    expect(harness.attached).toEqual([])
    expect(harness.calls).toEqual(['track', 'detach', 'release', 'dispose', 'finish-request'])
  })

  it('answers a blocking request without a claim and drops its card with its waterfall', async () => {
    const harness = createHarness({ claim: false, callId: undefined })
    const answering = harness.request()
    await flush()
    expect(harness.waterfalls[0]?.channel.deadline).toBeUndefined()

    harness.attached[0]?.resolve(answer)
    await expect(answering).resolves.toEqual(answer)
    expect(harness.calls).toEqual(['track', 'attach', 'detach', 'remove', 'finish-request'])
    await expect(harness.tracked()).resolves.toBeUndefined()
  })
})
