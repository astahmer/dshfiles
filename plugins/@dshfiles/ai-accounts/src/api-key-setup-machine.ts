import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'

export type ApiKeySetupOperation = 'manual' | 'catalog'
export type ApiKeySetupWriter = (signal: AbortSignal) => Promise<boolean>

interface WriteInput {
  readonly operationId: number
  readonly write: ApiKeySetupWriter | null
}

interface WriteOutput {
  readonly operationId: number
  readonly accepted: boolean
}

export interface ApiKeySetupContext {
  readonly operation: ApiKeySetupOperation | null
  readonly operationId: number
  readonly write: ApiKeySetupWriter | null
  readonly manualValue: string
  readonly selectedCatalogKey: string
  readonly folderPickerOpen: boolean
  readonly cwd: string | null
}

type ApiKeySetupEvent =
  | { readonly type: 'manual.submit'; readonly write: ApiKeySetupWriter }
  | { readonly type: 'catalog.submit'; readonly write: ApiKeySetupWriter; readonly requiresConfirmation: boolean }
  | { readonly type: 'catalog.confirm' }
  | { readonly type: 'manual.changed'; readonly value: string }
  | { readonly type: 'catalog.changed'; readonly key: string }
  | { readonly type: 'folder.open' }
  | { readonly type: 'folder.close' }
  | { readonly type: 'folder.chosen'; readonly cwd: string }
  | { readonly type: 'cwd.cleared' }
  | { readonly type: 'reset' }

interface WriteCompletionEvent {
  readonly type: string
  readonly output?: unknown
}

interface PersistedWriteCompletionEvent {
  readonly type: string
  readonly output: WriteOutput
}

const writeOutputFromCompletion = (event: WriteCompletionEvent): WriteOutput => {
  // SAFETY: This helper is only used by onDone guards for the typed persist actor; XState setup guard events erase its output type.
  return (event as PersistedWriteCompletionEvent).output
}

const persistedWriteActor = fromPromise<WriteOutput, WriteInput>(async ({ input, signal }) => {
  if (input.write === null) throw new Error('Cannot persist without an API-key writer.')
  return { operationId: input.operationId, accepted: await input.write(signal) }
})

