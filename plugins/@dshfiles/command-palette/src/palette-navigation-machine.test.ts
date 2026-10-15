import { createActor } from '@dshfiles/plugin-ui/machine'
import { expect, test } from 'vitest'
import { paletteNavigationMachine } from './palette-navigation-machine.js'

test('backs through prefixes and file destinations before requesting palette close', () => {
  const actor = createActor(paletteNavigationMachine, { input: { mode: 'all' } }).start()
  actor.send({ type: 'query.change', query: 'thread:session-missing' })

  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context.query).toBe('session-missing')
  expect(actor.getSnapshot().context.closeRequested).toBe(false)

  actor.send({ type: 'files.navigate' })
  expect(actor.getSnapshot().context.mode).toBe('files')
  expect(actor.getSnapshot().context.backStack).toEqual([{ mode: 'all', query: 'session-missing' }])

  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context.mode).toBe('all')
  expect(actor.getSnapshot().context.query).toBe('session-missing')
  expect(actor.getSnapshot().context.backStack).toEqual([])

  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context.query).toBe('')
  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context.closeRequested).toBe(true)
  actor.stop()
})

test('synchronizing the externally selected mode resets navigation state', () => {
  const actor = createActor(paletteNavigationMachine, { input: { mode: 'all' } }).start()
  actor.send({ type: 'query.change', query: 'thread:session-one' })
  actor.send({ type: 'files.navigate' })

  actor.send({ type: 'mode.sync', mode: 'threads' })

  expect(actor.getSnapshot().context).toMatchObject({ mode: 'threads', query: '', backStack: [], selected: '', notice: null, closeRequested: false })
  actor.stop()
})
