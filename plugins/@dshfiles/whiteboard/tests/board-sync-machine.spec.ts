import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boardSyncMachine, SAVE_DEBOUNCE_MS, SaveConflict, type SaveBoard, type SaveRequest } from '../src/board-sync-machine.js'
import type { BoardSummary, Scene } from '../src/model.js'

const scene = (id: string): Scene => ({ elements: [{ id, type: 'rectangle' }], appState: {}, files: {} })
const summary = (revision: number): BoardSummary => ({
  id: 'board',
  project: '/p',
  title: 'Board',
  revision,
  elementCount: 1,
  pending: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
})

/** A save port whose calls the test settles by hand. */
const manualSave = () => {
  const calls: Array<{ request: SaveRequest; resolve: (board: BoardSummary) => void; reject: (error: unknown) => void }> = []
  const save: SaveBoard = request =>
    new Promise((resolve, reject) => {
      calls.push({ request, resolve, reject })
    })
  return { save, calls }
}

const start = (save: SaveBoard, revision = 1) => createActor(boardSyncMachine, { input: { boardId: 'board', revision, save } }).start()

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('board autosave', () => {
  it('debounces edits into one revision-checked save of the latest scene', async () => {
    const { save, calls } = manualSave()
    const actor = start(save)
    actor.send({ type: 'EDIT', scene: scene('a') })
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS / 2)
    actor.send({ type: 'EDIT', scene: scene('b') })
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS / 2)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.request).toMatchObject({ expectedRevision: 1, scene: scene('b'), clearPending: false })
    calls[0]?.resolve(summary(2))
    await vi.runAllTimersAsync()
    expect(actor.getSnapshot().value).toBe('clean')
    expect(actor.getSnapshot().context.revision).toBe(2)
  })

  it('queues an edit made during a save as the next save on the new revision', async () => {
    const { save, calls } = manualSave()
    const actor = start(save)
    actor.send({ type: 'EDIT', scene: scene('a') })
    actor.send({ type: 'FLUSH' })
    actor.send({ type: 'EDIT', scene: scene('b') })
    calls[0]?.resolve(summary(2))
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10)
    expect(calls[1]?.request).toMatchObject({ expectedRevision: 2, scene: scene('b') })
  })

  it('parks a stale save in conflict until the user keeps theirs or loads the newer version', async () => {
    const { save, calls } = manualSave()
    const actor = start(save)
    actor.send({ type: 'EDIT', scene: scene('mine') })
    actor.send({ type: 'FLUSH' })
    calls[0]?.reject(new SaveConflict(5))
    await waitFor(actor, snapshot => snapshot.value === 'conflict')
    actor.send({ type: 'OVERWRITE' })
    expect(calls[1]?.request).toMatchObject({ expectedRevision: 5, scene: scene('mine') })
    calls[1]?.reject(new SaveConflict(6))
    await waitFor(actor, snapshot => snapshot.value === 'conflict')
    actor.send({ type: 'SYNCED', revision: 6 })
    expect(actor.getSnapshot().value).toBe('clean')
    expect(actor.getSnapshot().context).toMatchObject({ revision: 6, scene: null })
  })

  it('keeps the drawing after a failed save and retries it', async () => {
    const { save, calls } = manualSave()
    const actor = start(save)
    actor.send({ type: 'EDIT', scene: scene('a') })
    actor.send({ type: 'FLUSH' })
    calls[0]?.reject(new Error('Host unavailable'))
    await waitFor(actor, snapshot => snapshot.value === 'failed')
    expect(actor.getSnapshot().context.error).toBe('Host unavailable')
    actor.send({ type: 'RETRY' })
    expect(calls[1]?.request.scene).toEqual(scene('a'))
  })

  it('saves converted agent source at once and clears it on the Host', async () => {
    const { save, calls } = manualSave()
    const actor = start(save)
    actor.send({ type: 'CONVERTED', scene: scene('converted') })
    expect(calls[0]?.request).toMatchObject({ clearPending: true, scene: scene('converted') })
    calls[0]?.resolve(summary(2))
    await waitFor(actor, snapshot => snapshot.value === 'clean')
    actor.send({ type: 'EDIT', scene: scene('next') })
    actor.send({ type: 'FLUSH' })
    expect(calls[1]?.request.clearPending).toBe(false)
  })
})
