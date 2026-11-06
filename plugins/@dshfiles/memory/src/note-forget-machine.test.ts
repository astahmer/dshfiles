import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { noteForgetMachine, type NoteForgetInput } from './note-forget-machine.js'

const start = (input: Partial<NoteForgetInput> = {}) => {
  const forgotten: { id: number; reason: string }[] = []
  const refreshes: number[] = []
  const actor = createActor(noteForgetMachine, {
    input: {
      forget: async ({ id, reason }) => {
        forgotten.push({ id, reason })
      },
      refresh: () => refreshes.push(refreshes.length),
      ...input,
    },
  })
  actor.start()
  return { actor, forgotten, refreshes }
}

const selectNotes = (actor: ReturnType<typeof start>['actor'], ids: readonly number[]) => {
  actor.send({ type: 'select.mode', on: true })
  actor.send({ type: 'visible', ids })
  actor.send({ type: 'select.all', orderedIds: ids })
}

describe('note forget machine', () => {
  it('browses, selects and confirms a batch with its reason', async () => {
    const { actor, forgotten, refreshes } = start()
    expect(actor.getSnapshot().matches('browsing')).toBe(true)

    selectNotes(actor, [1, 2])
    expect(actor.getSnapshot().matches('selecting')).toBe(true)
    expect(actor.getSnapshot().context.selection.ids).toEqual([1, 2])

    actor.send({ type: 'forget.ask' })
    expect(actor.getSnapshot().matches('confirming')).toBe(true)
    expect(actor.getSnapshot().context.targetIds).toEqual([1, 2])

    actor.send({ type: 'forget.reason', reason: 'duplicated' })
    actor.send({ type: 'forget.confirm' })
    await waitFor(actor, snapshot => snapshot.matches('selecting'))
    expect(forgotten).toEqual([
      { id: 1, reason: 'duplicated' },
      { id: 2, reason: 'duplicated' },
    ])
    expect(actor.getSnapshot().context.selection.ids).toEqual([])
    expect(refreshes).toHaveLength(1)
    actor.stop()
  })

  it('cancels the confirmation without forgetting anything', () => {
    const { actor, forgotten } = start()
    selectNotes(actor, [1])
    actor.send({ type: 'forget.ask' })
    actor.send({ type: 'forget.cancel' })

    expect(actor.getSnapshot().matches('selecting')).toBe(true)
    expect(actor.getSnapshot().context.targetIds).toEqual([])
    expect(actor.getSnapshot().context.selection.ids).toEqual([1])
    expect(forgotten).toEqual([])
    actor.stop()
  })

  it('keeps the failed ids selected after a partial failure', async () => {
    const { actor, refreshes } = start({
      forget: async ({ id }) => {
        if (id === 2) throw new Error('note is gone')
      },
    })
    selectNotes(actor, [1, 2])
    actor.send({ type: 'forget.ask' })
    actor.send({ type: 'forget.confirm' })

    await waitFor(actor, snapshot => snapshot.matches('confirming'))
    expect(actor.getSnapshot().context.failure).toEqual({ kind: 'partial', forgotten: 1, failed: 1 })
    expect(actor.getSnapshot().context.selection.ids).toEqual([2])
    expect(actor.getSnapshot().context.targetIds).toEqual([2])
    expect(refreshes).toHaveLength(1)

    actor.send({ type: 'forget.confirm' })
    await waitFor(actor, snapshot => snapshot.matches('confirming'))
    expect(actor.getSnapshot().context.failure).toEqual({ kind: 'partial', forgotten: 0, failed: 1 })
    actor.stop()
  })

  it('reports a hard failure without refreshing and keeps the batch', async () => {
    const { actor, refreshes } = start({
      forget: () => {
        throw new Error('Host unavailable')
      },
    })
    selectNotes(actor, [1, 2])
    actor.send({ type: 'forget.ask' })
    actor.send({ type: 'forget.confirm' })

    await waitFor(actor, snapshot => snapshot.matches('confirming'))
    expect(actor.getSnapshot().context.failure).toMatchObject({ kind: 'error' })
    expect(actor.getSnapshot().context.targetIds).toEqual([1, 2])
    expect(refreshes).toHaveLength(0)
    actor.stop()
  })

  it('refuses a confirmation without a selection', () => {
    const { actor } = start()
    actor.send({ type: 'select.mode', on: true })
    actor.send({ type: 'forget.ask' })
    expect(actor.getSnapshot().matches('selecting')).toBe(true)
    actor.stop()
  })

  it('clears the selection when select mode turns off and prunes vanished notes', () => {
    const { actor } = start()
    selectNotes(actor, [1, 2])
    actor.send({ type: 'visible', ids: [2] })
    expect(actor.getSnapshot().context.selection.ids).toEqual([2])

    actor.send({ type: 'select.mode', on: false })
    expect(actor.getSnapshot().matches('browsing')).toBe(true)
    expect(actor.getSnapshot().context.selection.ids).toEqual([])
    actor.stop()
  })
})
