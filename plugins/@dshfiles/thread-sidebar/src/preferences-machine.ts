import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { SidebarPreferences } from './organization.js'
import { SidebarPreferencesModel } from './preferences.js'

export interface SidebarPreferencesMachineClient {
  readonly readLocal: () => SidebarPreferences | null
  readonly readHost: () => SidebarPreferences | null
  readonly writeHost: (patch: Partial<SidebarPreferences>) => Promise<boolean>
  readonly removeLocal: () => void
}

interface HostWriteOperation {
  readonly id: number
  readonly kind: 'host'
  readonly patch: Partial<SidebarPreferences>
}

interface MigrationOperation {
  readonly id: number
  readonly kind: 'migration'
  readonly overlay: Partial<SidebarPreferences>
}

type PreferencesOperation = HostWriteOperation | MigrationOperation

type MigrationOutcome = 'migrated' | 'empty' | 'unavailable' | 'failed'

type PreferencesOperationResult =
  | { readonly id: number; readonly kind: 'host'; readonly success: boolean }
  | { readonly id: number; readonly kind: 'migration'; readonly outcome: MigrationOutcome }

interface PreferencesOperationInput {
  readonly client: SidebarPreferencesMachineClient
  readonly operation: PreferencesOperation
}

interface PreferencesContext {
  readonly client: SidebarPreferencesMachineClient
  readonly queue: readonly PreferencesOperation[]
  readonly pending: Partial<SidebarPreferences>
  readonly pendingOperationIds: Partial<Record<keyof SidebarPreferences, number>>
  readonly nextOperationId: number
  readonly hostWriteFailed: boolean
  readonly localWriteFailed: boolean
  readonly migrationStatus: 'idle' | 'queued' | 'done' | 'failed'
}

interface PreferencesInput {
  readonly client: SidebarPreferencesMachineClient
}

type PreferencesEvent =
  | { readonly type: 'host.update'; readonly patch: Partial<SidebarPreferences> }
  | { readonly type: 'local.write.result'; readonly success: boolean }
  | { readonly type: 'migration.requested' }

const overlayForOperation = (operation: PreferencesOperation): Partial<SidebarPreferences> => (operation.kind === 'host' ? operation.patch : operation.overlay)

const clearOperationOverlay = (context: PreferencesContext, operation: PreferencesOperation): Pick<PreferencesContext, 'pending' | 'pendingOperationIds'> => {
  const pending = { ...context.pending }
  const pendingOperationIds = { ...context.pendingOperationIds }
  for (const key of Object.keys(overlayForOperation(operation)).filter(SidebarPreferencesModel.isPreferenceKey)) {
    if (pendingOperationIds[key] !== operation.id) continue
    delete pending[key]
    delete pendingOperationIds[key]
  }
  return { pending, pendingOperationIds }
}

const readMigrationOverlay = (client: SidebarPreferencesMachineClient): Partial<SidebarPreferences> => {
  const local = client.readLocal()
  const host = client.readHost()
  return local === null || host === null ? {} : SidebarPreferencesModel.preferencesToMigrate(local, host)
}

const performOperation = async (input: PreferencesOperationInput): Promise<PreferencesOperationResult> => {
  const operation = input.operation
  if (operation.kind === 'host') return { id: operation.id, kind: 'host', success: await input.client.writeHost(operation.patch) }

  const local = input.client.readLocal()
  if (local === null) return { id: operation.id, kind: 'migration', outcome: 'empty' }
  const host = input.client.readHost()
  if (host === null) return { id: operation.id, kind: 'migration', outcome: 'unavailable' }

  const patch = SidebarPreferencesModel.preferencesToMigrate(local, host)
  if (Object.keys(patch).length === 0) {
    input.client.removeLocal()
    return { id: operation.id, kind: 'migration', outcome: 'empty' }
  }
  if (!(await input.client.writeHost(patch))) return { id: operation.id, kind: 'migration', outcome: 'failed' }
  input.client.removeLocal()
  return { id: operation.id, kind: 'migration', outcome: 'migrated' }
}

