import { createActor, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptLibrary, type SavedPrompt } from './library.js'
import type { PromptLibraryMutation, PromptLibraryRead } from './library-client.js'
import { promptLibraryMachine, type PromptInsertionSpan, type PromptLibraryWorkflowClient } from './prompt-library-machine.js'

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

const createWorkflowClient = (initialPrompts: readonly SavedPrompt[] = []) => {
  let prompts = [...initialPrompts]
  let idCounter = 0
  let nextSave: ((signal: AbortSignal | undefined) => Promise<PromptLibraryMutation>) | null = null
  let latestRead: PromptLibraryRead = { kind: 'ready', prompts }
  let insertionAllowed = true
  const inserted: string[] = []
  const saves: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null }[] = []
  const removals: { readonly id: string; readonly expectedRevision: string }[] = []
  const client: PromptLibraryWorkflowClient = {
    save: async (input, options) => {
      saves.push(input)
      if (nextSave !== null) {
        const result = nextSave(options?.signal)
        nextSave = null
        return result
      }
      const result = PromptLibrary.writeIfCurrent(prompts, input.prompt, input.expectedRevision)
      if (result.kind === 'applied') prompts = [...result.prompts]
      return { kind: result.kind, prompts: result.prompts }
    },
    remove: async (input, options) => {
      removals.push(input)
      if (options?.signal?.aborted) return { kind: 'unavailable', prompts }
      const result = PromptLibrary.removeIfCurrent(prompts, input.id, input.expectedRevision)
      if (result.kind === 'applied') prompts = [...result.prompts]
      return { kind: result.kind, prompts: result.prompts }
    },
    readLatest: async options => {
      if (options?.signal?.aborted) return { kind: 'unavailable' }
      return latestRead.kind === 'ready' ? { kind: 'ready', prompts: [...latestRead.prompts] } : latestRead
    },
    createId: () => {
      idCounter += 1
      return `11111111-1111-4111-8111-${String(idCounter).padStart(12, '0')}`
    },
    now: () => 42,
    insertText: text => {
      if (!insertionAllowed) return false
      inserted.push(text)
      return true
    },
  }

  return {
    client,
    inserted,
    saves,
    removals,
    prompts: (): readonly SavedPrompt[] => prompts,
    setPrompts: (next: readonly SavedPrompt[]) => {
      prompts = [...next]
      latestRead = { kind: 'ready', prompts }
    },
    setLatestRead: (read: PromptLibraryRead) => {
      latestRead = read
    },
    setInsertionAllowed: (allowed: boolean) => {
      insertionAllowed = allowed
    },
    deferNextSave: (operation: (signal: AbortSignal | undefined) => Promise<PromptLibraryMutation>) => {
      nextSave = operation
    },
  }
}

const openLibrary = (actor: ActorRefFrom<typeof promptLibraryMachine>, span: PromptInsertionSpan | null = insertionSpan): void => {
  actor.send({ type: 'open', span })
  expect(actor.getSnapshot().matches('browsing')).toBe(true)
}

afterEach(() => vi.restoreAllMocks())

