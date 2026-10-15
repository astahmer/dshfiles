import { createActor, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { PromptLibrary, type SavedPrompt } from './library.js'
import { promptLibraryMachine, type PromptInsertionSpan, type PromptLibraryClient, type PromptLibraryStorageRead } from './prompt-library-machine.js'

const firstPrompt: SavedPrompt = {
  id: '11f94d55-8639-4f42-94ca-7b218778e4a1',
  revision: '0ed39357-447e-4f84-b0e8-4e6d313e9233',
  title: 'Review a change',
  text: 'Check the behavior and tests.',
  updatedAt: 1,
}

const updatedPrompt: SavedPrompt = {
  ...firstPrompt,
  revision: 'ac518568-9e7f-4a62-8adf-250208be6a4e',
  text: 'Review the updated behavior.',
  updatedAt: 2,
}

const insertionSpan: PromptInsertionSpan = { start: 0, end: 0, draftRev: 1 }

const createLibraryClient = (initial: readonly SavedPrompt[] = []) => {
  const values = new Map<string, string>()
  const listeners = new Set<(serialized: string | null) => void>()
  const insertions: string[] = []
  let id = 0
  const initialValue = PromptLibrary.serialize(initial)
  if (initialValue !== null) values.set('library', initialValue)

  const client: PromptLibraryClient = {
    read: (): PromptLibraryStorageRead => {
      const result = PromptLibrary.read(values.get('library') ?? null)
      return result.ok ? { kind: 'ready', prompts: result.prompts } : { kind: 'invalid' }
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    write: serialized => void values.set('library', serialized),
    createId: () => {
      id += 1
      return `11111111-1111-4111-8111-${String(id).padStart(12, '0')}`
    },
    now: () => 42,
    insertText: text => {
      insertions.push(text)
      return true
    },
  }

  return {
    client,
    insertions,
    readPrompts: (): readonly SavedPrompt[] => {
      const result = PromptLibrary.read(values.get('library') ?? null)
      return result.ok ? result.prompts : []
    },
    updateFromAnotherTab: (prompts: readonly SavedPrompt[]) => {
      const serialized = PromptLibrary.serialize(prompts)
      values.set('library', serialized ?? '')
      for (const listener of listeners) listener(serialized)
    },
  }
}

const waitForState = (actor: ActorRefFrom<typeof promptLibraryMachine>, target: 'browse' | 'editing' | 'confirmingDelete'): Promise<void> => {
  if (actor.getSnapshot().matches(target)) return Promise.resolve()
  return new Promise(resolve => {
    const subscription = actor.subscribe(snapshot => {
      if (!snapshot.matches(target)) return
      subscription.unsubscribe()
      resolve()
    })
  })
}

const openLibrary = async (actor: ActorRefFrom<typeof promptLibraryMachine>, span: PromptInsertionSpan | null = null): Promise<void> => {
  actor.send({ type: 'open', span })
  await waitForState(actor, 'browse')
}

describe('prompt library machine', () => {
  it('saves a new prompt through the injected local library client', async () => {
    const library = createLibraryClient()
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    await openLibrary(actor)
    actor.send({ type: 'prompt.new' })
    actor.send({ type: 'editor.change', field: 'title', value: '  Summarize  ' })
    actor.send({ type: 'editor.change', field: 'text', value: 'Summarize the important changes.' })
    actor.send({ type: 'editor.save', copy: false })
    await waitForState(actor, 'browse')

    expect(library.readPrompts()).toEqual([
      {
        id: '11111111-1111-4111-8111-000000000001',
        revision: '11111111-1111-4111-8111-000000000002',
        title: 'Summarize',
        text: 'Summarize the important changes.',
        updatedAt: 42,
      },
    ])
    expect(actor.getSnapshot().context.editor).toBeNull()
    expect(actor.getSnapshot().context.notice).toBe('Saved in this browser.')
    actor.stop()
  })

  it('preserves conflicted edits and saves them as a new copy', async () => {
    const library = createLibraryClient([firstPrompt])
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    await openLibrary(actor)
    actor.send({ type: 'prompt.edit', prompt: firstPrompt })
    actor.send({ type: 'editor.change', field: 'text', value: 'My unsaved revision.' })
    library.updateFromAnotherTab([updatedPrompt])

    expect(actor.getSnapshot().context.editor).toEqual({
      id: firstPrompt.id,
      originalRevision: firstPrompt.revision,
      title: firstPrompt.title,
      text: 'My unsaved revision.',
      stale: true,
    })
    actor.send({ type: 'editor.save', copy: true })
    await waitForState(actor, 'browse')

    expect(library.readPrompts()).toEqual([
      {
        id: '11111111-1111-4111-8111-000000000001',
        revision: '11111111-1111-4111-8111-000000000002',
        title: firstPrompt.title,
        text: 'My unsaved revision.',
        updatedAt: 42,
      },
      updatedPrompt,
    ])
    expect(actor.getSnapshot().context.editor).toBeNull()
    actor.stop()
  })

  it('deletes only after the matching confirmation', async () => {
    const library = createLibraryClient([firstPrompt])
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    await openLibrary(actor)
    actor.send({ type: 'delete.request', prompt: firstPrompt })
    expect(actor.getSnapshot().matches('confirmingDelete')).toBe(true)
    actor.send({ type: 'delete.request', prompt: firstPrompt })
    await waitForState(actor, 'browse')

    expect(library.readPrompts()).toEqual([])
    expect(actor.getSnapshot().context.deleteConfirmation).toBeNull()
    expect(actor.getSnapshot().context.notice).toBe('Prompt removed.')
    actor.stop()
  })

  it('clears delete confirmation on external change without deleting', async () => {
    const library = createLibraryClient([firstPrompt])
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    await openLibrary(actor)
    actor.send({ type: 'delete.request', prompt: firstPrompt })
    expect(actor.getSnapshot().matches('confirmingDelete')).toBe(true)
    expect(actor.getSnapshot().context.deleteConfirmation).toEqual({ id: firstPrompt.id, revision: firstPrompt.revision })

    library.updateFromAnotherTab([updatedPrompt])
    expect(actor.getSnapshot().matches('browse')).toBe(true)
    expect(actor.getSnapshot().context.deleteConfirmation).toBeNull()
    actor.send({ type: 'delete.request', prompt: firstPrompt })
    await waitForState(actor, 'confirmingDelete')
    expect(library.readPrompts()).toEqual([updatedPrompt])
    actor.stop()
  })

  it('rejects insertion when the saved cursor span has been cleared', async () => {
    const library = createLibraryClient([firstPrompt])
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    await openLibrary(actor)
    actor.send({ type: 'saved.insert', prompt: firstPrompt })
    await waitForState(actor, 'browse')

    expect(library.insertions).toEqual([])
    expect(actor.getSnapshot().context.hasInserted).toBe(false)
    expect(actor.getSnapshot().context.notice).toBe('Close and reopen the prompt stash to choose a fresh insertion point.')
    actor.stop()
  })

  it('inserts the current saved revision once at the captured span', async () => {
    const library = createLibraryClient([firstPrompt])
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    await openLibrary(actor, insertionSpan)
    actor.send({ type: 'saved.insert', prompt: firstPrompt })
    await waitForState(actor, 'browse')
    actor.send({ type: 'recent.insert', prompt: { id: '4', text: 'another prompt' } })

    expect(library.insertions).toEqual([firstPrompt.text])
    expect(actor.getSnapshot().context.hasInserted).toBe(true)
    actor.stop()
  })

  it('refreshes a saved prompt changed before insertion', async () => {
    const library = createLibraryClient([firstPrompt])
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    await openLibrary(actor, insertionSpan)
    library.updateFromAnotherTab([updatedPrompt])
    actor.send({ type: 'saved.insert', prompt: firstPrompt })
    await waitForState(actor, 'browse')

    expect(library.insertions).toEqual([])
    expect(actor.getSnapshot().context.prompts).toEqual([updatedPrompt])
    expect(actor.getSnapshot().context.notice).toBe('This prompt changed in another tab. Choose it again from the refreshed list.')
    actor.stop()
  })
})
