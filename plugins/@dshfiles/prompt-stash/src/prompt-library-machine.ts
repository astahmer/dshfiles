import type { ComposerActionProps } from '@dshfiles/dshx/client'
import { assign, fromCallback, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { PromptLibrary, type PromptMutation, type SavedPrompt } from './library.js'

export type PromptLibraryState = 'loading' | 'ready' | 'invalid' | 'unavailable'
export type PromptInsertionSpan = ReturnType<ComposerActionProps['inputActions']['captureInsertion']>

export type PromptLibraryStorageRead =
  | { readonly kind: 'ready'; readonly prompts: readonly SavedPrompt[] }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' }

export interface PromptEditor {
  readonly id: string | null
  readonly originalRevision: string | null
  readonly title: string
  readonly text: string
  readonly stale: boolean
}

export interface DeleteConfirmation {
  readonly id: string
  readonly revision: string
}

export interface PromptLibraryClient {
  readonly read: () => PromptLibraryStorageRead
  readonly subscribe: (listener: (serialized: string | null) => void) => () => void
  readonly write: (serialized: string) => void
  readonly createId: () => string
  readonly now: () => number
  readonly insertText: (text: string, span: PromptInsertionSpan) => boolean
}

interface PromptLibraryContext {
  readonly client: PromptLibraryClient
  readonly activeSource: 'saved' | 'recent'
  readonly libraryState: PromptLibraryState
  readonly prompts: readonly SavedPrompt[]
  readonly editor: PromptEditor | null
  readonly saveAsCopy: boolean
  readonly deleteConfirmation: DeleteConfirmation | null
  readonly hasInserted: boolean
  readonly notice: string
  readonly insertionSpan: PromptInsertionSpan | null
}

interface PromptLibraryInput {
  readonly client: PromptLibraryClient
}

interface StorageChangedEvent {
  readonly type: 'storage.changed'
  readonly serialized: string | null
}

type PromptLibraryEvent =
  | { readonly type: 'open'; readonly span: PromptInsertionSpan | null }
  | { readonly type: 'close' }
  | { readonly type: 'source.change'; readonly source: 'saved' | 'recent' }
  | { readonly type: 'prompt.new' }
  | { readonly type: 'prompt.edit'; readonly prompt: SavedPrompt }
  | { readonly type: 'editor.change'; readonly field: 'title' | 'text'; readonly value: string }
  | { readonly type: 'editor.cancel' }
  | { readonly type: 'editor.save'; readonly copy: boolean }
  | { readonly type: 'current.save'; readonly text: string }
  | { readonly type: 'delete.request'; readonly prompt: SavedPrompt }
  | { readonly type: 'delete.cancel' }
  | { readonly type: 'saved.insert'; readonly prompt: SavedPrompt }
  | { readonly type: 'recent.insert'; readonly prompt: { readonly id: string; readonly text: string } }
  | { readonly type: 'notice'; readonly message: string }
  | StorageChangedEvent

type LibraryMutationResult =
  | { readonly kind: 'applied'; readonly prompts: readonly SavedPrompt[]; readonly notice: string }
  | { readonly kind: 'conflict'; readonly prompts: readonly SavedPrompt[]; readonly notice: string }
  | { readonly kind: 'blocked'; readonly libraryState: 'ready' | 'invalid' | 'unavailable'; readonly prompts?: readonly SavedPrompt[]; readonly notice: string }

type InsertResult =
  | { readonly kind: 'inserted' }
  | { readonly kind: 'stale'; readonly prompts: readonly SavedPrompt[] }
  | { readonly kind: 'blocked'; readonly libraryState?: 'invalid' | 'unavailable'; readonly notice: string }

const blockedRead = (read: PromptLibraryStorageRead, notice: string): LibraryMutationResult => {
  if (read.kind === 'ready') return { kind: 'blocked', libraryState: 'ready', prompts: read.prompts, notice }
  return { kind: 'blocked', libraryState: read.kind, notice }
}

const persistPrompts = (client: PromptLibraryClient, prompts: readonly SavedPrompt[], successNotice: string): LibraryMutationResult => {
  const serialized = PromptLibrary.serialize(prompts)
  if (serialized === null)
    return { kind: 'blocked', libraryState: 'ready', prompts, notice: 'This library reached its size limit. Edit or remove a saved prompt first.' }
  try {
    client.write(serialized)
    return { kind: 'applied', prompts, notice: successNotice }
  } catch {
    return { kind: 'blocked', libraryState: 'unavailable', notice: 'The browser could not save this prompt. The current library is unchanged.' }
  }
}

const saveEditor = (input: { readonly client: PromptLibraryClient; readonly editor: PromptEditor | null; readonly copy: boolean }): LibraryMutationResult => {
  if (input.editor === null) return { kind: 'blocked', libraryState: 'ready', notice: 'The prompt editor is no longer open.' }
  if (input.editor.text.trim().length === 0) return { kind: 'blocked', libraryState: 'ready', notice: 'Add prompt text before saving.' }
  const latest = input.client.read()
  if (latest.kind !== 'ready') return blockedRead(latest, 'The saved library changed or became unavailable. Your editor text is still here.')

  const makeCopy = input.copy || input.editor.id === null
  if (makeCopy && latest.prompts.length >= PromptLibrary.maxPrompts) {
    return { kind: 'blocked', libraryState: 'ready', prompts: latest.prompts, notice: 'The saved prompt limit is 50. Remove a prompt before saving another.' }
  }

  const nextPrompt: SavedPrompt = {
    id: makeCopy ? input.client.createId() : (input.editor.id ?? input.client.createId()),
    revision: input.client.createId(),
    title: input.editor.title.trim() || PromptLibrary.defaultTitle(input.editor.text),
    text: input.editor.text,
    updatedAt: input.client.now(),
  }
  const result: PromptMutation = PromptLibrary.writeIfCurrent(latest.prompts, nextPrompt, makeCopy ? null : input.editor.originalRevision)
  if (result.kind === 'conflict') {
    return { kind: 'conflict', prompts: result.prompts, notice: 'This saved prompt changed in another tab. Your edits remain here; save a copy or reopen it.' }
  }
  return persistPrompts(input.client, result.prompts, 'Saved in this browser.')
}

const saveCurrentPrompt = (input: { readonly client: PromptLibraryClient; readonly text: string }): LibraryMutationResult => {
  if (input.text.trim().length === 0) return { kind: 'blocked', libraryState: 'ready', notice: 'Enter text before saving a prompt.' }
  if (input.text.length > PromptLibrary.maxPromptTextLength) {
    return {
      kind: 'blocked',
      libraryState: 'ready',
      notice: `Current text exceeds the ${PromptLibrary.maxPromptTextLength.toLocaleString()} character prompt limit.`,
    }
  }
  const latest = input.client.read()
  if (latest.kind !== 'ready') return blockedRead(latest, 'The saved library is unavailable. The composer text is unchanged.')
  if (latest.prompts.length >= PromptLibrary.maxPrompts) {
    return {
      kind: 'blocked',
      libraryState: 'ready',
      prompts: latest.prompts,
      notice: `The saved prompt limit is ${PromptLibrary.maxPrompts}. Remove a prompt before saving another.`,
    }
  }

  const prompt: SavedPrompt = {
    id: input.client.createId(),
    revision: input.client.createId(),
    title: PromptLibrary.defaultTitle(input.text),
    text: input.text,
    updatedAt: input.client.now(),
  }
  const result = PromptLibrary.writeIfCurrent(latest.prompts, prompt, null)
  if (result.kind === 'conflict') return { kind: 'conflict', prompts: result.prompts, notice: 'The prompt library changed in another tab. Try saving again.' }
  return persistPrompts(input.client, result.prompts, 'Current composer text saved as a prompt. The composer was not changed.')
}

const deletePrompt = (input: { readonly client: PromptLibraryClient; readonly confirmation: DeleteConfirmation | null }): LibraryMutationResult => {
  if (input.confirmation === null) return { kind: 'blocked', libraryState: 'ready', notice: 'Choose a prompt before confirming deletion.' }
  const latest = input.client.read()
  if (latest.kind !== 'ready') return blockedRead(latest, 'The saved library changed or became unavailable. Nothing was deleted.')
  const result = PromptLibrary.removeIfCurrent(latest.prompts, input.confirmation.id, input.confirmation.revision)
  if (result.kind === 'conflict') return { kind: 'conflict', prompts: result.prompts, notice: 'This prompt changed in another tab. Nothing was deleted.' }
  return persistPrompts(input.client, result.prompts, 'Prompt removed.')
}

const insertSavedPrompt = (input: {
  readonly client: PromptLibraryClient
  readonly span: PromptInsertionSpan | null
  readonly prompt: SavedPrompt | null
}): InsertResult => {
  if (input.span === null || input.prompt === null) return { kind: 'blocked', notice: 'Close and reopen the prompt stash to choose a fresh insertion point.' }
  const latest = input.client.read()
  if (latest.kind !== 'ready') {
    return {
      kind: 'blocked',
      libraryState: latest.kind,
      notice: 'The saved library changed or became unavailable. Nothing was inserted.',
    }
  }
  const current = latest.prompts.find(prompt => prompt.id === input.prompt?.id)
  if (current === undefined || current.revision !== input.prompt.revision) return { kind: 'stale', prompts: latest.prompts }
  try {
    return input.client.insertText(current.text, input.span)
      ? { kind: 'inserted' }
      : { kind: 'blocked', notice: 'The composer draft changed. Close and reopen the prompt stash before inserting.' }
  } catch {
    return { kind: 'blocked', notice: 'The composer draft changed. Close and reopen the prompt stash before inserting.' }
  }
}

const insertRecentPrompt = (input: {
  readonly client: PromptLibraryClient
  readonly span: PromptInsertionSpan | null
  readonly prompt: { readonly id: string; readonly text: string } | null
}): Exclude<InsertResult, { readonly kind: 'stale' }> => {
  if (input.span === null) return { kind: 'blocked', notice: 'Close and reopen the prompt stash to choose a fresh insertion point.' }
  if (input.prompt === null) return { kind: 'blocked', notice: 'This message is no longer in the loaded conversation.' }
  try {
    return input.client.insertText(input.prompt.text, input.span)
      ? { kind: 'inserted' }
      : { kind: 'blocked', notice: 'The composer draft changed. Close and reopen the prompt stash before inserting.' }
  } catch {
    return { kind: 'blocked', notice: 'The composer draft changed. Close and reopen the prompt stash before inserting.' }
  }
}

const applyStorage = (context: PromptLibraryContext, serialized: string | null) => {
  const latest = PromptLibrary.read(serialized)
  if (!latest.ok) {
    return {
      libraryState: 'invalid' as const,
      deleteConfirmation: null,
      notice: 'Saved prompts changed to data this version cannot read. Stored data was left untouched.',
    }
  }
  return {
    libraryState: 'ready' as const,
    prompts: latest.prompts,
    deleteConfirmation: null,
    editor:
      context.editor === null || context.editor.id === null
        ? context.editor
        : latest.prompts.find(prompt => prompt.id === context.editor?.id)?.revision === context.editor.originalRevision
          ? context.editor
          : { ...context.editor, stale: true },
  }
}

// SAFETY: XState uses these empty carriers for inference; nothing reads their values.
export const promptLibraryMachine = setup({
  types: {
    context: {} as PromptLibraryContext,
    input: {} as PromptLibraryInput,
    events: {} as PromptLibraryEvent,
  },
  actors: {
    watchStorage: fromCallback<PromptLibraryEvent, PromptLibraryClient>(({ input, sendBack }) =>
      input.subscribe(serialized => sendBack({ type: 'storage.changed', serialized })),
    ),
    load: fromPromise<PromptLibraryStorageRead, { readonly client: PromptLibraryClient }>(({ input }) => {
      try {
        return Promise.resolve(input.client.read())
      } catch {
        return Promise.resolve({ kind: 'unavailable' })
      }
    }),
    saveEditor: fromPromise<LibraryMutationResult, { readonly client: PromptLibraryClient; readonly editor: PromptEditor | null; readonly copy: boolean }>(
      ({ input }) => Promise.resolve(saveEditor(input)),
    ),
    saveCurrent: fromPromise<LibraryMutationResult, { readonly client: PromptLibraryClient; readonly text: string }>(({ input }) =>
      Promise.resolve(saveCurrentPrompt(input)),
    ),
    deletePrompt: fromPromise<LibraryMutationResult, { readonly client: PromptLibraryClient; readonly confirmation: DeleteConfirmation | null }>(({ input }) =>
      Promise.resolve(deletePrompt(input)),
    ),
    insertSaved: fromPromise<
      InsertResult,
      { readonly client: PromptLibraryClient; readonly span: PromptInsertionSpan | null; readonly prompt: SavedPrompt | null }
    >(({ input }) => Promise.resolve(insertSavedPrompt(input))),
    insertRecent: fromPromise<
      Exclude<InsertResult, { readonly kind: 'stale' }>,
      {
        readonly client: PromptLibraryClient
        readonly span: PromptInsertionSpan | null
        readonly prompt: { readonly id: string; readonly text: string } | null
      }
    >(({ input }) => Promise.resolve(insertRecentPrompt(input))),
  },
  guards: {
    canInsert: ({ context }) => !context.hasInserted,
    confirmsDelete: ({ context, event }) =>
      event.type === 'delete.request' && context.deleteConfirmation?.id === event.prompt.id && context.deleteConfirmation.revision === event.prompt.revision,
  },
  actions: {
    beginOpen: assign(({ event }) =>
      event.type === 'open'
        ? {
            activeSource: 'saved' as const,
            editor: null,
            deleteConfirmation: null,
            hasInserted: false,
            notice: '',
            insertionSpan: event.span,
          }
        : {},
    ),
    closeLibrary: assign(() => ({ editor: null, deleteConfirmation: null, notice: '', insertionSpan: null })),
    changeSource: assign(({ event }) => (event.type === 'source.change' ? { activeSource: event.source } : {})),
    beginNewPrompt: assign(() => ({ editor: { id: null, originalRevision: null, title: '', text: '', stale: false }, deleteConfirmation: null, notice: '' })),
    beginEdit: assign(({ event }) =>
      event.type === 'prompt.edit'
        ? {
            editor: { id: event.prompt.id, originalRevision: event.prompt.revision, title: event.prompt.title, text: event.prompt.text, stale: false },
            deleteConfirmation: null,
            notice: '',
          }
        : {},
    ),
    updateEditor: assign(({ context, event }) =>
      event.type !== 'editor.change' || context.editor === null ? {} : { editor: { ...context.editor, [event.field]: event.value } },
    ),
    cancelEditor: assign(() => ({ editor: null, notice: '' })),
    beginEditorSave: assign(({ event }) => (event.type === 'editor.save' ? { saveAsCopy: event.copy, notice: '' } : {})),
    beginCurrentSave: assign(() => ({ notice: '' })),
    beginDelete: assign(({ event }) =>
      event.type === 'delete.request'
        ? { deleteConfirmation: { id: event.prompt.id, revision: event.prompt.revision }, notice: 'Select Confirm delete to remove this saved prompt.' }
        : {},
    ),
    cancelDelete: assign(() => ({ deleteConfirmation: null, notice: '' })),
    setNotice: assign(({ event }) => (event.type === 'notice' ? { notice: event.message } : {})),
    syncStorage: assign(({ context, event }) => (event.type === 'storage.changed' ? applyStorage(context, event.serialized) : {})),
  },
}).createMachine({
  id: 'promptLibrary',
  context: ({ input }) => ({
    client: input.client,
    activeSource: 'saved',
    libraryState: 'loading',
    prompts: [],
    editor: null,
    saveAsCopy: false,
    deleteConfirmation: null,
    hasInserted: false,
    notice: '',
    insertionSpan: null,
  }),
  initial: 'closed',
  invoke: { src: 'watchStorage', input: ({ context }) => context.client },
  on: { 'storage.changed': { actions: 'syncStorage' } },
  states: {
    closed: { on: { open: { target: 'loading', actions: 'beginOpen' } } },
    loading: {
      invoke: {
        src: 'load',
        input: ({ context }) => ({ client: context.client }),
        onDone: {
          target: 'browse',
          actions: assign(({ event }) => {
            const result = event.output
            return result.kind === 'ready'
              ? { libraryState: 'ready' as const, prompts: result.prompts, notice: '' }
              : {
                  libraryState: result.kind,
                  notice: result.kind === 'invalid' ? 'Saved prompts could not be read. Stored data was left untouched.' : 'Browser storage is unavailable.',
                }
          }),
        },
      },
      on: {
        close: { target: 'closed', actions: 'closeLibrary' },
        'storage.changed': { target: 'browse', actions: 'syncStorage' },
      },
    },
    browse: {
      on: {
        close: { target: 'closed', actions: 'closeLibrary' },
        'source.change': { actions: 'changeSource' },
        'prompt.new': { target: 'editing', actions: 'beginNewPrompt' },
        'prompt.edit': { target: 'editing', actions: 'beginEdit' },
        'current.save': { target: 'savingCurrent', actions: 'beginCurrentSave' },
        'delete.request': { target: 'confirmingDelete', actions: 'beginDelete' },
        'saved.insert': { guard: 'canInsert', target: 'insertingSaved' },
        'recent.insert': { guard: 'canInsert', target: 'insertingRecent' },
        notice: { actions: 'setNotice' },
      },
    },
    editing: {
      on: {
        close: { target: 'closed', actions: 'closeLibrary' },
        'editor.change': { actions: 'updateEditor' },
        'editor.cancel': { target: 'browse', actions: 'cancelEditor' },
        'editor.save': { target: 'savingEditor', actions: 'beginEditorSave' },
        notice: { actions: 'setNotice' },
        'storage.changed': { actions: 'syncStorage' },
      },
    },
    savingEditor: {
      invoke: {
        src: 'saveEditor',
        input: ({ context }) => ({ client: context.client, editor: context.editor, copy: context.saveAsCopy }),
        onDone: [
          {
            guard: ({ event }) => event.output.kind === 'applied',
            target: 'browse',
            actions: assign(({ event }) => {
              const result = event.output
              return result.kind === 'applied' ? { prompts: result.prompts, libraryState: 'ready' as const, editor: null, notice: result.notice } : {}
            }),
          },
          {
            guard: ({ event }) => event.output.kind === 'conflict',
            target: 'editing',
            actions: assign(({ context, event }) => {
              const result = event.output
              return result.kind === 'conflict'
                ? {
                    prompts: result.prompts,
                    libraryState: 'ready' as const,
                    editor: context.editor === null ? null : { ...context.editor, stale: true },
                    notice: result.notice,
                  }
                : {}
            }),
          },
          {
            target: 'editing',
            actions: assign(({ context, event }) => {
              const result = event.output
              if (result.kind !== 'blocked') return {}
              if (result.prompts === undefined) return { libraryState: result.libraryState, editor: context.editor, notice: result.notice }
              return { libraryState: result.libraryState, prompts: result.prompts, editor: context.editor, notice: result.notice }
            }),
          },
        ],
      },
      on: { close: { target: 'closed', actions: 'closeLibrary' } },
    },
    savingCurrent: {
      invoke: {
        src: 'saveCurrent',
        input: ({ context, event }) => ({ client: context.client, text: event.type === 'current.save' ? event.text : '' }),
        onDone: {
          target: 'browse',
          actions: assign(({ event }) => {
            const result = event.output
            return {
              libraryState: result.kind === 'blocked' ? result.libraryState : 'ready',
              ...(result.kind === 'blocked' ? (result.prompts === undefined ? {} : { prompts: result.prompts }) : { prompts: result.prompts }),
              notice: result.notice,
            }
          }),
        },
      },
      on: { close: { target: 'closed', actions: 'closeLibrary' } },
    },
    confirmingDelete: {
      on: {
        close: { target: 'closed', actions: 'closeLibrary' },
        'delete.cancel': { target: 'browse', actions: 'cancelDelete' },
        'delete.request': [
          { guard: 'confirmsDelete', target: 'deleting' },
          { target: 'confirmingDelete', actions: 'beginDelete' },
        ],
        'storage.changed': { target: 'browse', actions: 'syncStorage' },
      },
    },
    deleting: {
      invoke: {
        src: 'deletePrompt',
        input: ({ context }) => ({ client: context.client, confirmation: context.deleteConfirmation }),
        onDone: {
          target: 'browse',
          actions: assign(({ event }) => {
            const result = event.output
            const libraryState = result.kind === 'blocked' ? result.libraryState : 'ready'
            if (result.prompts === undefined) return { libraryState, deleteConfirmation: null, notice: result.notice }
            return { libraryState, prompts: result.prompts, deleteConfirmation: null, notice: result.notice }
          }),
        },
      },
      on: { close: { target: 'closed', actions: 'closeLibrary' } },
    },
    insertingSaved: {
      invoke: {
        src: 'insertSaved',
        input: ({ context, event }) => ({
          client: context.client,
          span: context.insertionSpan,
          prompt: event.type === 'saved.insert' ? event.prompt : null,
        }),
        onDone: {
          target: 'browse',
          actions: assign(({ event }) => {
            const result = event.output
            if (result.kind === 'inserted') return { hasInserted: true, notice: 'Inserted at the saved cursor position. The message was not sent.' }
            if (result.kind === 'stale')
              return {
                prompts: result.prompts,
                libraryState: 'ready' as const,
                notice: 'This prompt changed in another tab. Choose it again from the refreshed list.',
              }
            if (result.libraryState === undefined) return { notice: result.notice }
            return { libraryState: result.libraryState, notice: result.notice }
          }),
        },
      },
      on: { close: { target: 'closed', actions: 'closeLibrary' } },
    },
    insertingRecent: {
      invoke: {
        src: 'insertRecent',
        input: ({ context, event }) => ({
          client: context.client,
          span: context.insertionSpan,
          prompt: event.type === 'recent.insert' ? event.prompt : null,
        }),
        onDone: {
          target: 'browse',
          actions: assign(({ event }) =>
            event.output.kind === 'inserted'
              ? { hasInserted: true, notice: 'Inserted at the saved cursor position. The message was not sent.' }
              : { notice: event.output.notice },
          ),
        },
      },
      on: { close: { target: 'closed', actions: 'closeLibrary' } },
    },
  },
})
