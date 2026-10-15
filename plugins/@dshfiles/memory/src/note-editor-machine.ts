import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import type { ApiClientInput } from '@dshfiles/dshx/api'
import type { memoryApi, PanelNote } from './api.ts'

export type NoteEditorSeed = Pick<PanelNote, 'id' | 'text' | 'type' | 'scope'>
type EditNoteInput = ApiClientInput<typeof memoryApi.methods.editNote>
type ForgetNoteInput = ApiClientInput<typeof memoryApi.methods.forgetNote>

export interface NoteEditorClient {
  readonly save: (input: EditNoteInput, signal: AbortSignal) => Promise<void>
  readonly forget: (input: ForgetNoteInput, signal: AbortSignal) => Promise<void>
}

interface NoteEditorDraft {
  readonly text: string
  readonly type: PanelNote['type']
  readonly scope: string
  readonly reason: string
}

interface SaveWrite {
  readonly kind: 'save'
  readonly input: EditNoteInput
}

interface ForgetWrite {
  readonly kind: 'forget'
  readonly input: ForgetNoteInput
}

type NoteWrite = SaveWrite | ForgetWrite

interface NoteEditorContext {
  readonly note: NoteEditorSeed
  readonly draft: NoteEditorDraft
  readonly preview: boolean
  readonly operationId: number
  readonly write: NoteWrite | null
  readonly failure: string | null
}

interface NoteEditorInput {
  readonly note: NoteEditorSeed
}

interface NoteEditorEvent {
  readonly type: 'edit' | 'forget' | 'cancel' | 'preview.toggle' | 'save' | 'forget.confirm'
}

interface NoteEditorTextEvent {
  readonly type: 'text.change' | 'scope.change' | 'reason.change'
  readonly value: string
}

interface NoteEditorTypeEvent {
  readonly type: 'type.change'
  readonly value: PanelNote['type']
}

type NoteEditorMachineEvent = NoteEditorEvent | NoteEditorTextEvent | NoteEditorTypeEvent

type NoteEditorResult =
  | { readonly operationId: number; readonly status: 'saved' | 'forgotten' }
  | { readonly operationId: number; readonly status: 'failed'; readonly failure: string }

interface NoteEditorActorInput {
  readonly operationId: number
  readonly write: NoteWrite
}

export const createNoteEditorActor = (client: NoteEditorClient) =>
  fromPromise<NoteEditorResult, NoteEditorActorInput>(async ({ input, signal }) => {
    try {
      if (input.write.kind === 'save') {
        await client.save(input.write.input, signal)
        return { operationId: input.operationId, status: 'saved' }
      }
      await client.forget(input.write.input, signal)
      return { operationId: input.operationId, status: 'forgotten' }
    } catch (error) {
      return { operationId: input.operationId, status: 'failed', failure: errorMessage(error, 'The change failed.') }
    }
  })

