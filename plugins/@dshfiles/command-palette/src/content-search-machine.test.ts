import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { expect, test } from 'vitest'
import type { ContentHit } from './palette.js'
import { contentSearchMachine } from './content-search-machine.js'

const staleHit: ContentHit = { sessionId: 'thread-stale', snippet: 'old result' }
const currentHit: ContentHit = { sessionId: 'thread-current', snippet: 'new result' }

const deferred = <Value>() => {
  let resolve = (_value: Value): void => {}
  const promise = new Promise<Value>(onResolve => {
    resolve = onResolve
  })
  return { promise, resolve }
}

test('cancels replaced searches and ignores late stale results', async () => {
  const requests: { readonly query: string; readonly signal: AbortSignal; readonly result: ReturnType<typeof deferred<readonly ContentHit[]>> }[] = []
  const actor = createActor(contentSearchMachine, {
    input: {
      client: {
        search: (query, signal) => {
          const result = deferred<readonly ContentHit[]>()
          requests.push({ query, signal, result })
          return result.promise
        },
      },
    },
  }).start()

  actor.send({ type: 'query.change', query: 'stale', available: true })
  await waitFor(actor, () => requests.length === 1)
  actor.send({ type: 'query.change', query: 'current', available: true })
  await waitFor(actor, () => requests.length === 2)

  expect(requests[0]?.signal.aborted).toBe(true)
  expect(requests[1]?.query).toBe('current')
  requests[0]?.result.resolve([staleHit])
  await Promise.resolve()
  expect(actor.getSnapshot().context.state.status).toBe('searching')

  requests[1]?.result.resolve([currentHit])
  await waitFor(actor, snapshot => snapshot.context.state.status === 'done')
  expect(actor.getSnapshot().context.state.hits).toEqual([currentHit])
  actor.stop()
})

test('refreshes an empty result when the Host session source advances', async () => {
  const requests: ReturnType<typeof deferred<readonly ContentHit[]>>[] = []
  const actor = createActor(contentSearchMachine, {
    input: {
      client: {
        search: () => {
          const result = deferred<readonly ContentHit[]>()
          requests.push(result)
          return result.promise
        },
      },
    },
  }).start()

  actor.send({ type: 'query.change', query: 'fresh-message', available: true })
  await waitFor(actor, () => requests.length === 1)
  requests[0]?.resolve([])
  await waitFor(actor, snapshot => snapshot.context.state.status === 'done')

  actor.send({ type: 'query.refresh' })
  await waitFor(actor, () => requests.length === 2)
  requests[1]?.resolve([currentHit])
  await waitFor(actor, snapshot => snapshot.context.state.status === 'done' && snapshot.context.state.hits.length === 1)

  expect(actor.getSnapshot().context.state.hits).toEqual([currentHit])
  actor.stop()
})

test('clearing the query cancels work and failures can be retried', async () => {
  let signal: AbortSignal | undefined
  let attempts = 0
  const actor = createActor(contentSearchMachine, {
    input: {
      client: {
        search: (_query, currentSignal) => {
          attempts += 1
          signal = currentSignal
          if (attempts === 1) return new Promise<readonly ContentHit[]>(() => {})
          return Promise.reject(new Error('search unavailable'))
        },
      },
    },
  }).start()

  actor.send({ type: 'query.change', query: 'review', available: true })
  await waitFor(actor, snapshot => snapshot.matches('searching'))
  actor.send({ type: 'query.change', query: '', available: true })
  expect(signal?.aborted).toBe(true)
  expect(actor.getSnapshot().context.state).toEqual({ status: 'idle', hits: [] })

  actor.send({ type: 'query.change', query: 'retry', available: true })
  await waitFor(actor, snapshot => snapshot.context.state.status === 'failed')
  expect(attempts).toBe(2)
  actor.stop()
})
