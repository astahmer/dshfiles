import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import type { ApiClientInput, ApiClientOutput } from '@dshfiles/dshx/api'
import type { editorApi } from './api.js'

export type EditorWriteInput = ApiClientInput<typeof editorApi.methods.write>
export type EditorWriteOutput = ApiClientOutput<typeof editorApi.methods.write>

export interface EditorSaveRequest extends Omit<EditorWriteInput, 'overwrite'> {
  readonly documentId: string
  readonly bufferVersion: number
}

export interface EditorSaveClient {
  readonly write: (request: EditorSaveRequest, overwrite: boolean, signal: AbortSignal) => Promise<EditorWriteOutput>
}

interface EditorSaveContext {
  readonly activeDocumentId: string | null
  readonly approved: ReadonlySet<string>
  readonly operationId: number
  readonly pending: EditorSaveRequest | null
  readonly overwrite: boolean
  readonly failure: string | null
}

interface EditorSaveEvent {
  readonly type: 'approve' | 'overwrite' | 'cancel'
}

interface EditorSaveRequestEvent {
  readonly type: 'save.request'
  readonly request: EditorSaveRequest
}

interface EditorDocumentChangedEvent {
  readonly type: 'document.changed'
  readonly documentId: string | null
}

type EditorSaveMachineEvent = EditorSaveEvent | EditorSaveRequestEvent | EditorDocumentChangedEvent

type EditorSaveResult =
  | { readonly operationId: number; readonly documentId: string; readonly bufferVersion: number; readonly status: 'saved'; readonly sha256: string }
  | { readonly operationId: number; readonly documentId: string; readonly bufferVersion: number; readonly status: 'conflict' }
  | { readonly operationId: number; readonly documentId: string; readonly bufferVersion: number; readonly status: 'failed'; readonly failure: string }

interface EditorSaveActorInput {
  readonly operationId: number
  readonly request: EditorSaveRequest
  readonly overwrite: boolean
}

export const createEditorSaveActor = (client: EditorSaveClient) =>
  fromPromise<EditorSaveResult, EditorSaveActorInput>(async ({ input, signal }) => {
    try {
      const result = await client.write(input.request, input.overwrite, signal)
      return result.status === 'saved'
        ? {
            operationId: input.operationId,
            documentId: input.request.documentId,
            bufferVersion: input.request.bufferVersion,
            status: 'saved',
            sha256: result.sha256,
          }
        : {
            operationId: input.operationId,
            documentId: input.request.documentId,
            bufferVersion: input.request.bufferVersion,
            status: 'conflict',
          }
    } catch (error) {
      return {
        operationId: input.operationId,
        documentId: input.request.documentId,
        bufferVersion: input.request.bufferVersion,
        status: 'failed',
        failure: errorMessage(error, 'Save failed.'),
      }
    }
  })

// SAFETY: XState uses these empty carriers for inference; nothing reads their values.
export const editorSaveMachine = setup({
  types: {
    context: {} as EditorSaveContext,
    events: {} as EditorSaveMachineEvent,
  },
  actors: {
    write: fromPromise<EditorSaveResult, EditorSaveActorInput>(() => {
      throw new Error('Editor save machine requires a write actor.')
    }),
  },
  guards: {
    alreadyApprovedAndActive: ({ context, event }) =>
      event.type === 'save.request' && event.request.documentId === context.activeDocumentId && context.approved.has(event.request.documentId),
    belongsToActiveDocument: ({ context, event }) => event.type === 'save.request' && event.request.documentId === context.activeDocumentId,
  },
  actions: {
    updateActiveDocument: assign(({ event }) => (event.type === 'document.changed' ? { activeDocumentId: event.documentId } : {})),
    changeActiveDocument: assign(({ context, event }) =>
      event.type === 'document.changed'
        ? {
            activeDocumentId: event.documentId,
            operationId: context.operationId + 1,
            pending: null,
            overwrite: false,
            failure: null,
          }
        : {},
    ),
    beginSave: assign(({ context, event }) =>
      event.type === 'save.request' ? { operationId: context.operationId + 1, pending: event.request, overwrite: false, failure: null } : {},
    ),
    grantApproval: assign(({ context }) => (context.pending === null ? {} : { approved: new Set([...context.approved, context.pending.documentId]) })),
    beginOverwrite: assign(({ context }) => ({ operationId: context.operationId + 1, overwrite: true, failure: null })),
    clearPending: assign(({ context }) => ({ operationId: context.operationId + 1, pending: null, overwrite: false, failure: null })),
    recordUnexpectedFailure: assign(() => ({ pending: null, overwrite: false, failure: 'Save failed.' })),
  },
}).createMachine({
  id: 'editorSave',
  initial: 'idle',
  context: { activeDocumentId: null, approved: new Set(), operationId: 0, pending: null, overwrite: false, failure: null },
  states: {
    idle: {
      on: {
        'document.changed': { actions: 'updateActiveDocument' },
        'save.request': [
          { guard: 'alreadyApprovedAndActive', target: 'writing', actions: 'beginSave' },
          { guard: 'belongsToActiveDocument', target: 'approval', actions: 'beginSave' },
        ],
      },
    },
    approval: {
      on: {
        approve: { target: 'writing', actions: 'grantApproval' },
        cancel: { target: 'idle', actions: 'clearPending' },
        'document.changed': { target: 'idle', actions: 'changeActiveDocument' },
      },
    },
    writing: {
      invoke: {
        src: 'write',
        input: ({ context }) => {
          if (context.pending === null) throw new Error('Editor save request is missing.')
          return { operationId: context.operationId, request: context.pending, overwrite: context.overwrite }
        },
        onDone: [
          {
            guard: ({ context, event }) =>
              event.output.operationId === context.operationId &&
              event.output.documentId === context.activeDocumentId &&
              event.output.bufferVersion === context.pending?.bufferVersion &&
              event.output.status === 'saved',
            target: 'idle',
            actions: 'clearPending',
          },
          {
            guard: ({ context, event }) =>
              event.output.operationId === context.operationId &&
              event.output.documentId === context.activeDocumentId &&
              event.output.bufferVersion === context.pending?.bufferVersion &&
              event.output.status === 'conflict',
            target: 'conflict',
          },
          {
            guard: ({ context, event }) =>
              event.output.operationId === context.operationId &&
              event.output.documentId === context.activeDocumentId &&
              event.output.bufferVersion === context.pending?.bufferVersion &&
              event.output.status === 'failed',
            target: 'failed',
            actions: assign(({ context, event }) => {
              const result = event.output
              return result.status === 'failed' ? { operationId: context.operationId + 1, pending: null, overwrite: false, failure: result.failure } : {}
            }),
          },
          { target: 'idle', actions: 'clearPending' },
        ],
        onError: { target: 'failed', actions: 'recordUnexpectedFailure' },
      },
      on: { 'document.changed': { target: 'idle', actions: 'changeActiveDocument' } },
    },
    conflict: {
      on: {
        overwrite: { target: 'writing', actions: 'beginOverwrite' },
        cancel: { target: 'idle', actions: 'clearPending' },
        'document.changed': { target: 'idle', actions: 'changeActiveDocument' },
      },
    },
    failed: {
      on: {
        'save.request': [
          { guard: 'alreadyApprovedAndActive', target: 'writing', actions: 'beginSave' },
          { guard: 'belongsToActiveDocument', target: 'approval', actions: 'beginSave' },
        ],
        cancel: { target: 'idle', actions: 'clearPending' },
        'document.changed': { target: 'idle', actions: 'changeActiveDocument' },
      },
    },
  },
})
