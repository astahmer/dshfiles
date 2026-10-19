import type { ComposerActionProps } from '@dshfiles/dshx/client'
import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { PromptLibrary, type SavedPrompt } from './library.js'
import type { PromptLibraryClient, PromptLibraryMutation, PromptLibraryRead } from './library-client.js'

export type PromptInsertionSpan = ReturnType<ComposerActionProps['inputActions']['captureInsertion']>
export type PromptEditorTarget = { readonly id: string | null; readonly expectedRevision: string | null }
export type DeleteConfirmation = { readonly id: string; readonly revision: string }

export interface PromptLibraryWorkflowClient extends Pick<PromptLibraryClient, 'save' | 'remove' | 'readLatest' | 'createId' | 'now'> {
  readonly insertText: (text: string, span: PromptInsertionSpan) => boolean
}

interface EditorSubmission {
  readonly title: string
  readonly text: string
  readonly copy: boolean
}

interface PromptLibraryContext {
  readonly client: PromptLibraryWorkflowClient
  readonly insertionSpan: PromptInsertionSpan | null
  readonly hasInserted: boolean
  readonly notice: string
  readonly editorTarget: PromptEditorTarget | null
  readonly pendingEditor: EditorSubmission | null
  readonly deleteConfirmation: DeleteConfirmation | null
  readonly pendingDelete: DeleteConfirmation | null
  readonly pendingCurrentText: string | null
  readonly pendingSavedPrompt: DeleteConfirmation | null
}

interface PromptLibraryInput {
  readonly client: PromptLibraryWorkflowClient
}

type PromptLibraryEvent =
  | { readonly type: 'open'; readonly span: PromptInsertionSpan | null }
  | { readonly type: 'close' }
  | { readonly type: 'client.update'; readonly client: PromptLibraryWorkflowClient }
  | { readonly type: 'editor.new' }
  | { readonly type: 'editor.edit'; readonly target: PromptEditorTarget }
  | { readonly type: 'editor.cancel' }
  | { readonly type: 'editor.save'; readonly submission: EditorSubmission }
  | { readonly type: 'current.save'; readonly text: string }
  | { readonly type: 'delete.request'; readonly confirmation: DeleteConfirmation }
  | { readonly type: 'delete.cancel' }
  | { readonly type: 'saved.insert'; readonly prompt: DeleteConfirmation }
  | { readonly type: 'recent.insert'; readonly text: string }

interface PromptOperationResult {
  readonly kind: PromptLibraryMutation['kind']
  readonly copy?: boolean
}

type PromptInsertResult = { readonly kind: 'inserted' } | { readonly kind: 'stale' } | { readonly kind: 'unavailable' } | { readonly kind: 'blocked' }

interface EditorSaveInput {
  readonly client: PromptLibraryWorkflowClient
  readonly target: PromptEditorTarget
  readonly submission: EditorSubmission
}

const saveEditor = fromPromise<PromptOperationResult, EditorSaveInput>(async ({ input, signal }) => {
  const makeCopy = input.submission.copy || input.target.id === null
  const prompt: SavedPrompt = {
    id: makeCopy ? input.client.createId() : (input.target.id ?? input.client.createId()),
    revision: input.client.createId(),
    title: input.submission.title.trim() || PromptLibrary.defaultTitle(input.submission.text),
    text: input.submission.text,
    updatedAt: input.client.now(),
  }
  const result = await input.client.save({ prompt, expectedRevision: makeCopy ? null : input.target.expectedRevision }, { signal })
  return { kind: result.kind, copy: input.submission.copy }
})

interface SaveCurrentInput {
  readonly client: PromptLibraryWorkflowClient
  readonly text: string
}

const saveCurrent = fromPromise<PromptOperationResult, SaveCurrentInput>(async ({ input, signal }) => {
  const prompt: SavedPrompt = {
    id: input.client.createId(),
    revision: input.client.createId(),
    title: PromptLibrary.defaultTitle(input.text),
    text: input.text,
    updatedAt: input.client.now(),
  }
  const result = await input.client.save({ prompt, expectedRevision: null }, { signal })
  return { kind: result.kind }
})

interface DeletePromptInput {
  readonly client: PromptLibraryWorkflowClient
  readonly confirmation: DeleteConfirmation
}

const deletePrompt = fromPromise<PromptOperationResult, DeletePromptInput>(async ({ input, signal }) => {
  const result = await input.client.remove({ id: input.confirmation.id, expectedRevision: input.confirmation.revision }, { signal })
  return { kind: result.kind }
})

interface InsertSavedInput {
  readonly client: PromptLibraryWorkflowClient
  readonly span: PromptInsertionSpan
  readonly prompt: DeleteConfirmation
}

