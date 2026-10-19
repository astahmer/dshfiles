import { assign, createActor, fromPromise, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import type { DraftMutation, DraftSnapshot } from './library-api.js'
import type { DraftStore, SavedDraft } from './draft-store.js'

export interface PromptDraftMigrationClient {
  readonly saveDraft: (
    input: { readonly draft: { readonly id: string; readonly title: string; readonly text: string; readonly now: string } },
    options: { readonly signal: AbortSignal },
  ) => Promise<DraftMutation>
  readonly completeMigration: (expectedStore: DraftStore) => void
  readonly refresh: () => void
}

interface PromptDraftMigrationRequest {
  readonly operationId: number
  readonly snapshot: DraftSnapshot
  readonly localStore: DraftStore
}

interface PromptDraftMigrationResult {
  readonly operationId: number
  readonly status: 'complete' | 'failed'
  readonly snapshot: DraftSnapshot
}

interface PromptDraftMigrationContext {
  readonly client: PromptDraftMigrationClient
  readonly operationId: number
  readonly request: PromptDraftMigrationRequest | null
  readonly lastSnapshotRevision: number
  readonly lastLocalStore: DraftStore | null
}

interface PromptDraftMigrationInput {
  readonly client: PromptDraftMigrationClient
}

interface PromptDraftMigrationSnapshotEvent {
  readonly type: 'host.snapshot'
  readonly snapshot: DraftSnapshot
  readonly localStore: DraftStore
}

type PromptDraftMigrationEvent = PromptDraftMigrationSnapshotEvent | { readonly type: 'client.update'; readonly client: PromptDraftMigrationClient }

const matchesMigratedDraft = (local: SavedDraft, host: SavedDraft): boolean =>
  local.id === host.id && local.title === host.title && local.text === host.text && local.updatedAt === host.updatedAt

const migratePromptDrafts = fromPromise<
  PromptDraftMigrationResult,
  { readonly client: PromptDraftMigrationClient; readonly request: PromptDraftMigrationRequest }
>(async ({ input, signal }) => {
  let snapshot = input.request.snapshot
  const pending = input.request.localStore.drafts.filter(local => {
    const host = snapshot.drafts.find(candidate => candidate.id === local.id)
    return host === undefined || !matchesMigratedDraft(local, host)
  })

  for (const local of pending) {
    signal.throwIfAborted()
    const host = snapshot.drafts.find(candidate => candidate.id === local.id)
    if (host !== undefined && !matchesMigratedDraft(local, host)) {
      return { operationId: input.request.operationId, status: 'failed', snapshot }
    }

    try {
      const result = await input.client.saveDraft({ draft: { id: local.id, title: local.title, text: local.text, now: local.updatedAt } }, { signal })
      snapshot = { revision: result.revision, drafts: result.drafts }
      if (result.kind === 'rejected') {
        const existing = result.drafts.find(candidate => candidate.id === local.id)
        if (result.reason !== 'duplicate-id' || existing === undefined || !matchesMigratedDraft(local, existing)) {
          return { operationId: input.request.operationId, status: 'failed', snapshot }
        }
      }
    } catch (error) {
      if (signal.aborted) throw error
      return { operationId: input.request.operationId, status: 'failed', snapshot }
    }
  }

  signal.throwIfAborted()
  input.client.completeMigration(input.request.localStore)
  return { operationId: input.request.operationId, status: 'complete', snapshot }
})

const requestFromSnapshot = (input: { readonly context: PromptDraftMigrationContext; readonly event: PromptDraftMigrationSnapshotEvent }) => ({
  operationId: input.context.operationId + 1,
  request: {
    operationId: input.context.operationId + 1,
    snapshot: input.event.snapshot,
    localStore: input.event.localStore,
  },
  lastSnapshotRevision: Math.max(input.context.lastSnapshotRevision, input.event.snapshot.revision),
  lastLocalStore: input.event.localStore,
})

const promptDraftMigrationMachine = setup({
  // SAFETY: XState uses this empty object only as a compile-time witness; runtime context and input are built below.
  types: {} as {
    context: PromptDraftMigrationContext
    input: PromptDraftMigrationInput
    events: PromptDraftMigrationEvent
  },
  actors: { migratePromptDrafts },
}).createMachine({
  id: 'promptDraftMigration',
  initial: 'waiting',
  context: ({ input }) => ({
    client: input.client,
    operationId: 0,
    request: null,
    lastSnapshotRevision: 0,
    lastLocalStore: null,
  }),
  on: {
    'client.update': { actions: assign(({ event }) => ({ client: event.client })) },
  },
  states: {
    waiting: {
      on: {
        'host.snapshot': [
          {
            // Composers remount with every thread and restart this actor; with no local drafts there is nothing to
            // migrate, and running anyway ended in a refresh that refetched the drafts on every switch.
            guard: ({ event }) => event.localStore.drafts.length === 0,
            target: 'complete',
            actions: [
              assign(({ context, event }) => ({
                lastSnapshotRevision: Math.max(context.lastSnapshotRevision, event.snapshot.revision),
                lastLocalStore: event.localStore,
              })),
              ({ context, event }) => context.client.completeMigration(event.localStore),
            ],
          },
          {
            target: 'migrating',
            actions: assign(({ context, event }) => requestFromSnapshot({ context, event })),
          },
        ],
      },
    },
    migrating: {
      tags: ['busy'],
      invoke: {
        src: 'migratePromptDrafts',
        input: ({ context }) => {
          if (context.request === null) throw new Error('Prompt draft migration started without a request.')
          return { client: context.client, request: context.request }
        },
        onDone: [
          {
            guard: ({ context, event }) =>
              context.request !== null &&
              event.output.operationId === context.request.operationId &&
              event.output.operationId === context.operationId &&
              event.output.status === 'complete',
            target: 'complete',
            actions: [
              assign(({ context, event }) => ({
                request: null,
                lastSnapshotRevision: Math.max(context.lastSnapshotRevision, event.output.snapshot.revision),
              })),
              ({ context }) => context.client.refresh(),
            ],
          },
          {
            guard: ({ context, event }) =>
              context.request !== null &&
              event.output.operationId === context.request.operationId &&
              event.output.operationId === context.operationId &&
              event.output.status === 'failed',
            target: 'failed',
            actions: [
              assign(({ context, event }) => ({
                request: null,
                lastSnapshotRevision: Math.max(context.lastSnapshotRevision, event.output.snapshot.revision),
              })),
              ({ context }) => context.client.refresh(),
            ],
          },
          { target: 'waiting', actions: assign({ request: null }) },
        ],
        onError: {
          target: 'failed',
          actions: [
            assign(({ context }) => ({
              request: null,
              lastSnapshotRevision: Math.max(context.lastSnapshotRevision, context.request?.snapshot.revision ?? 0),
              lastLocalStore: context.request?.localStore ?? context.lastLocalStore,
            })),
            ({ context }) => context.client.refresh(),
          ],
        },
      },
      on: {
        'host.snapshot': [
          {
            guard: ({ context, event }) =>
              context.request !== null && (event.snapshot.revision > context.request.snapshot.revision || event.localStore !== context.request.localStore),
            target: 'migrating',
            reenter: true,
            actions: assign(({ context, event }) => requestFromSnapshot({ context, event })),
          },
          {
            actions: assign(({ context, event }) => ({
              lastSnapshotRevision: Math.max(context.lastSnapshotRevision, event.snapshot.revision),
              lastLocalStore: event.localStore,
            })),
          },
        ],
      },
    },
    complete: {
      on: {
        'host.snapshot': [
          {
            guard: ({ context, event }) => event.localStore.drafts.length > 0 && event.localStore !== context.lastLocalStore,
            target: 'migrating',
            actions: assign(({ context, event }) => requestFromSnapshot({ context, event })),
          },
          {
            actions: assign(({ context, event }) => ({
              lastSnapshotRevision: Math.max(context.lastSnapshotRevision, event.snapshot.revision),
              lastLocalStore: event.localStore,
            })),
          },
        ],
      },
    },
    failed: {
      on: {
        'host.snapshot': {
          guard: ({ context, event }) => event.snapshot.revision > context.lastSnapshotRevision || event.localStore !== context.lastLocalStore,
          target: 'migrating',
          actions: assign(({ context, event }) => requestFromSnapshot({ context, event })),
        },
      },
    },
  },
})

type SharedPromptDraftMigrationActor = ActorRefFrom<typeof promptDraftMigrationMachine> & { stop(): void }

let sharedPromptDraftMigrationActor: SharedPromptDraftMigrationActor | undefined
let promptDraftMigrationConsumers = 0

export class PromptDraftMigration {
  private constructor() {}

  static readonly machine = promptDraftMigrationMachine

  static readonly dispatch = (input: {
    readonly client: PromptDraftMigrationClient
    readonly snapshot: DraftSnapshot
    readonly localStore: DraftStore
  }): void => {
    if (sharedPromptDraftMigrationActor === undefined) {
      sharedPromptDraftMigrationActor = createActor(promptDraftMigrationMachine, { input: { client: input.client } }).start()
    } else {
      sharedPromptDraftMigrationActor.send({ type: 'client.update', client: input.client })
    }
    sharedPromptDraftMigrationActor.send({ type: 'host.snapshot', snapshot: input.snapshot, localStore: input.localStore })
  }

  static readonly stop = (): void => {
    sharedPromptDraftMigrationActor?.stop()
    sharedPromptDraftMigrationActor = undefined
    promptDraftMigrationConsumers = 0
  }

  static readonly retain = (): (() => void) => {
    promptDraftMigrationConsumers += 1
    let retained = true
    return () => {
      if (!retained) return
      retained = false
      if (promptDraftMigrationConsumers === 0) return
      promptDraftMigrationConsumers -= 1
      if (promptDraftMigrationConsumers === 0) PromptDraftMigration.stop()
    }
  }
}
