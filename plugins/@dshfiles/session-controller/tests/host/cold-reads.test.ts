import { expect, it } from 'vitest'
import { createColdReads } from '../../src/native/cold-reads.ts'

const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

it('runs no more than its permits at once and hands each release to the next waiter', async () => {
  const coldReads = createColdReads(2)
  const gates = [deferred(), deferred(), deferred()]
  const running: number[] = []
  const started = gates.map((gate, index) =>
    coldReads.use(async () => {
      running.push(index)
      await gate.promise
      running.splice(running.indexOf(index), 1)
    }),
  )

  await Promise.resolve()
  expect(running).toEqual([0, 1])
  gates[0]?.resolve()
  await started[0]
  expect(running).toEqual([1, 2])
  gates[1]?.resolve()
  gates[2]?.resolve()
  await Promise.all(started)
  expect(running).toEqual([])
})

it('releases the permit when the work throws', async () => {
  const coldReads = createColdReads(1)
  await expect(
    coldReads.use(async () => {
      throw new Error('read failed')
    }),
  ).rejects.toThrow('read failed')
  await expect(coldReads.use(async () => 'served')).resolves.toBe('served')
})