const insertSaved = fromPromise<PromptInsertResult, InsertSavedInput>(async ({ input, signal }) => {
  const latest: PromptLibraryRead = await input.client.readLatest({ signal })
  signal.throwIfAborted()
  if (latest.kind !== 'ready') return { kind: 'unavailable' }

  const prompt = latest.prompts.find(item => item.id === input.prompt.id)
  if (prompt === undefined || prompt.revision !== input.prompt.revision) return { kind: 'stale' }
  return input.client.insertText(prompt.text, input.span) ? { kind: 'inserted' } : { kind: 'blocked' }
})

const editorSaveCompletion = (result: PromptOperationResult) => {
  if (result.kind === 'applied') {
    return {
      editorTarget: null,
      pendingEditor: null,
      notice: result.copy ? 'Saved as a new prompt copy.' : 'Saved to the prompt library.',
    }
  }
  if (result.kind === 'conflict') {
    return { pendingEditor: null, notice: 'This saved prompt changed elsewhere. Your edits remain here; save a copy or reopen it.' }
  }
  if (result.kind === 'limit') return { pendingEditor: null, notice: 'This library reached its size limit. Edit or remove a saved prompt first.' }
  return { pendingEditor: null, notice: 'The saved library changed or became unavailable. Your editor text is still here.' }
}

const currentSaveCompletion = (result: PromptOperationResult) => {
  const notice =
    result.kind === 'applied'
      ? 'Current composer text saved as a prompt. The composer was not changed.'
      : result.kind === 'limit'
        ? 'The saved prompt limit was reached. Remove a prompt before saving another.'
        : result.kind === 'conflict'
          ? 'The prompt library changed elsewhere. Try saving again.'
          : 'The saved library is unavailable. The composer text is unchanged.'
  return { pendingCurrentText: null, notice }
}

const deleteCompletion = (result: PromptOperationResult) => {
  const notice =
    result.kind === 'applied'
      ? 'Prompt removed.'
      : result.kind === 'conflict'
        ? 'This prompt changed elsewhere. Nothing was deleted.'
        : 'The saved library changed or became unavailable. Nothing was deleted.'
  return { pendingDelete: null, deleteConfirmation: null, notice }
}

const savedInsertCompletion = (result: PromptInsertResult) => {
  if (result.kind === 'inserted')
    return { pendingSavedPrompt: null, hasInserted: true, notice: 'Inserted at the saved cursor position. The message was not sent.' }
  if (result.kind === 'stale') return { pendingSavedPrompt: null, notice: 'This prompt changed elsewhere. Choose it again from the refreshed list.' }
  if (result.kind === 'blocked') return { pendingSavedPrompt: null, notice: 'The composer draft changed. Close and reopen the prompt stash before inserting.' }
  return { pendingSavedPrompt: null, notice: 'The saved library changed or became unavailable. Nothing was inserted.' }
}