// SAFETY: XState uses these empty carriers for inference; nothing reads their values.
export const noteEditorMachine = setup({
  types: {
    context: {} as NoteEditorContext,
    events: {} as NoteEditorMachineEvent,
    input: {} as NoteEditorInput,
  },
  actors: {
    persist: fromPromise<NoteEditorResult, NoteEditorActorInput>(() => {
      throw new Error('Note editor machine requires a persistence actor.')
    }),
  },
  guards: {
    hasText: ({ context }) => context.draft.text.trim().length > 0,
  },
  actions: {
    beginEdit: assign(({ context }) => ({
      operationId: context.operationId + 1,
      draft: { text: context.note.text, type: context.note.type, scope: context.note.scope, reason: '' },
      preview: false,
      write: null,
      failure: null,
    })),
    beginForget: assign(({ context }) => ({
      operationId: context.operationId + 1,
      draft: { ...context.draft, reason: '' },
      write: null,
      failure: null,
    })),
    updateText: assign(({ context, event }) => (event.type === 'text.change' ? { draft: { ...context.draft, text: event.value }, failure: null } : {})),
    updateType: assign(({ context, event }) => (event.type === 'type.change' ? { draft: { ...context.draft, type: event.value }, failure: null } : {})),
    updateScope: assign(({ context, event }) => (event.type === 'scope.change' ? { draft: { ...context.draft, scope: event.value }, failure: null } : {})),
    updateReason: assign(({ context, event }) => (event.type === 'reason.change' ? { draft: { ...context.draft, reason: event.value }, failure: null } : {})),
    togglePreview: assign(({ context }) => ({ preview: !context.preview })),
    captureSave: assign(({ context }) => ({
      operationId: context.operationId + 1,
      write: {
        kind: 'save',
        input: {
          id: context.note.id,
          text: context.draft.text,
          type: context.draft.type,
          scope: context.draft.scope,
          reason: context.draft.reason,
        },
      },
      failure: null,
    })),
    captureForget: assign(({ context }) => ({
      operationId: context.operationId + 1,
      write: { kind: 'forget', input: { id: context.note.id, reason: context.draft.reason } },
      failure: null,
    })),
    finishWrite: assign(({ context }) => ({
      operationId: context.operationId + 1,
      draft: { text: context.note.text, type: context.note.type, scope: context.note.scope, reason: '' },
      preview: false,
      write: null,
      failure: null,
    })),
    cancelWrite: assign(({ context }) => ({
      operationId: context.operationId + 1,
      draft: { text: context.note.text, type: context.note.type, scope: context.note.scope, reason: '' },
      preview: false,
      write: null,
      failure: null,
    })),
    failUnexpectedWrite: assign(({ context }) => ({
      operationId: context.operationId + 1,
      write: null,
      failure: 'The change failed.',
    })),
  },
}).createMachine({
  id: 'noteEditor',
  initial: 'view',
  context: ({ input }) => ({
    note: input.note,
    draft: { text: input.note.text, type: input.note.type, scope: input.note.scope, reason: '' },
    preview: false,
    operationId: 0,
    write: null,
    failure: null,
  }),
  states: {
    view: {
      on: {
        edit: { target: 'editing', actions: 'beginEdit' },
        forget: { target: 'forgetting', actions: 'beginForget' },
      },
    },
    editing: {
      on: {
        'text.change': { actions: 'updateText' },
        'type.change': { actions: 'updateType' },
        'scope.change': { actions: 'updateScope' },
        'reason.change': { actions: 'updateReason' },
        'preview.toggle': { actions: 'togglePreview' },
        save: { guard: 'hasText', target: 'saving', actions: 'captureSave' },
        cancel: { target: 'view', actions: 'cancelWrite' },
      },
    },
    forgetting: {
      on: {
        'reason.change': { actions: 'updateReason' },
        'forget.confirm': { target: 'forgettingPending', actions: 'captureForget' },
        cancel: { target: 'view', actions: 'cancelWrite' },
      },
    },
    saving: {
      invoke: {
        src: 'persist',
        input: ({ context }) => {
          if (context.write === null) throw new Error('Note save request is missing.')
          return { operationId: context.operationId, write: context.write }
        },
        onDone: [
          {
            guard: ({ context, event }) => event.output.operationId === context.operationId && event.output.status === 'saved',
            target: 'view',
            actions: 'finishWrite',
          },
          {
            guard: ({ context, event }) => event.output.operationId === context.operationId && event.output.status === 'failed',
            target: 'editing',
            actions: assign(({ context, event }) => {
              const result = event.output
              return result.status === 'failed' ? { operationId: context.operationId + 1, write: null, failure: result.failure } : {}
            }),
          },
          { target: 'view', actions: 'cancelWrite' },
        ],
        onError: { target: 'editing', actions: 'failUnexpectedWrite' },
      },
      on: { cancel: { target: 'view', actions: 'cancelWrite' } },
    },
    forgettingPending: {
      invoke: {
        src: 'persist',
        input: ({ context }) => {
          if (context.write === null) throw new Error('Note forget request is missing.')
          return { operationId: context.operationId, write: context.write }
        },
        onDone: [
          {
            guard: ({ context, event }) => event.output.operationId === context.operationId && event.output.status === 'forgotten',
            target: 'view',
            actions: 'finishWrite',
          },
          {
            guard: ({ context, event }) => event.output.operationId === context.operationId && event.output.status === 'failed',
            target: 'forgetting',
            actions: assign(({ context, event }) => {
              const result = event.output
              return result.status === 'failed' ? { operationId: context.operationId + 1, write: null, failure: result.failure } : {}
            }),
          },
          { target: 'view', actions: 'cancelWrite' },
        ],
        onError: { target: 'forgetting', actions: 'failUnexpectedWrite' },
      },
      on: { cancel: { target: 'view', actions: 'cancelWrite' } },
    },
  },
})
