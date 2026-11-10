import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  boardSyncMachine,
  SAVE_DEBOUNCE_MS,
  SaveConflict,
  type ConvertPending,
  type SaveBoard,
  type SaveRequest,
  type SyncInput,
} from '../src/board-sync-machine.js'
import type { EditorHandle } from '../src/editor-contract.js'
import type { Board, BoardSummary, PendingSource, Scene } from '../src/model.js'

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
const board = (revision: number, pending: PendingSource | null = null): Board => ({
  board: summary(revision),
  scene: scene(`remote-${revision}`),
  pending,
  texts: [],
})
const pendingMermaid: PendingSource = { kind: 'mermaid', source: 'graph TD; A-->B' }

/** A save port whose calls the test settles by hand. */
const manualSave = () => {
  const calls: Array<{ request: SaveRequest; resolve: (board: BoardSummary) => void; reject: (error: unknown) => void }> = []
  const save: SaveBoard = request =>
    new Promise((resolve, reject) => {
      calls.push({ request, resolve, reject })
    })
  return { save, calls }
}

/** A conversion port whose calls the test settles by hand. */
const manualConvert = () => {
  const calls: Array<{ pending: PendingSource; resolve: (scene: Scene) => void; reject: (error: unknown) => void }> = []
  const convert: ConvertPending = input =>
    new Promise((resolve, reject) => {
      calls.push({ pending: input.pending, resolve, reject })
    })
  return { convert, calls }
}

const fakeEditor = (current: Scene = scene('canvas')): EditorHandle => ({
  scene: () => current,
  replaceScene: vi.fn(),
  appendElements: vi.fn(input => ({ ...current, elements: [...current.elements, ...input.elements] })),
})

const start = (save: SaveBoard, revision = 1, overrides: Partial<SyncInput> = {}) =>
  createActor(boardSyncMachine, {
    input: {
      boardId: 'board',
      revision,
      pending: null,
      save,
      read: async () => board(revision),
      convert: async () => scene('converted'),
      ...overrides,
    },
  }).start()

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
    const actor = start(save, 1, { read: async () => board(5) })
    actor.send({ type: 'EDIT', scene: scene('mine') })
    actor.send({ type: 'FLUSH' })
    calls[0]?.reject(new SaveConflict(5))
    await waitFor(actor, snapshot => snapshot.value === 'conflict')
    actor.send({ type: 'OVERWRITE' })
    expect(calls[1]?.request).toMatchObject({ expectedRevision: 5, scene: scene('mine') })
    calls[1]?.reject(new SaveConflict(6))
    await waitFor(actor, snapshot => snapshot.value === 'conflict')
    actor.send({ type: 'RELOAD' })
    await waitFor(actor, snapshot => snapshot.matches('clean'))
    expect(actor.getSnapshot().context).toMatchObject({ revision: 5, scene: null })
  })

  it('keeps an unsaved edit when a rename advances the revision mid-edit', async () => {
    const { save, calls } = manualSave()
    const actor = start(save)
    actor.send({ type: 'EDIT', scene: scene('stroke') })
    actor.send({ type: 'SYNCED', revision: 4 })

    expect(actor.getSnapshot().matches('dirty')).toBe(true)
    expect(actor.getSnapshot().context).toMatchObject({ revision: 4, scene: scene('stroke') })

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
    expect(calls[0]?.request).toMatchObject({ expectedRevision: 4, scene: scene('stroke') })
    actor.stop()
  })

  it('settles to clean on a rename that arrives while nothing is unsaved', () => {
    const { save } = manualSave()
    const actor = start(save)
    actor.send({ type: 'SYNCED', revision: 7 })

    expect(actor.getSnapshot().matches('clean')).toBe(true)
    expect(actor.getSnapshot().context).toMatchObject({ revision: 7, scene: null })
    actor.stop()
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

  it('clears the converted source on the Host once the conversion save lands', async () => {
    const { save, calls } = manualSave()
    const actor = start(save)
    actor.send({ type: 'EDITOR_READY', editor: fakeEditor() })
    actor.send({ type: 'EDIT', scene: scene('converted') })
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
    expect(calls[0]?.request).toMatchObject({ clearPending: false, scene: scene('converted') })
    calls[0]?.resolve(summary(2))
    await waitFor(actor, snapshot => snapshot.matches('clean'))
    actor.send({ type: 'EDIT', scene: scene('next') })
    actor.send({ type: 'FLUSH' })
    expect(calls[1]?.request.clearPending).toBe(false)
  })
})

