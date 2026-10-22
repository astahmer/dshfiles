import { describe, expect, it } from 'vitest'
import { ThreadStatusWarmup } from './thread-status-warmup.js'

/** Lets the started read settle so the next schedule sees no read in flight. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const createWarmup = (options: { readonly intervalMs?: number; readonly fail?: Error } = {}) => {
  const reads: string[] = []
  const failures: unknown[] = []
  let clock = 0
  const warmup = new ThreadStatusWarmup({
    read: path => {
      reads.push(path)
      return options.fail === undefined ? Promise.resolve(undefined) : Promise.reject(options.fail)
    },
    now: () => clock,
    intervalMs: options.intervalMs ?? 750,
    report: error => failures.push(error),
  })
  return {
    warmup,
    reads,
    failures,
    tick: (ms: number) => {
      clock += ms
    },
  }
}

describe('thread status warmup', () => {
  it('reads once per throttle window and again after it', async () => {
    const { warmup, reads, tick } = createWarmup()
    warmup.schedule('/repo-threads/thread-a')
    warmup.schedule('/repo-threads/thread-a')
    expect(reads).toEqual(['/repo-threads/thread-a'])
    await settle()
    tick(400)
    warmup.schedule('/repo-threads/thread-a')
    expect(reads).toHaveLength(1)
    tick(400)
    warmup.schedule('/repo-threads/thread-a')
    expect(reads).toHaveLength(2)
  })

  it('reads each workspace on its own throttle', () => {
    const { warmup, reads } = createWarmup()
    warmup.schedule('/repo-threads/thread-a')
    warmup.schedule('/repo-threads/thread-b')
    expect(reads).toEqual(['/repo-threads/thread-a', '/repo-threads/thread-b'])
  })

  it('keeps one read in flight per workspace', () => {
    const { warmup, reads } = createWarmup()
    warmup.schedule('/repo-threads/thread-a')
    warmup.schedule('/repo-threads/thread-a')
    expect(reads).toHaveLength(1)
  })

  it('reports a failed read instead of rejecting into the session event', async () => {
    const failure = new Error('jj failed')
    const { warmup, failures } = createWarmup({ fail: failure })
    warmup.schedule('/repo-threads/thread-a')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(failures).toEqual([failure])
  })

  it('stops scheduling once disposed', () => {
    const { warmup, reads, tick } = createWarmup()
    warmup.schedule('/repo-threads/thread-a')
    warmup.dispose()
    tick(2_000)
    warmup.schedule('/repo-threads/thread-a')
    expect(reads).toHaveLength(1)
  })
})
