import { describe, expect, it } from 'vitest'
import { TaskQueue, type QueuedTask } from './file-upload-queue.js'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

const task = (started: string[], name: string, settled: string[]): QueuedTask => {
  const gate = deferred()
  return {
    start: async () => {
      started.push(name)
      await gate.promise
    },
    settle: () => {
      settled.push(name)
    },
  }
}

const flush = async (): Promise<void> => {
  await Promise.resolve()
}

describe('task queue', () => {
  it('starts a task immediately while a slot is free', async () => {
    const started: string[] = []
    const settled: string[] = []
    const queue = new TaskQueue(2)
    queue.push(task(started, 'a', settled))
    await flush()
    expect(started).toEqual(['a'])
    expect(queue.waitingCount).toBe(0)
  })

  it('leaves a task waiting until a running one frees its slot', async () => {
    const started: string[] = []
    const settled: string[] = []
    const queue = new TaskQueue(1)
    queue.push(task(started, 'a', settled))
    queue.push(task(started, 'b', settled))
    await flush()
    expect(started).toEqual(['a'])
    expect(queue.waitingCount).toBe(1)

    queue.clear()
    expect(queue.waitingCount).toBe(0)
  })

  it('settles a finished task and starts the next waiting one', async () => {
    const started: string[] = []
    const settled: string[] = []
    const queue = new TaskQueue(1)
    const gates = { a: deferred(), b: deferred() }
    const queued = (name: 'a' | 'b'): QueuedTask => ({
      start: async () => {
        started.push(name)
        await gates[name].promise
      },
      settle: () => {
        settled.push(name)
      },
    })
    queue.push(queued('a'))
    queue.push(queued('b'))
    await flush()
    expect(settled).toEqual([])

    gates.a.resolve()
    await flush()
    await flush()
    expect(settled).toEqual(['a'])
    expect(started).toEqual(['a', 'b'])

    gates.b.resolve()
    await flush()
    await flush()
    expect(settled).toEqual(['a', 'b'])
  })
})