// SAFETY: XState uses these empty carriers for inference; the runtime reads the actual machine events and context.
const apiKeySetupMachine = setup({
  types: {
    context: {} as ApiKeySetupContext,
    events: {} as ApiKeySetupEvent,
  },
  actors: {
    persist: fromPromise<WriteOutput, WriteInput>(() => {
      throw new Error('The API-key setup machine requires a persistence actor.')
    }),
  },
  guards: {
    requiresConfirmation: ({ event }) => event.type === 'catalog.submit' && event.requiresConfirmation,
    writeAccepted: ({ context, event }) => {
      const output = writeOutputFromCompletion(event)
      return output.operationId === context.operationId && output.accepted
    },
    writeRefused: ({ context, event }) => {
      const output = writeOutputFromCompletion(event)
      return output.operationId === context.operationId && !output.accepted
    },
    staleWrite: ({ context, event }) => writeOutputFromCompletion(event).operationId !== context.operationId,
  },
  actions: {
    captureManualWrite: assign(({ context, event }) =>
      event.type === 'manual.submit' ? { operation: 'manual', operationId: context.operationId + 1, write: event.write } : {},
    ),
    captureCatalogWrite: assign(({ context, event }) =>
      event.type === 'catalog.submit' ? { operation: 'catalog', operationId: context.operationId + 1, write: event.write } : {},
    ),
    clearWriter: assign({ write: null }),
    clearOperation: assign(({ context }) => ({ operation: null, operationId: context.operationId + 1, write: null })),
    clearFields: assign({ manualValue: '', selectedCatalogKey: '', folderPickerOpen: false, cwd: null }),
    openFolderPicker: assign(({ context }) => ({
      operation: null,
      operationId: context.operationId + 1,
      write: null,
      manualValue: '',
      selectedCatalogKey: '',
      folderPickerOpen: true,
    })),
    chooseFolder: assign(({ context, event }) => ({
      operation: null,
      operationId: context.operationId + 1,
      write: null,
      manualValue: '',
      selectedCatalogKey: '',
      folderPickerOpen: false,
      cwd: event.type === 'folder.chosen' ? event.cwd : context.cwd,
    })),
    clearCatalog: assign(({ context, event }) => ({
      operation: null,
      operationId: context.operationId + 1,
      write: null,
      selectedCatalogKey: '',
      cwd: event.type === 'cwd.cleared' ? null : context.cwd,
    })),
    selectCatalogEntry: assign(({ context, event }) => ({
      operation: null,
      operationId: context.operationId + 1,
      write: null,
      selectedCatalogKey: event.type === 'catalog.changed' ? event.key : context.selectedCatalogKey,
    })),
    clearFailedManualValue: assign(({ context }) => (context.operation === 'manual' ? { manualValue: '' } : {})),
  },
}).createMachine({
  id: 'apiKeySetup',
  initial: 'idle',
  context: { operation: null, operationId: 0, write: null, manualValue: '', selectedCatalogKey: '', folderPickerOpen: false, cwd: null },
  on: {
    reset: { target: '#apiKeySetup.idle', actions: ['clearOperation', 'clearFields'] },
    'manual.changed': { actions: assign({ manualValue: ({ event }) => (event.type === 'manual.changed' ? event.value : '') }) },
    'catalog.changed': { actions: 'selectCatalogEntry' },
    'folder.open': { actions: 'openFolderPicker' },
    'folder.close': { actions: assign({ folderPickerOpen: false }) },
    'folder.chosen': { actions: 'chooseFolder' },
    'cwd.cleared': { actions: 'clearCatalog' },
  },
  states: {
    idle: {
      on: {
        'manual.submit': { target: 'saving', actions: 'captureManualWrite' },
        'catalog.submit': [
          { guard: 'requiresConfirmation', target: 'confirming', actions: 'captureCatalogWrite' },
          { target: 'importing', actions: 'captureCatalogWrite' },
        ],
      },
    },
    confirming: {
      on: {
        'catalog.confirm': { target: 'importing' },
        'manual.submit': { target: 'saving', actions: 'captureManualWrite' },
      },
    },
    saving: {
      invoke: {
        src: 'persist',
        input: ({ context }) => ({ operationId: context.operationId, write: context.write }),
        onDone: [
          { guard: 'writeAccepted', target: 'success', actions: 'clearWriter' },
          { guard: 'writeRefused', target: 'error', actions: 'clearWriter' },
          { guard: 'staleWrite', target: 'idle', actions: 'clearOperation' },
        ],
        onError: { target: 'error', actions: 'clearWriter' },
      },
    },
    importing: {
      invoke: {
        src: 'persist',
        input: ({ context }) => ({ operationId: context.operationId, write: context.write }),
        onDone: [
          { guard: 'writeAccepted', target: 'success', actions: 'clearWriter' },
          { guard: 'writeRefused', target: 'error', actions: 'clearWriter' },
          { guard: 'staleWrite', target: 'idle', actions: 'clearOperation' },
        ],
        onError: { target: 'error', actions: 'clearWriter' },
      },
    },
    success: {},
    error: {
      entry: 'clearFailedManualValue',
      on: {
        'manual.submit': { target: 'saving', actions: 'captureManualWrite' },
        'catalog.submit': [
          { guard: 'requiresConfirmation', target: 'confirming', actions: 'captureCatalogWrite' },
          { target: 'importing', actions: 'captureCatalogWrite' },
        ],
      },
    },
  },
})

export const apiKeySetupMachineWithWriter = apiKeySetupMachine.provide({ actors: { persist: persistedWriteActor } })
