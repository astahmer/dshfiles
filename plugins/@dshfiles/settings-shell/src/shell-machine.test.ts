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

  it('moves an open dialog into a tab, keeping its section', () => {
    const { actor, calls } = start()
    actor.send({ type: 'open', surface: 'modal', sectionId: 'plugins' })
    actor.send({ type: 'moveToTab' })
    expect(actor.getSnapshot().value).toBe('tab')
    expect(actor.getSnapshot().context.sectionId).toBe('plugins')
    expect(calls).toEqual(['show'])
  })
})
