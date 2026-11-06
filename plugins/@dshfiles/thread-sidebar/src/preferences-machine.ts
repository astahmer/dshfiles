import { assign, fromCallback, fromPromise, setup, spawnChild } from '@dshfiles/plugin-ui/machine'
import type { LegacyPreferences } from './legacy-preferences-migration.js'
import { planLegacyPreferencesMigration } from './legacy-preferences-migration.js'
import type { SidebarPreferences } from './organization.js'
import { SidebarPreferencesModel } from './preferences.js'

export interface SidebarPreferencesMachineClient {
  readonly readLocal: () => SidebarPreferences | null
  readonly readHost: () => SidebarPreferences | null
  readonly writeHost: (patch: Partial<SidebarPreferences>) => Promise<boolean>
  readonly removeLocal: () => void
  /** Browser copies the Host preferences replaced; the machine drops them only once their write settled. */
  readonly legacy: {
    readonly read: () => LegacyPreferences
    readonly clear: () => void
  }
}

type MigrationOutcome = 'migrated' | 'empty' | 'unavailable' | 'failed'

interface MigrationInput {
  readonly client: SidebarPreferencesMachineClient
}

interface HostWriteInput {
  readonly client: SidebarPreferencesMachineClient
  readonly id: number
  readonly patch: Partial<SidebarPreferences>
}

interface PreferencesContext {
  readonly client: SidebarPreferencesMachineClient
  readonly pending: Partial<SidebarPreferences>
  readonly pendingOperationIds: Partial<Record<keyof SidebarPreferences, number>>
  readonly nextOperationId: number
  readonly migrationOperationId: number | null
  readonly hostWriteFailed: boolean
  readonly localWriteFailed: boolean
  readonly migrationStatus: 'idle' | 'queued' | 'done' | 'failed'
}

interface PreferencesInput {
  readonly client: SidebarPreferencesMachineClient
}

type PreferencesEvent =
  | { readonly type: 'host.update'; readonly patch: Partial<SidebarPreferences> }
  | { readonly type: 'host.write.result'; readonly id: number; readonly success: boolean }
  | { readonly type: 'local.write.result'; readonly success: boolean }
  | { readonly type: 'migration.requested' }

/** Drop the overlay keys this operation still owns; a newer edit of the same key keeps its own. */
const clearOperationOverlay = (
  context: PreferencesContext,
  input: { readonly id: number; readonly keys: readonly string[] },
): Pick<PreferencesContext, 'pending' | 'pendingOperationIds'> => {
  const pending = { ...context.pending }
  const pendingOperationIds = { ...context.pendingOperationIds }
  for (const key of input.keys.filter(SidebarPreferencesModel.isPreferenceKey)) {
    if (pendingOperationIds[key] !== input.id) continue
    delete pending[key]
    delete pendingOperationIds[key]
  }
  return { pending, pendingOperationIds }
}

const ownedKeys = (context: PreferencesContext, id: number): readonly string[] =>
  Object.entries(context.pendingOperationIds).flatMap(([key, owner]) => (owner === id ? [key] : []))

const readMigrationOverlay = (client: SidebarPreferencesMachineClient): Partial<SidebarPreferences> => {
  const local = client.readLocal()
  const host = client.readHost()
  return local === null || host === null ? {} : SidebarPreferencesModel.preferencesToMigrate(local, host)
}

const migrate = async (client: SidebarPreferencesMachineClient): Promise<MigrationOutcome> => {
  const host = client.readHost()
  if (host === null) return 'unavailable'

  const local = client.readLocal()
  let settledHost = host
  let outcome: MigrationOutcome = 'empty'
  if (local !== null) {
    const patch = SidebarPreferencesModel.preferencesToMigrate(local, host)
    if (Object.keys(patch).length === 0) {
      client.removeLocal()
    } else {
      if (!(await client.writeHost(patch))) return 'failed'
      settledHost = { ...host, ...patch }
      client.removeLocal()
      outcome = 'migrated'
    }
  }

  const legacyPatch = planLegacyPreferencesMigration({ legacy: client.legacy.read(), host: settledHost })
  if (Object.keys(legacyPatch).length > 0) {
    if (!(await client.writeHost(legacyPatch))) return 'failed'
    outcome = 'migrated'
  }
  client.legacy.clear()
  return outcome
}

/**
 * Every edit goes to the Settings form the moment it is made: the form already orders writes and fences revisions, and
 * a write it holds survives a page reload, while an edit still waiting here would not. The overlay keeps each key's
 * newest value on screen until the write that set it settles.
 */