const finishOperation = (context: PreferencesContext, result: PreferencesOperationResult): Partial<PreferencesContext> => {
  const operation = context.queue[0]
  if (operation === undefined || operation.id !== result.id || operation.kind !== result.kind) return {}
  const base = { queue: context.queue.slice(1), ...clearOperationOverlay(context, operation) }
  if (result.kind === 'host') return { ...base, hostWriteFailed: !result.success }
  if (result.outcome === 'unavailable') return { ...base, migrationStatus: 'idle' }
  const success = result.outcome === 'migrated' || result.outcome === 'empty'
  return { ...base, hostWriteFailed: !success, migrationStatus: success ? 'done' : 'failed' }
}

// SAFETY: XState uses these empty carriers for inference; no runtime value is read.
const preferencesMachine = setup({
  types: {
    context: {} as PreferencesContext,
    events: {} as PreferencesEvent,
    input: {} as PreferencesInput,
  },
  actors: {
    perform: fromPromise<PreferencesOperationResult, PreferencesOperationInput>(({ input }) => performOperation(input)),
  },
  guards: {
    hasQueuedOperation: ({ context }) => context.queue.length > 0,
    canQueueMigration: ({ context }) => context.migrationStatus !== 'queued' && context.migrationStatus !== 'done',
  },
  actions: {
    enqueueHostWrite: assign(({ context, event }) => {
      if (event.type !== 'host.update') return {}
      const id = context.nextOperationId + 1
      const operation: HostWriteOperation = { id, kind: 'host', patch: event.patch }
      const pendingOperationIds = { ...context.pendingOperationIds }
      for (const key of Object.keys(event.patch).filter(SidebarPreferencesModel.isPreferenceKey)) pendingOperationIds[key] = id
      return {
        queue: [...context.queue, operation],
        pending: { ...context.pending, ...event.patch },
        pendingOperationIds,
        nextOperationId: id,
      }
    }),
    recordLocalWrite: assign(({ event }) => (event.type === 'local.write.result' ? { localWriteFailed: !event.success } : {})),
    enqueueMigration: assign(({ context }) => {
      const id = context.nextOperationId + 1
      const operation: MigrationOperation = { id, kind: 'migration', overlay: readMigrationOverlay(context.client) }
      const pendingOperationIds = { ...context.pendingOperationIds }
      for (const key of Object.keys(operation.overlay).filter(SidebarPreferencesModel.isPreferenceKey)) pendingOperationIds[key] = id
      return {
        queue: [...context.queue, operation],
        pending: { ...context.pending, ...operation.overlay },
        pendingOperationIds,
        nextOperationId: id,
        migrationStatus: 'queued',
      }
    }),
    failOperation: assign(({ context }) => {
      const operation = context.queue[0]
      if (operation === undefined) return {}
      const overlay = clearOperationOverlay(context, operation)
      return {
        ...overlay,
        queue: context.queue.slice(1),
        hostWriteFailed: true,
        migrationStatus: operation.kind === 'migration' ? 'failed' : context.migrationStatus,
      }
    }),
  },
}).createMachine({
  id: 'sidebarPreferences',
  initial: 'idle',
  context: ({ input }) => ({
    client: input.client,
    queue: [],
    pending: {},
    pendingOperationIds: {},
    nextOperationId: 0,
    hostWriteFailed: false,
    localWriteFailed: false,
    migrationStatus: 'idle',
  }),
  states: {
    idle: {
      always: { guard: 'hasQueuedOperation', target: 'processing' },
      on: {
        'host.update': { actions: 'enqueueHostWrite' },
        'local.write.result': { actions: 'recordLocalWrite' },
        'migration.requested': { guard: 'canQueueMigration', actions: 'enqueueMigration' },
      },
    },
    processing: {
      invoke: {
        src: 'perform',
        input: ({ context }) => {
          const operation = context.queue[0]
          if (operation === undefined) throw new Error('Sidebar preference operation is missing.')
          return { client: context.client, operation }
        },
        onDone: { target: 'idle', actions: assign(({ context, event }) => finishOperation(context, event.output)) },
        onError: { target: 'idle', actions: 'failOperation' },
      },
      on: {
        'host.update': { actions: 'enqueueHostWrite' },
        'local.write.result': { actions: 'recordLocalWrite' },
        'migration.requested': { guard: 'canQueueMigration', actions: 'enqueueMigration' },
      },
    },
  },
})

export class SidebarPreferencesMachine {
  static readonly machine = preferencesMachine
}
