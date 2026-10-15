import { createActor, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorSaveActor, editorSaveMachine, type EditorSaveClient, type EditorSaveRequest, type EditorWriteOutput } from './editor-save-machine.js'

type PendingWrite = {
  readonly request: EditorSaveRequest
  readonly overwrite: boolean
  readonly signal: AbortSignal
  readonly resolve: (result: EditorWriteOutput) => void
  readonly reject: () => void
}

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => undefined
  let reject: () => void = () => undefined
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = value => resolvePromise(value)
    reject = () => rejectPromise(new Error('synthetic failure'))
  })
  return { promise, resolve, reject }
}

const request = (bufferVersion = 1): EditorSaveRequest => ({
  documentId: 'doc-1',
  sessionId: 'ses_1',
  path: 'src/file.ts',
  text: 'updated',
  expectedSha256: 'b'.repeat(64),
  bufferVersion,
})
const actors: ActorRefFrom<typeof editorSaveMachine>[] = []

const harness = () => {
  const writes: PendingWrite[] = []
  const client: EditorSaveClient = {
    write: (saveRequest, overwrite, signal) => {
      const pending = deferred<EditorWriteOutput>()
      writes.push({ request: saveRequest, overwrite, signal, resolve: pending.resolve, reject: pending.reject })
      return pending.promise
    },
  }
  const machine = editorSaveMachine.provide({ actors: { write: createEditorSaveActor(client) } })
  const actor = createActor(machine).start()
  actors.push(actor)
  return { actor, writes }
}

const waitForState = (actor: ActorRefFrom<typeof editorSaveMachine>, state: 'idle' | 'approval' | 'writing' | 'conflict' | 'failed'): Promise<void> => {
  if (actor.getSnapshot().matches(state)) return Promise.resolve()
  return new Promise(resolve => {
    let unsubscribe = (): void => undefined
    const subscription = actor.subscribe(snapshot => {
      if (!snapshot.matches(state)) return
      unsubscribe()
      resolve()
    })
    unsubscribe = () => subscription.unsubscribe()
    if (actor.getSnapshot().matches(state)) {
      unsubscribe()
      resolve()
    }
  })
}

afterEach(() => {
  for (const actor of actors) actor.stop()
  actors.length = 0
})

describe('editor save machine', () => {
  it('requires approval once and records the exact saved buffer version', async () => {
    const { actor, writes } = harness()
    actor.send({ type: 'document.changed', documentId: 'doc-1' })
    actor.send({ type: 'save.request', request: request(4) })
    expect(actor.getSnapshot().matches('approval')).toBe(true)
    expect(writes).toHaveLength(0)

    actor.send({ type: 'approve' })
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ request: request(4), overwrite: false })
    expect(writes[0]?.signal.aborted).toBe(false)
    writes[0]?.resolve({ status: 'saved', absolutePath: '/work/src/file.ts', sha256: 'a'.repeat(64), bytes: 7 })
    await waitForState(actor, 'idle')
    expect(actor.getSnapshot().context.pending).toBeNull()

    actor.send({ type: 'save.request', request: request(5) })
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    expect(actor.getSnapshot().matches('writing')).toBe(true)
  })

  it('preserves a conflicted request for an explicit overwrite', async () => {
    const { actor, writes } = harness()
    actor.send({ type: 'document.changed', documentId: 'doc-1' })
    actor.send({ type: 'save.request', request: request() })
    actor.send({ type: 'approve' })
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    writes[0]?.resolve({ status: 'conflict', currentSha256: null })
    await waitForState(actor, 'conflict')
    expect(actor.getSnapshot().context.pending).toEqual(request())

    actor.send({ type: 'overwrite' })
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[1]?.request).toEqual(request())
    expect(writes[1]?.overwrite).toBe(true)
    writes[1]?.resolve({ status: 'saved', absolutePath: '/work/src/file.ts', sha256: 'c'.repeat(64), bytes: 7 })
    await waitForState(actor, 'idle')
  })

  it('cancels on document change and ignores a late completion', async () => {
    const { actor, writes } = harness()
    actor.send({ type: 'document.changed', documentId: 'doc-1' })
    actor.send({ type: 'save.request', request: request() })
    expect(actor.getSnapshot().matches('approval')).toBe(true)
    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(writes).toHaveLength(0)

    actor.send({ type: 'save.request', request: request() })
    actor.send({ type: 'approve' })
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    actor.send({ type: 'document.changed', documentId: 'doc-2' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.activeDocumentId).toBe('doc-2')
    expect(writes[0]?.signal.aborted).toBe(true)

    writes[0]?.resolve({ status: 'saved', absolutePath: '/work/src/file.ts', sha256: 'd'.repeat(64), bytes: 7 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.pending).toBeNull()
  })

  it('keeps a failed save retryable without asking for approval again', async () => {
    const { actor, writes } = harness()
    actor.send({ type: 'document.changed', documentId: 'doc-1' })
    actor.send({ type: 'save.request', request: request() })
    actor.send({ type: 'approve' })
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    writes[0]?.reject()
    await waitForState(actor, 'failed')
    expect(actor.getSnapshot().context.failure).toBe('synthetic failure')

    actor.send({ type: 'save.request', request: request(2) })
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    expect(actor.getSnapshot().matches('writing')).toBe(true)
    expect(writes[1]?.request.bufferVersion).toBe(2)
  })
})