describe('board conversion', () => {
  it('converts the queued agent source once the editor is ready, then saves it cleared', async () => {
    const { save, calls: saves } = manualSave()
    const { convert, calls: conversions } = manualConvert()
    const actor = start(save, 1, { pending: pendingMermaid, convert })

    actor.send({ type: 'EDITOR_READY', editor: fakeEditor() })
    await waitFor(actor, snapshot => snapshot.matches('converting'))
    expect(actor.getSnapshot().context.pending).toEqual(pendingMermaid)
    expect(conversions).toHaveLength(1)

    conversions[0]?.resolve(scene('converted'))
    await waitFor(actor, snapshot => snapshot.matches('saving'))
    expect(saves[0]?.request).toMatchObject({ clearPending: true, scene: scene('converted') })

    saves[0]?.resolve(summary(2))
    await waitFor(actor, snapshot => snapshot.matches('clean'))
    expect(actor.getSnapshot().context.pending).toBeNull()
    actor.stop()
  })

  it('reports a failed conversion and never retries the same source', async () => {
    const { save, calls: saves } = manualSave()
    const { convert, calls: conversions } = manualConvert()
    const actor = start(save, 1, { pending: pendingMermaid, convert })

    actor.send({ type: 'EDITOR_READY', editor: fakeEditor() })
    await waitFor(actor, snapshot => snapshot.matches('converting'))
    conversions[0]?.reject(new Error('The mermaid source is invalid.'))

    await waitFor(actor, snapshot => snapshot.context.conversionError === 'The mermaid source is invalid.')
    expect(actor.getSnapshot().matches('clean')).toBe(true)

    actor.send({ type: 'EDIT', scene: scene('local') })
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
    expect(conversions).toHaveLength(1)
    expect(saves[0]?.request).toMatchObject({ clearPending: false, scene: scene('local') })
    actor.stop()
  })

  it('discarding a failed conversion saves the canvas and clears the source', async () => {
    const { save, calls: saves } = manualSave()
    const { convert, calls: conversions } = manualConvert()
    const editor = fakeEditor(scene('canvas'))
    const actor = start(save, 1, { pending: pendingMermaid, convert })

    actor.send({ type: 'EDITOR_READY', editor })
    await waitFor(actor, snapshot => snapshot.matches('converting'))
    conversions[0]?.reject(new Error('The mermaid source is invalid.'))
    await waitFor(actor, snapshot => snapshot.context.conversionError !== null)

    actor.send({ type: 'DISCARD_PENDING' })
    await waitFor(actor, snapshot => snapshot.matches('saving'))
    expect(saves[0]?.request).toMatchObject({ clearPending: true, scene: scene('canvas') })
    actor.stop()
  })
})

