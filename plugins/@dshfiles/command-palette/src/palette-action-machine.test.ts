import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { expect, test } from 'vitest'
import type { PaletteAction, PaletteActionContext } from './palette-contract.js'
import { paletteActionMachine } from './palette-action-machine.js'

const context: PaletteActionContext = { thread: null, workspace: null, workspaces: [], themePreference: 'system' }

const action = (run: PaletteAction['run']): PaletteAction => ({ id: '@dshfiles/test/run', label: 'Run', run })

const start = (ask: (question: string) => Promise<void> = async () => undefined) => createActor(paletteActionMachine, { input: { ask } }).start()

const deferred = () => {
  let resolve = (): void => {}
  const promise = new Promise<void>(onResolve => {
    resolve = onResolve
  })
  return { promise, resolve }
}

test('runs an action and emits completion after its promise resolves', async () => {
  let completed = false
  const actor = start()
  actor.send({
    type: 'run',
    action: action(() => {
      completed = true
    }),
    context,
  })

  await waitFor(actor, snapshot => snapshot.matches('succeeded'))

  expect(completed).toBe(true)
  actor.stop()
})

test('reports rejection and accepts a retry', async () => {
  const actor = start()
  actor.send({ type: 'run', action: action(() => Promise.reject(new Error('unavailable'))), context })
  await waitFor(actor, snapshot => snapshot.matches('failed'))

  actor.send({ type: 'run', action: action(() => undefined), context })
  await waitFor(actor, snapshot => snapshot.matches('succeeded'))
  actor.stop()
})

test('ignores a stale action completion after reset', async () => {
  const request = deferred()
  const actor = start()
  actor.send({ type: 'run', action: action(() => request.promise), context })
  await waitFor(actor, snapshot => snapshot.matches('running'))

  actor.send({ type: 'reset' })
  expect(actor.getSnapshot().matches('idle')).toBe(true)
  request.resolve()
  await request.promise
  await Promise.resolve()

  expect(actor.getSnapshot().matches('idle')).toBe(true)
  actor.stop()
})

test('asks one question, stays pending while it is sent, then emits completion', async () => {
  const request = deferred()
  const asked: string[] = []
  const actor = start(async question => {
    asked.push(question)
    await request.promise
  })
  let completed = 0
  actor.on('completed', () => {
    completed += 1
  })

  actor.send({ type: 'ask', question: 'how do I rebind a shortcut?' })
  expect(actor.getSnapshot().matches('asking')).toBe(true)
  expect(asked).toEqual(['how do I rebind a shortcut?'])

  actor.send({ type: 'ask', question: 'a second question while the first is in flight' })
  expect(asked).toEqual(['how do I rebind a shortcut?'])

  request.resolve()
  await waitFor(actor, snapshot => snapshot.matches('succeeded'))
  expect(completed).toBe(1)
  actor.stop()
})

test('reports a refused question, returns to idle, and accepts a retry', async () => {
  let attempts = 0
  const actor = start(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('no model is available')
  })
  let failures = 0
  actor.on('askFailed', () => {
    failures += 1
  })

  actor.send({ type: 'ask', question: 'hello?' })
  await waitFor(actor, snapshot => snapshot.matches('idle'))

  expect(failures).toBe(1)
  expect(actor.getSnapshot().context.question).toBeNull()

  actor.send({ type: 'ask', question: 'hello?' })
  await waitFor(actor, snapshot => snapshot.matches('succeeded'))
  expect(attempts).toBe(2)
  actor.stop()
})

test('drops a question that resolves after reset', async () => {
  const request = deferred()
  const actor = start(() => request.promise)
  let completed = 0
  actor.on('completed', () => {
    completed += 1
  })

  actor.send({ type: 'ask', question: 'still there?' })
  actor.send({ type: 'reset' })
  expect(actor.getSnapshot().matches('idle')).toBe(true)

  request.resolve()
  await request.promise
  await Promise.resolve()

  expect(actor.getSnapshot().matches('idle')).toBe(true)
  expect(completed).toBe(0)
  actor.stop()
})