// SAFETY: XState uses these empty carriers for inference; no runtime value is read.
const preferencesMachine = setup({
  types: {
    context: {} as PreferencesContext,
    events: {} as PreferencesEvent,
    input: {} as PreferencesInput,
  },
  actors: {
    migrate: fromPromise<MigrationOutcome, MigrationInput>(({ input }) => migrate(input.client)),
    writeHost: fromCallback<PreferencesEvent, HostWriteInput>(({ input, sendBack }) => {
      input.client.writeHost(input.patch).then(
        success => sendBack({ type: 'host.write.result', id: input.id, success }),
        () => sendBack({ type: 'host.write.result', id: input.id, success: false }),
      )
    }),
  },
  guards: {
    migrationQueued: ({ context }) => context.migrationStatus === 'queued',
    canQueueMigration: ({ context }) => context.migrationStatus !== 'queued' && context.migrationStatus !== 'done',
  },
  actions: {
    recordHostWrite: assign(({ context, event }) => {
      if (event.type !== 'host.update') return {}
      const id = context.nextOperationId + 1
      const pendingOperationIds = { ...context.pendingOperationIds }
      for (const key of Object.keys(event.patch).filter(SidebarPreferencesModel.isPreferenceKey)) pendingOperationIds[key] = id
      return { pending: { ...context.pending, ...event.patch }, pendingOperationIds, nextOperationId: id }
    }),
    dispatchHostWrite: spawnChild('writeHost', {
      input: ({ context, event }) => ({
        client: context.client,
        id: context.nextOperationId,
        patch: event.type === 'host.update' ? event.patch : {},
      }),
    }),
    finishHostWrite: assign(({ context, event }) => {
      if (event.type !== 'host.write.result') return {}
      return { ...clearOperationOverlay(context, { id: event.id, keys: ownedKeys(context, event.id) }), hostWriteFailed: !event.success }
    }),
    recordLocalWrite: assign(({ event }) => (event.type === 'local.write.result' ? { localWriteFailed: !event.success } : {})),
    enqueueMigration: assign(({ context }) => {
      const id = context.nextOperationId + 1
      const overlay = readMigrationOverlay(context.client)
      const pendingOperationIds = { ...context.pendingOperationIds }
      for (const key of Object.keys(overlay).filter(SidebarPreferencesModel.isPreferenceKey)) pendingOperationIds[key] = id
      return {
        pending: { ...context.pending, ...overlay },
        pendingOperationIds,
        nextOperationId: id,
        migrationOperationId: id,
        migrationStatus: 'queued',
      }
    }),
  },
}).createMachine({
  id: 'sidebarPreferences',
  initial: 'idle',
  context: ({ input }) => ({
    client: input.client,
    pending: {},
    pendingOperationIds: {},
    nextOperationId: 0,
    migrationOperationId: null,
    hostWriteFailed: false,
    localWriteFailed: false,
    migrationStatus: 'idle',
  }),
  on: {
    'host.update': { actions: ['recordHostWrite', 'dispatchHostWrite'] },
    'host.write.result': { actions: 'finishHostWrite' },
    'local.write.result': { actions: 'recordLocalWrite' },
  },
  states: {
    idle: {
      always: { guard: 'migrationQueued', target: 'migrating' },
      on: { 'migration.requested': { guard: 'canQueueMigration', actions: 'enqueueMigration' } },
    },
    migrating: {
      invoke: {
        src: 'migrate',
        input: ({ context }) => ({ client: context.client }),
        onDone: {
          target: 'idle',
          actions: assign(({ context, event }) => {
            const id = context.migrationOperationId ?? -1
            const base = { ...clearOperationOverlay(context, { id, keys: ownedKeys(context, id) }), migrationOperationId: null }
            if (event.output === 'unavailable') return { ...base, migrationStatus: 'idle' as const }
            const success = event.output === 'migrated' || event.output === 'empty'
            return { ...base, hostWriteFailed: !success, migrationStatus: success ? ('done' as const) : ('failed' as const) }
          }),
        },
        onError: {
          target: 'idle',
          actions: assign(({ context }) => {
            const id = context.migrationOperationId ?? -1
            return {
              ...clearOperationOverlay(context, { id, keys: ownedKeys(context, id) }),
              migrationOperationId: null,
              hostWriteFailed: true,
              migrationStatus: 'failed' as const,
            }
          }),
        },
      },
    },
  },
})

export class SidebarPreferencesMachine {
  static readonly machine = preferencesMachine
}