describe('board remote adoption', () => {
  it('adopts a newer remote revision while clean, including its queued source', async () => {
    const { save, calls: saves } = manualSave()
    const editor = fakeEditor()
    const read = vi.fn(async () => board(5, pendingMermaid))
    const actor = start(save, 1, { read })
    const adopted: string[] = []
    actor.on('adopted', event => adopted.push(event.title))

    actor.send({ type: 'EDITOR_READY', editor })
    actor.send({ type: 'REMOTE_REVISION', revision: 5 })

    await waitFor(actor, snapshot => snapshot.matches('saving'))
    expect(read).toHaveBeenCalledTimes(1)
    expect(editor.replaceScene).toHaveBeenCalledWith(scene('remote-5'))
    expect(adopted).toEqual(['Board'])
    expect(saves[0]?.request).toMatchObject({ expectedRevision: 5, clearPending: true })

    saves[0]?.resolve(summary(6))
    await waitFor(actor, snapshot => snapshot.matches('clean'))
    expect(actor.getSnapshot().context.revision).toBe(6)
    actor.stop()
  })

  it('does not adopt while local edits are unsaved', async () => {
    const { save } = manualSave()
    const read = vi.fn(async () => board(5))
    const actor = start(save, 1, { read })

    actor.send({ type: 'EDITOR_READY', editor: fakeEditor() })
    actor.send({ type: 'EDIT', scene: scene('mine') })
    actor.send({ type: 'REMOTE_REVISION', revision: 5 })

    expect(actor.getSnapshot().matches('dirty')).toBe(true)
    expect(read).not.toHaveBeenCalled()
    actor.stop()
  })

  it('does not retry a refused adoption of the same remote revision', async () => {
    const { save } = manualSave()
    const read = vi.fn(async () => {
      throw new Error('Host unavailable')
    })
    const actor = start(save, 1, { read })

    actor.send({ type: 'EDITOR_READY', editor: fakeEditor() })
    actor.send({ type: 'REMOTE_REVISION', revision: 5 })
    await waitFor(actor, snapshot => snapshot.matches('clean') && snapshot.context.remoteRevision === null)
    await Promise.resolve()

    expect(read).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().matches('clean')).toBe(true)
    actor.stop()
  })

  it('reloading a conflicted board adopts the newer revision', async () => {
    const { save, calls: saves } = manualSave()
    const editor = fakeEditor()
    const read = vi.fn(async () => board(5))
    const actor = start(save, 1, { read })

    actor.send({ type: 'EDITOR_READY', editor })
    actor.send({ type: 'EDIT', scene: scene('mine') })
    actor.send({ type: 'FLUSH' })
    saves[0]?.reject(new SaveConflict(5))
    await waitFor(actor, snapshot => snapshot.matches('conflict'))

    actor.send({ type: 'RELOAD' })
    await waitFor(actor, snapshot => snapshot.matches('clean'))
    expect(read).toHaveBeenCalledTimes(1)
    expect(editor.replaceScene).toHaveBeenCalledWith(scene('remote-5'))
    expect(actor.getSnapshot().context.revision).toBe(5)
    actor.stop()
  })
})

describe('leaving the board', () => {
  it('leaves at once when nothing is unsaved', () => {
    const { save } = manualSave()
    const actor = start(save)
    let left = 0
    actor.on('left', () => {
      left += 1
    })

    actor.send({ type: 'LEAVE' })

    expect(left).toBe(1)
    actor.stop()
  })

  it('flushes the last edit before leaving', async () => {
    const { save, calls } = manualSave()
    const actor = start(save)
    let left = 0
    actor.on('left', () => {
      left += 1
    })

    actor.send({ type: 'EDIT', scene: scene('last') })
    actor.send({ type: 'LEAVE' })
    expect(actor.getSnapshot().matches('saving')).toBe(true)
    expect(calls[0]?.request.scene).toEqual(scene('last'))

    calls[0]?.resolve(summary(2))
    await waitFor(actor, snapshot => snapshot.matches('clean'))
    expect(left).toBe(1)
    actor.stop()
  })

  it('keeps the board open when the save that leaving flushes conflicts', async () => {
    const { save, calls } = manualSave()
    const actor = start(save)
    let left = 0
    let blocked = 0
    actor.on('left', () => {
      left += 1
    })
    actor.on('leaveBlocked', () => {
      blocked += 1
    })

    actor.send({ type: 'EDIT', scene: scene('mine') })
    actor.send({ type: 'LEAVE' })
    calls[0]?.reject(new SaveConflict(5))
    await waitFor(actor, snapshot => snapshot.matches('conflict'))

    expect(left).toBe(0)
    expect(blocked).toBe(1)
    actor.stop()
  })
})