export const promptLibraryMachine = setup({
  // SAFETY: XState uses these empty carriers for inference; nothing reads their values.
  types: {
    context: {} as PromptLibraryContext,
    input: {} as PromptLibraryInput,
    events: {} as PromptLibraryEvent,
  },
  actors: {
    saveEditor,
    saveCurrent,
    deletePrompt,
    insertSaved,
  },
  guards: {
    confirmsDelete: ({ context, event }) =>
      event.type === 'delete.request' &&
      context.deleteConfirmation?.id === event.confirmation.id &&
      context.deleteConfirmation.revision === event.confirmation.revision,
    canInsert: ({ context }) => !context.hasInserted && context.insertionSpan !== null,
    missingSpan: ({ context }) => !context.hasInserted && context.insertionSpan === null,
  },
  actions: {
    updateClient: assign(({ event }) => (event.type === 'client.update' ? { client: event.client } : {})),
    open: assign(({ event }) =>
      event.type === 'open'
        ? {
            insertionSpan: event.span,
            hasInserted: false,
            notice: '',
            editorTarget: null,
            pendingEditor: null,
            deleteConfirmation: null,
            pendingDelete: null,
            pendingCurrentText: null,
            pendingSavedPrompt: null,
          }
        : {},
    ),
    close: assign(() => ({
      insertionSpan: null,
      hasInserted: false,
      notice: '',
      editorTarget: null,
      pendingEditor: null,
      deleteConfirmation: null,
      pendingDelete: null,
      pendingCurrentText: null,
      pendingSavedPrompt: null,
    })),
    beginNewEditor: assign(() => ({ editorTarget: { id: null, expectedRevision: null }, pendingEditor: null, deleteConfirmation: null, notice: '' })),
    beginEdit: assign(({ event }) =>
      event.type === 'editor.edit' ? { editorTarget: event.target, pendingEditor: null, deleteConfirmation: null, notice: '' } : {},
    ),
    cancelEditor: assign(() => ({ editorTarget: null, pendingEditor: null, notice: '' })),
    beginEditorSave: assign(({ event }) => (event.type === 'editor.save' ? { pendingEditor: event.submission, notice: '' } : {})),
    clearEditorSubmission: assign(() => ({ pendingEditor: null })),
    beginCurrentSave: assign(({ event }) => (event.type === 'current.save' ? { pendingCurrentText: event.text, notice: '' } : {})),
    clearCurrentSave: assign(() => ({ pendingCurrentText: null })),
    requestDelete: assign(({ event }) =>
      event.type === 'delete.request'
        ? {
            deleteConfirmation: event.confirmation,
            pendingDelete: null,
            notice: 'Select Confirm delete to remove this saved prompt.',
          }
        : {},
    ),
    beginDelete: assign(({ event }) => (event.type === 'delete.request' ? { pendingDelete: event.confirmation, deleteConfirmation: null, notice: '' } : {})),
    clearDelete: assign(() => ({ pendingDelete: null, deleteConfirmation: null })),
    cancelDelete: assign(() => ({ deleteConfirmation: null, notice: '' })),
    beginSavedInsert: assign(({ event }) => (event.type === 'saved.insert' ? { pendingSavedPrompt: event.prompt, notice: '' } : {})),
    clearSavedInsert: assign(() => ({ pendingSavedPrompt: null })),
    insertRecent: assign(({ context, event }) => {
      if (event.type !== 'recent.insert' || context.insertionSpan === null) return {}
      if (!context.client.insertText(event.text, context.insertionSpan)) {
        return { notice: 'The composer draft changed. Close and reopen the prompt stash before inserting.' }
      }
      return { hasInserted: true, notice: 'Inserted at the saved cursor position. The message was not sent.' }
    }),
    noticeMissingSpan: assign(() => ({ notice: 'Close and reopen the prompt stash to choose a fresh insertion point.' })),
  },
}).createMachine({
  id: 'promptLibrary',
  context: ({ input }) => ({
    client: input.client,
    insertionSpan: null,
    hasInserted: false,
    notice: '',
    editorTarget: null,
    pendingEditor: null,
    deleteConfirmation: null,
    pendingDelete: null,
    pendingCurrentText: null,
    pendingSavedPrompt: null,
  }),
  initial: 'closed',
  on: {
    'client.update': { actions: 'updateClient' },
    close: { target: '#promptLibrary.closed', actions: 'close' },
  },
  states: {
    closed: {
      on: { open: { target: 'browsing', actions: 'open' } },
    },
    browsing: {
      on: {
        'editor.new': { target: 'editing', actions: 'beginNewEditor' },
        'editor.edit': { target: 'editing', actions: 'beginEdit' },
        'current.save': { target: 'savingCurrent', actions: 'beginCurrentSave' },
        'delete.request': [{ guard: 'confirmsDelete', target: 'deleting', actions: 'beginDelete' }, { actions: 'requestDelete' }],
        'delete.cancel': { actions: 'cancelDelete' },
        'saved.insert': [
          { guard: 'canInsert', target: 'insertingSaved', actions: 'beginSavedInsert' },
          { guard: 'missingSpan', actions: 'noticeMissingSpan' },
        ],
        'recent.insert': [
          { guard: 'canInsert', actions: 'insertRecent' },
          { guard: 'missingSpan', actions: 'noticeMissingSpan' },
        ],
      },
    },
    editing: {
      on: {
        'editor.cancel': { target: 'browsing', actions: 'cancelEditor' },
        'editor.save': { target: 'savingEditor', actions: 'beginEditorSave' },
      },
    },
    savingEditor: {
      invoke: {
        src: 'saveEditor',
        input: ({ context }) => ({
          client: context.client,
          target: context.editorTarget ?? { id: null, expectedRevision: null },
          submission: context.pendingEditor ?? { title: '', text: '', copy: false },
        }),
        onDone: [
          { guard: ({ event }) => event.output.kind === 'applied', target: 'browsing', actions: assign(({ event }) => editorSaveCompletion(event.output)) },
          { target: 'editing', actions: assign(({ event }) => editorSaveCompletion(event.output)) },
        ],
      },
      always: { guard: ({ context }) => context.editorTarget === null, target: 'browsing', actions: 'cancelEditor' },
    },
    savingCurrent: {
      invoke: {
        src: 'saveCurrent',
        input: ({ context }) => ({ client: context.client, text: context.pendingCurrentText ?? '' }),
        onDone: { target: 'browsing', actions: assign(({ event }) => currentSaveCompletion(event.output)) },
      },
    },
    deleting: {
      invoke: {
        src: 'deletePrompt',
        input: ({ context }) => ({
          client: context.client,
          confirmation: context.pendingDelete ?? { id: '', revision: '' },
        }),
        onDone: { target: 'browsing', actions: assign(({ event }) => deleteCompletion(event.output)) },
      },
    },
    insertingSaved: {
      invoke: {
        src: 'insertSaved',
        input: ({ context }) => ({
          client: context.client,
          span: context.insertionSpan ?? { start: 0, end: 0, draftRev: 0 },
          prompt: context.pendingSavedPrompt ?? { id: '', revision: '' },
        }),
        onDone: { target: 'browsing', actions: assign(({ event }) => savedInsertCompletion(event.output)) },
      },
    },
  },
})
