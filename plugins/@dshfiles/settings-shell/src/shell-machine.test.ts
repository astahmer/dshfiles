import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { shellMachine } from './shell-machine.js'

const start = () => {
  const calls: string[] = []
  const actor = createActor(shellMachine, { input: { ports: { showPanel: () => calls.push('show'), leavePanel: () => calls.push('leave') } } })
  actor.start()
  return { actor, calls }
}

describe('settings shell machine', () => {
  it('opens the dialog on a section, expands it, and forgets the section on close', () => {
    const { actor, calls } = start()
    actor.send({ type: 'open', surface: 'modal', sectionId: 'models' })
    expect(actor.getSnapshot().value).toEqual({ modal: 'normal' })
    expect(actor.getSnapshot().context.sectionId).toBe('models')
    actor.send({ type: 'expand' })
    expect(actor.getSnapshot().value).toEqual({ modal: 'expanded' })
    actor.send({ type: 'close' })
    expect(actor.getSnapshot().value).toBe('closed')
    expect(actor.getSnapshot().context.sectionId).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('opens as a main-view tab and closes when the main view leaves it', () => {
    const { actor, calls } = start()
    actor.send({ type: 'open', surface: 'tab', sectionId: 'general' })
    expect(actor.getSnapshot().value).toBe('tab')
    expect(calls).toEqual(['show'])
    actor.send({ type: 'open', surface: 'modal', sectionId: 'models' })
    expect(actor.getSnapshot().value).toBe('tab')
    expect(actor.getSnapshot().context.sectionId).toBe('models')
    actor.send({ type: 'panel.hidden' })
    expect(actor.getSnapshot().value).toBe('closed')
  })

  it('follows the main view: showing the panel from a tab or a reload opens Settings there', () => {
    const { actor, calls } = start()
    actor.send({ type: 'panel.shown' })
    expect(actor.getSnapshot().value).toBe('tab')
    expect(calls).toEqual([])
    actor.send({ type: 'close' })
    expect(calls).toEqual(['leave'])
  })

  it('opens on a field and forgets it once the user picks another section', () => {
    const { actor } = start()
    actor.send({ type: 'open', surface: 'modal', field: { sectionId: 'plugin:thread-sidebar', fieldPath: ['maxChildren'] } })
    expect(actor.getSnapshot().context).toMatchObject({ sectionId: 'plugin:thread-sidebar', field: { fieldPath: ['maxChildren'] } })
    actor.send({ type: 'select', sectionId: 'general' })
    expect(actor.getSnapshot().context.field).toBeUndefined()
  })

  it('reveals a section entry from search, clearing the query, and drops the target on the next navigation', () => {
    const { actor } = start()
    actor.send({ type: 'open', surface: 'modal' })
    actor.send({ type: 'search', query: 'theme' })
    actor.send({ type: 'reveal', sectionId: 'appearance', target: 'theme' })
    expect(actor.getSnapshot().context).toMatchObject({ sectionId: 'appearance', target: 'theme', field: undefined, query: '' })
    actor.send({ type: 'select', sectionId: 'general' })
    expect(actor.getSnapshot().context.target).toBeUndefined()
    actor.send({ type: 'reveal', sectionId: 'appearance', target: 'theme' })
    actor.send({ type: 'focus', field: { sectionId: 'plugin:thread-sidebar', fieldPath: ['maxChildren'] } })
    expect(actor.getSnapshot().context.target).toBeUndefined()
  })

  it('opens a closed Settings at a section entry and forgets it on close', () => {
    const { actor, calls } = start()
    actor.send({ type: 'open', surface: 'tab', sectionId: 'appearance', target: 'theme' })
    expect(actor.getSnapshot().context).toMatchObject({ sectionId: 'appearance', target: 'theme' })
    expect(calls).toEqual(['show'])
    actor.send({ type: 'open', surface: 'modal', sectionId: 'models' })
    expect(actor.getSnapshot().context.target).toBeUndefined()
    actor.send({ type: 'open', surface: 'modal', target: 'orphan' })
    expect(actor.getSnapshot().context).toMatchObject({ sectionId: 'models', target: undefined })
    actor.send({ type: 'close' })
    expect(actor.getSnapshot().context.target).toBeUndefined()
  })

  it('keeps the query when the main view hides the tab and shows it again', () => {
    const { actor } = start()
    actor.send({ type: 'open', surface: 'tab' })
    actor.send({ type: 'search', query: 'max tabs' })
    actor.send({ type: 'panel.hidden' })
    expect(actor.getSnapshot().value).toBe('closed')
    expect(actor.getSnapshot().context.query).toBe('max tabs')
    actor.send({ type: 'panel.shown' })
    expect(actor.getSnapshot().value).toBe('tab')
    expect(actor.getSnapshot().context.query).toBe('max tabs')
  })

  it('keeps the query across sections opened without one, and drops it on close or a picked section', () => {
    const { actor } = start()
    actor.send({ type: 'open', surface: 'modal', query: 'archive' })
    expect(actor.getSnapshot().context.query).toBe('archive')
    actor.send({ type: 'search', query: 'tabs' })
    actor.send({ type: 'open', surface: 'modal' })
    expect(actor.getSnapshot().context.query).toBe('tabs')
    actor.send({ type: 'open', surface: 'modal', sectionId: 'models' })
    expect(actor.getSnapshot().context.query).toBe('')
    actor.send({ type: 'search', query: 'tabs' })
    actor.send({ type: 'close' })
    expect(actor.getSnapshot().context.query).toBe('')
  })

  it('moves an open dialog into a tab, keeping its section', () => {
    const { actor, calls } = start()
    actor.send({ type: 'open', surface: 'modal', sectionId: 'plugins' })
    actor.send({ type: 'moveToTab' })
    expect(actor.getSnapshot().value).toBe('tab')
    expect(actor.getSnapshot().context.sectionId).toBe('plugins')
    expect(calls).toEqual(['show'])
  })

  it('drills into a side-panel section and goes back to the section list', () => {
    const { actor, calls } = start()
    actor.send({ type: 'select', sectionId: 'models' })
    actor.send({ type: 'search', query: 'tab' })
    expect(actor.getSnapshot().value).toBe('closed')
    expect(actor.getSnapshot().context).toMatchObject({ sectionId: 'models', query: 'tab' })
    actor.send({ type: 'back' })
    expect(actor.getSnapshot().value).toBe('closed')
    expect(actor.getSnapshot().context).toMatchObject({ sectionId: undefined, query: '' })
    expect(calls).toEqual([])
  })
})
