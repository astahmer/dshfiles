import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { expect, test } from 'vitest'
import type { PaletteAction, PaletteActionContext } from './palette-contract.js'
import { paletteActionMachine } from './palette-action-machine.js'

const context: PaletteActionContext = { thread: null, workspace: null, workspaces: [], themePreference: 'system' }

const action = (run: PaletteAction['run']): PaletteAction => ({ id: '@dshfiles/test/run', label: 'Run', run })

const deferred = () => {
  let resolve = (): void => {}
  const promise = new Promise<void>(onResolve => {
    resolve = onResolve
  })
  return { promise, resolve }
}

test('runs an action and emits completion after its promise resolves', async () => {
  let completed = false
  const actor = createActor(paletteActionMachine).start()
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
  const actor = createActor(paletteActionMachine).start()
  actor.send({ type: 'run', action: action(() => Promise.reject(new Error('unavailable'))), context })
  await waitFor(actor, snapshot => snapshot.matches('failed'))

  actor.send({ type: 'run', action: action(() => undefined), context })
  await waitFor(actor, snapshot => snapshot.matches('succeeded'))
  actor.stop()
})

test('ignores a stale action completion after reset', async () => {
  const request = deferred()
  const actor = createActor(paletteActionMachine).start()
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
