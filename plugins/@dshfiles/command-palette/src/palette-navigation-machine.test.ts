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

test('resets selection and notice on changes and rearms handled close requests', () => {
  const actor = createActor(paletteNavigationMachine, { input: { mode: 'all' } }).start()
  actor.send({ type: 'query.change', query: 'session-one' })
  actor.send({ type: 'selection.change', value: 'row-one' })
  actor.send({ type: 'notice.show', message: 'Old notice.' })

  actor.send({ type: 'mode.change', mode: 'threads' })
  expect(actor.getSnapshot().context).toMatchObject({ mode: 'threads', query: 'session-one', selected: '', notice: null })

  actor.send({ type: 'selection.change', value: 'row-two' })
  actor.send({ type: 'notice.show', message: 'Search failed.' })
  actor.send({ type: 'query.change', query: 'session-two' })
  expect(actor.getSnapshot().context).toMatchObject({ query: 'session-two', selected: '', notice: null })

  actor.send({ type: 'notice.show', message: 'File search failed.' })
  expect(actor.getSnapshot().context.notice).toBe('File search failed.')
  actor.send({ type: 'notice.clear' })
  expect(actor.getSnapshot().context.notice).toBeNull()

  actor.send({ type: 'query.change', query: '' })
  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context.closeRequested).toBe(true)
  actor.send({ type: 'close.handled' })
  expect(actor.getSnapshot().context.closeRequested).toBe(false)
  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context.closeRequested).toBe(true)
  actor.stop()
})

test('entering Ask DSH clears the query and Escape leaves it before closing the palette', () => {
  const actor = createActor(paletteNavigationMachine, { input: { mode: 'all' } }).start()
  actor.send({ type: 'query.change', query: 'thread:session-one' })

  actor.send({ type: 'back' })
  actor.send({ type: 'ask.enter' })
  expect(actor.getSnapshot().context).toMatchObject({ ask: true, query: '', closeRequested: false })

  actor.send({ type: 'query.change', query: 'how do I rebind a shortcut?' })
  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context).toMatchObject({ ask: true, query: '', closeRequested: false })

  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context).toMatchObject({ ask: false, closeRequested: false })

  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context.closeRequested).toBe(true)
  actor.stop()
})

test('leaving Ask DSH explicitly and changing mode both restore search', () => {
  const actor = createActor(paletteNavigationMachine, { input: { mode: 'all' } }).start()
  actor.send({ type: 'ask.enter' })
  actor.send({ type: 'ask.exit' })
  expect(actor.getSnapshot().context.ask).toBe(false)

  actor.send({ type: 'ask.enter' })
  actor.send({ type: 'mode.change', mode: 'threads' })
  expect(actor.getSnapshot().context).toMatchObject({ ask: false, mode: 'threads' })

  actor.send({ type: 'ask.enter' })
  actor.send({ type: 'files.navigate' })
  expect(actor.getSnapshot().context).toMatchObject({ ask: false, mode: 'files' })
  actor.stop()
})

test('Ask DSH treats palette prefixes as question text', () => {
  const actor = createActor(paletteNavigationMachine, { input: { mode: 'all' } }).start()
  actor.send({ type: 'ask.enter' })
  actor.send({ type: 'query.change', query: '> how do commands work?' })

  actor.send({ type: 'back' })
  expect(actor.getSnapshot().context).toMatchObject({ ask: true, query: '', closeRequested: false })
  actor.stop()
})