describe('prompt library workflow machine', () => {
  it('saves a new prompt through the injected Query client port', async () => {
    const library = createWorkflowClient()
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    openLibrary(actor)
    actor.send({ type: 'editor.new' })
    actor.send({ type: 'editor.save', submission: { title: '  Summarize  ', text: 'Summarize the important changes.', copy: false } })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('browsing')).toBe(true))

    expect(library.prompts()).toEqual([
      {
        id: '11111111-1111-4111-8111-000000000001',
        revision: '11111111-1111-4111-8111-000000000002',
        title: 'Summarize',
        text: 'Summarize the important changes.',
        updatedAt: 42,
      },
    ])
    expect(library.saves[0]?.expectedRevision).toBeNull()
    expect(actor.getSnapshot().context.editorTarget).toBeNull()
    expect(actor.getSnapshot().context.notice).toBe('Saved to the prompt library.')
    actor.stop()
  })

  it('retains conflicted editor target and saves changed text as a new copy', async () => {
    const library = createWorkflowClient([firstPrompt])
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    openLibrary(actor)
    actor.send({
      type: 'editor.edit',
      target: { id: firstPrompt.id, expectedRevision: firstPrompt.revision },
      initialValues: { title: firstPrompt.title, text: firstPrompt.text },
    })
    library.setPrompts([updatedPrompt])
    actor.send({ type: 'editor.save', submission: { title: firstPrompt.title, text: 'My unsaved revision.', copy: false } })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('editing')).toBe(true))

    expect(actor.getSnapshot().context.editorTarget).toEqual({ id: firstPrompt.id, expectedRevision: firstPrompt.revision })
    expect(actor.getSnapshot().context.editorInitialValues).toEqual({ title: firstPrompt.title, text: firstPrompt.text })
    expect(actor.getSnapshot().context.notice).toContain('changed elsewhere')

    actor.send({ type: 'editor.save', submission: { title: firstPrompt.title, text: 'My unsaved revision.', copy: true } })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('browsing')).toBe(true))

    expect(library.saves[0]?.expectedRevision).toBe(firstPrompt.revision)
    expect(library.saves[1]?.expectedRevision).toBeNull()
    expect(library.prompts()).toHaveLength(2)
    expect(actor.getSnapshot().context.editorTarget).toBeNull()
    actor.stop()
  })

  it('deletes only after the same prompt revision is confirmed twice', async () => {
    const library = createWorkflowClient([firstPrompt])
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    openLibrary(actor)
    const confirmation = { id: firstPrompt.id, revision: firstPrompt.revision }
    actor.send({ type: 'delete.request', confirmation })
    expect(actor.getSnapshot().context.deleteConfirmation).toEqual(confirmation)
    expect(library.removals).toHaveLength(0)
    actor.send({ type: 'delete.request', confirmation })
    await vi.waitFor(() => expect(library.prompts()).toEqual([]))
    await vi.waitFor(() => expect(actor.getSnapshot().matches('browsing')).toBe(true))

    expect(actor.getSnapshot().matches('browsing')).toBe(true)
    expect(library.removals).toEqual([{ id: confirmation.id, expectedRevision: confirmation.revision }])
    expect(library.prompts()).toEqual([])
    expect(actor.getSnapshot().context.deleteConfirmation).toBeNull()
    expect(actor.getSnapshot().context.notice).toBe('Prompt removed.')
    actor.stop()
  })

  it('inserts only a current Host revision and only once per open', async () => {
    const library = createWorkflowClient([firstPrompt])
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    openLibrary(actor)
    library.setLatestRead({ kind: 'ready', prompts: [updatedPrompt] })
    actor.send({ type: 'saved.insert', prompt: { id: firstPrompt.id, revision: firstPrompt.revision } })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('browsing')).toBe(true))

    expect(library.inserted).toEqual([])
    expect(actor.getSnapshot().context.hasInserted).toBe(false)
    expect(actor.getSnapshot().context.notice).toContain('changed elsewhere')

    actor.send({ type: 'saved.insert', prompt: { id: updatedPrompt.id, revision: updatedPrompt.revision } })
    await vi.waitFor(() => expect(actor.getSnapshot().context.hasInserted).toBe(true))
    actor.send({ type: 'recent.insert', text: 'another prompt' })

    expect(library.inserted).toEqual([updatedPrompt.text])
    actor.stop()
  })

  it('inserts recent text through the captured span and reports composer conflicts', () => {
    const library = createWorkflowClient()
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    openLibrary(actor)
    library.setInsertionAllowed(false)
    actor.send({ type: 'recent.insert', text: 'Recent text.' })

    expect(library.inserted).toEqual([])
    expect(actor.getSnapshot().context.hasInserted).toBe(false)
    expect(actor.getSnapshot().context.notice).toContain('composer draft changed')
    actor.stop()
  })

  it('cancels a pending save when the flow closes and ignores its late success', async () => {
    const library = createWorkflowClient()
    let activeSignal: AbortSignal | undefined
    library.deferNextSave(
      async signal =>
        await new Promise(resolve => {
          activeSignal = signal
          signal?.addEventListener('abort', () => resolve({ kind: 'applied', prompts: [] }), { once: true })
        }),
    )
    const actor = createActor(promptLibraryMachine, { input: { client: library.client } }).start()
    openLibrary(actor)
    actor.send({ type: 'editor.new' })
    actor.send({ type: 'editor.save', submission: { title: 'Title', text: 'Text', copy: false } })
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    actor.send({ type: 'close' })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('closed')).toBe(true))

    expect(activeSignal?.aborted).toBe(true)
    expect(actor.getSnapshot().context.editorTarget).toBeNull()
    expect(actor.getSnapshot().context.editorInitialValues).toBeNull()
    expect(actor.getSnapshot().context.notice).toBe('')
    actor.stop()
  })
})
