import { createActor, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoteEditorActor, noteEditorMachine, type NoteEditorClient, type NoteEditorSeed } from './note-editor-machine.js'

type SaveInput = Parameters<NoteEditorClient['save']>[0]
type ForgetInput = Parameters<NoteEditorClient['forget']>[0]
type PendingWrite = {
  readonly signal: AbortSignal
  readonly resolve: () => void
  readonly reject: () => void
}

const deferred = () => {
  let resolve: () => void = () => undefined
  let reject: () => void = () => undefined
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise()
    reject = () => rejectPromise(new Error('synthetic failure'))
  })
  return { promise, resolve, reject }
}

const note: NoteEditorSeed = { id: 7, text: 'Original note', type: 'project', scope: 'dshfiles' }
const actors: ActorRefFrom<typeof noteEditorMachine>[] = []

const harness = () => {
  const saves: { readonly input: SaveInput; readonly pending: PendingWrite }[] = []
  const forgets: { readonly input: ForgetInput; readonly pending: PendingWrite }[] = []
  const client: NoteEditorClient = {
    save: async (input, signal) => {
      const pending = deferred()
      saves.push({ input, pending: { signal, resolve: pending.resolve, reject: pending.reject } })
      return pending.promise
    },
    forget: async (input, signal) => {
      const pending = deferred()
      forgets.push({ input, pending: { signal, resolve: pending.resolve, reject: pending.reject } })
      return pending.promise
    },
  }
  const machine = noteEditorMachine.provide({ actors: { persist: createNoteEditorActor(client) } })
  const actor = createActor(machine, { input: { note } }).start()
  actors.push(actor)
  return { actor, saves, forgets }
}

const waitForState = (actor: ActorRefFrom<typeof noteEditorMachine>, state: 'view' | 'editing' | 'forgetting'): Promise<void> => {
  if (actor.getSnapshot().matches(state)) return Promise.resolve()
  return new Promise(resolve => {
    let unsubscribe = (): void => undefined
    const finish = (): void => {
      unsubscribe()
      resolve()
    }
    const subscription = actor.subscribe(snapshot => {
      if (snapshot.matches(state)) finish()
    })
    unsubscribe = () => subscription.unsubscribe()
    if (actor.getSnapshot().matches(state)) finish()
  })
}

afterEach(() => {
  for (const actor of actors) actor.stop()
  actors.length = 0
})

describe('note editor machine', () => {
  it('retains an edit draft through preview and saves the captured values', async () => {
    const { actor, saves } = harness()
    actor.send({ type: 'edit' })
    actor.send({ type: 'text.change', value: 'Updated note' })
    actor.send({ type: 'type.change', value: 'feedback' })
    actor.send({ type: 'scope.change', value: 'project/example' })
    actor.send({ type: 'reason.change', value: 'confirmed' })
    actor.send({ type: 'preview.toggle' })
    expect(actor.getSnapshot().context.preview).toBe(true)
    expect(actor.getSnapshot().context.draft.text).toBe('Updated note')

    actor.send({ type: 'save' })
    await vi.waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]?.input).toEqual({
      id: note.id,
      text: 'Updated note',
      type: 'feedback',
      scope: 'project/example',
      reason: 'confirmed',
    })
    expect(saves[0]?.pending.signal.aborted).toBe(false)
    saves[0]?.pending.resolve()
    await waitForState(actor, 'view')
    expect(actor.getSnapshot().context.failure).toBeNull()
  })

  it('rejects blank saves and resets the draft when editing is canceled', () => {
    const { actor, saves } = harness()
    actor.send({ type: 'edit' })
    actor.send({ type: 'text.change', value: '   ' })
    actor.send({ type: 'save' })
    expect(actor.getSnapshot().matches('editing')).toBe(true)
    expect(saves).toHaveLength(0)

    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().matches('view')).toBe(true)
    expect(actor.getSnapshot().context.draft.text).toBe(note.text)
  })

  it('aborts a canceled save and ignores its late completion', async () => {
    const { actor, saves } = harness()
    actor.send({ type: 'edit' })
    actor.send({ type: 'text.change', value: 'Canceled draft' })
    actor.send({ type: 'save' })
    await vi.waitFor(() => expect(saves).toHaveLength(1))
    actor.send({ type: 'cancel' })
    const operationId = actor.getSnapshot().context.operationId
    expect(saves[0]?.pending.signal.aborted).toBe(true)

    saves[0]?.pending.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(actor.getSnapshot().matches('view')).toBe(true)
    expect(actor.getSnapshot().context.operationId).toBe(operationId)
    expect(actor.getSnapshot().context.draft.text).toBe(note.text)
  })

  it('keeps a failed edit available for retry', async () => {
    const { actor, saves } = harness()
    actor.send({ type: 'edit' })
    actor.send({ type: 'text.change', value: 'Retry this note' })
    actor.send({ type: 'save' })
    await vi.waitFor(() => expect(saves).toHaveLength(1))
    saves[0]?.pending.reject()
    await waitForState(actor, 'editing')
    expect(actor.getSnapshot().context.failure).not.toBeNull()
    expect(actor.getSnapshot().context.draft.text).toBe('Retry this note')

    actor.send({ type: 'save' })
    await vi.waitFor(() => expect(saves).toHaveLength(2))
    saves[1]?.pending.resolve()
    await waitForState(actor, 'view')
    expect(actor.getSnapshot().context.failure).toBeNull()
  })

  it('captures the forget reason and returns to view after success', async () => {
    const { actor, forgets } = harness()
    actor.send({ type: 'forget' })
    actor.send({ type: 'reason.change', value: 'no longer useful' })
    actor.send({ type: 'forget.confirm' })
    await vi.waitFor(() => expect(forgets).toHaveLength(1))
    expect(forgets[0]?.input).toEqual({ id: note.id, reason: 'no longer useful' })
    forgets[0]?.pending.resolve()
    await waitForState(actor, 'view')
  })
})
