import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { threadDragMachine } from './thread-drag-machine.js'

const startMachine = () => {
  const moves: { readonly sessionId: string; readonly section: string }[] = []
  const commits: { readonly from: number; readonly to: number }[] = []
  const actor = createActor(threadDragMachine, {
    input: {
      moveToSection: input => {
        moves.push(input)
      },
      commitSectionOrder: input => {
        commits.push(input)
      },
    },
  }).start()
  return { actor, moves, commits }
}

const rowOf = () => ({ kind: 'local' as const, sessionId: 'thread-a', section: 'active' as const })

describe('thread drag machine', () => {
  it('keeps a row drag and a section gesture from running at once', () => {
    const { actor } = startMachine()
    actor.send({ type: 'row.start', row: rowOf() })
    expect(actor.getSnapshot().matches('rows')).toBe(true)

    actor.send({ type: 'section.press', pointerId: 1, from: 0, startY: 10 })
    expect(actor.getSnapshot().matches('rows')).toBe(true)
    expect(actor.getSnapshot().context.section).toBeNull()

    actor.send({ type: 'row.end' })
    actor.send({ type: 'section.press', pointerId: 1, from: 0, startY: 10 })
    expect(actor.getSnapshot().matches('pressing')).toBe(true)

    actor.send({ type: 'row.start', row: rowOf() })
    expect(actor.getSnapshot().matches('pressing')).toBe(true)
  })

  it('moves a row dropped on another section once, then suppresses that drop click', () => {
    const { actor, moves } = startMachine()
    actor.send({ type: 'row.start', row: rowOf() })
    actor.send({ type: 'row.over', section: 'inactive' })
    actor.send({ type: 'row.drop', section: 'inactive' })

    expect(moves).toEqual([{ kind: 'local', sessionId: 'thread-a', section: 'inactive' }])
    expect(actor.getSnapshot().matches('suppressing')).toBe(true)
    expect(actor.getSnapshot().context.suppressed).toBe('row')

    actor.send({ type: 'row.over', section: 'active' })
    expect(actor.getSnapshot().context.suppressed).toBe('row')
  })

  it('suppresses the click of a row dropped back on its own section without moving it', () => {
    const { actor, moves } = startMachine()
    actor.send({ type: 'row.start', row: rowOf() })
    actor.send({ type: 'row.drop', section: 'active' })

    expect(moves).toEqual([])
    expect(actor.getSnapshot().context.suppressed).toBe('row')
  })

  it('carries the row kind so a remote drop writes the preference half only', () => {
    const { actor, moves } = startMachine()
    actor.send({ type: 'row.start', row: { kind: 'remote', sessionId: 'thread-remote', section: 'active' } })
    actor.send({ type: 'row.drop', section: 'settled' })

    expect(moves).toEqual([{ kind: 'remote', sessionId: 'thread-remote', section: 'settled' }])
  })

  it('leaves no suppression behind when a row drag is cancelled', () => {
    const { actor } = startMachine()
    actor.send({ type: 'row.start', row: rowOf() })
    actor.send({ type: 'row.end' })

    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.suppressed).toBeNull()
  })

  it('treats a header press that never passed the threshold as a plain click', () => {
    const { actor, commits } = startMachine()
    actor.send({ type: 'section.press', pointerId: 1, from: 0, startY: 10 })
    actor.send({ type: 'section.move', pointerId: 1, position: 12 })
    actor.send({ type: 'section.drop', pointerId: 1, position: 12 })

    expect(commits).toEqual([])
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.suppressed).toBeNull()
  })

  it('reorders from the pointer position at drop and suppresses that header click', () => {
    const { actor, commits } = startMachine()
    actor.send({ type: 'section.press', pointerId: 1, from: 0, startY: 10 })
    actor.send({ type: 'section.drag', pointerId: 1, centers: [10, 30, 50] })
    actor.send({ type: 'section.move', pointerId: 1, position: 32 })
    expect(actor.getSnapshot().context.section?.to).toBe(1)

    actor.send({ type: 'section.drop', pointerId: 1, position: 45 })
    expect(commits).toEqual([{ from: 0, to: 1 }])
    expect(actor.getSnapshot().context.suppressed).toBe('section')
  })

  it('ignores another pointer while a header is being dragged', () => {
    const { actor } = startMachine()
    actor.send({ type: 'section.press', pointerId: 1, from: 0, startY: 10 })
    actor.send({ type: 'section.drag', pointerId: 1, centers: [10, 30, 50] })
    const dragged = actor.getSnapshot()

    actor.send({ type: 'section.move', pointerId: 2, position: 90 })
    expect(actor.getSnapshot().context.section).toEqual(dragged.context.section)

    actor.send({ type: 'section.drop', pointerId: 2, position: 90 })
    expect(actor.getSnapshot().matches('section')).toBe(true)
  })

  it('consumes the suppressed click once and returns to a plain idle', async () => {
    const { actor } = startMachine()
    actor.send({ type: 'row.start', row: rowOf() })
    actor.send({ type: 'row.drop', section: 'inactive' })
    actor.send({ type: 'suppression.consume' })

    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.suppressed).toBeNull()
  })

  it('drops the suppression on the next task even when no click follows the drop', async () => {
    const { actor } = startMachine()
    actor.send({ type: 'row.start', row: rowOf() })
    actor.send({ type: 'row.drop', section: 'inactive' })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('idle')).toBe(true))
    expect(actor.getSnapshot().context.suppressed).toBeNull()
  })

  it('starts a new gesture while suppressing the previous click', () => {
    const { actor } = startMachine()
    actor.send({ type: 'row.start', row: rowOf() })
    actor.send({ type: 'row.drop', section: 'inactive' })
    actor.send({ type: 'section.press', pointerId: 3, from: 1, startY: 20 })

    expect(actor.getSnapshot().matches('pressing')).toBe(true)
    const section = actor.getSnapshot().context.section
    expect(section?.from).toBe(1)
  })
})
