import { assign, createActor, fromPromise, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import type { PromptStashMutation, PromptStashSnapshot } from './library-api.js'
import { PromptLibrary, type PromptLibraryStore, type SavedPrompt } from './library.js'

export type PromptLibraryLocalStatus = 'ready' | 'invalid' | 'unavailable'

export interface PromptLibraryMigrationClient {
  readonly savePrompt: (
    input: { readonly prompt: SavedPrompt; readonly expectedRevision: null },
    options: { readonly signal: AbortSignal },
  ) => Promise<PromptStashMutation>
  readonly completeMigration: (expectedStore: PromptLibraryStore) => void
  readonly refresh: () => void
}

interface PromptLibraryMigrationRequest {
  readonly operationId: number
  readonly snapshot: PromptStashSnapshot
  readonly localStore: PromptLibraryStore
}

interface PromptLibraryMigrationResult {
  readonly operationId: number
  readonly status: 'complete' | 'failed'
  readonly snapshot: PromptStashSnapshot
}

interface PromptLibraryMigrationContext {
  readonly client: PromptLibraryMigrationClient
  readonly operationId: number
  readonly request: PromptLibraryMigrationRequest | null
  readonly lastSnapshotRevision: number
  readonly lastLocalStore: PromptLibraryStore | null
  readonly lastLocalStatus: PromptLibraryLocalStatus | null
}

interface PromptLibraryMigrationInput {
  readonly client: PromptLibraryMigrationClient
}

interface PromptLibraryMigrationSnapshotEvent {
  readonly type: 'host.snapshot'
  readonly snapshot: PromptStashSnapshot
  readonly localStore: PromptLibraryStore
  readonly localStatus: PromptLibraryLocalStatus
}

type PromptLibraryMigrationEvent = PromptLibraryMigrationSnapshotEvent | { readonly type: 'client.update'; readonly client: PromptLibraryMigrationClient }

const matchesMigratedPrompt = (local: SavedPrompt, host: SavedPrompt): boolean =>
  local.id === host.id && local.revision === host.revision && local.title === host.title && local.text === host.text && local.updatedAt === host.updatedAt

const sameLocalStore = (left: PromptLibraryStore, right: PromptLibraryStore | null): boolean => {
  if (right === null) return false
  const leftSerialized = PromptLibrary.serialize(left.prompts)
  if (leftSerialized === null) return false
  return leftSerialized === PromptLibrary.serialize(right.prompts)
}

const updateEvidence = (input: { readonly context: PromptLibraryMigrationContext; readonly event: PromptLibraryMigrationSnapshotEvent }) => ({
  lastSnapshotRevision: Math.max(input.context.lastSnapshotRevision, input.event.snapshot.revision),
  lastLocalStore: input.event.localStore,
  lastLocalStatus: input.event.localStatus,
})

const requestFromSnapshot = (input: { readonly context: PromptLibraryMigrationContext; readonly event: PromptLibraryMigrationSnapshotEvent }) => ({
  operationId: input.context.operationId + 1,
  request: {
    operationId: input.context.operationId + 1,
    snapshot: input.event.snapshot,
    localStore: input.event.localStore,
  },
  lastSnapshotRevision: Math.max(input.context.lastSnapshotRevision, input.event.snapshot.revision),
  lastLocalStore: input.event.localStore,
  lastLocalStatus: input.event.localStatus,
})

const migratePromptLibrary = fromPromise<
  PromptLibraryMigrationResult,
  { readonly client: PromptLibraryMigrationClient; readonly request: PromptLibraryMigrationRequest }
>(async ({ input, signal }) => {
  let snapshot = input.request.snapshot
  const pending = input.request.localStore.prompts.filter(local => {
    const host = snapshot.prompts.find(candidate => candidate.id === local.id)
    return host === undefined || !matchesMigratedPrompt(local, host)
  })

  for (const local of pending) {
    signal.throwIfAborted()
    const host = snapshot.prompts.find(candidate => candidate.id === local.id)
    if (host !== undefined && !matchesMigratedPrompt(local, host)) {
      return { operationId: input.request.operationId, status: 'failed', snapshot }
    }

    try {
      const result = await input.client.savePrompt({ prompt: local, expectedRevision: null }, { signal })
      snapshot = { revision: result.revision, prompts: result.prompts }
      if (result.kind === 'limit') return { operationId: input.request.operationId, status: 'failed', snapshot }
      if (result.kind === 'conflict') {
        const existing = result.prompts.find(candidate => candidate.id === local.id)
        if (existing === undefined || !matchesMigratedPrompt(local, existing)) {
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

const promptLibraryMigrationMachine = setup({
  // SAFETY: XState uses this empty object only as a compile-time witness; runtime context and input are built below.
  types: {} as {
    context: PromptLibraryMigrationContext
    input: PromptLibraryMigrationInput
    events: PromptLibraryMigrationEvent
  },
  actors: { migratePromptLibrary },
}).createMachine({
  id: 'promptLibraryMigration',
  initial: 'waiting',
  context: ({ input }) => ({
    client: input.client,
    operationId: 0,
    request: null,
    lastSnapshotRevision: 0,
    lastLocalStore: null,
    lastLocalStatus: null,
  }),
  on: {
    'client.update': { actions: assign(({ event }) => ({ client: event.client })) },
  },
  states: {
    waiting: {
      on: {
        'host.snapshot': [
          {
            // As for drafts: a remounted composer with no local prompts has nothing to migrate and must not refetch.
            guard: ({ event }) => event.localStatus === 'ready' && event.localStore.prompts.length === 0,
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
            guard: ({ event }) => event.localStatus === 'ready',
            target: 'migrating',
            actions: assign(({ context, event }) => requestFromSnapshot({ context, event })),
          },
          {
            target: 'preserved',
            actions: assign(({ context, event }) => updateEvidence({ context, event })),
          },
        ],
      },
    },
    migrating: {
      tags: ['busy'],
      invoke: {
        src: 'migratePromptLibrary',
        input: ({ context }) => {
          if (context.request === null) throw new Error('Prompt library migration started without a request.')
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
                lastLocalStore: context.request?.localStore ?? context.lastLocalStore,
                lastLocalStatus: 'ready' as const,
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
                lastLocalStore: context.request?.localStore ?? context.lastLocalStore,
                lastLocalStatus: 'ready' as const,
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
              lastLocalStatus: 'ready' as const,
            })),
            ({ context }) => context.client.refresh(),
          ],
        },
      },
      on: {
        'host.snapshot': [
          {
            guard: ({ context, event }) =>
              event.localStatus === 'ready' &&
              context.request !== null &&
              (event.snapshot.revision > context.request.snapshot.revision || !sameLocalStore(event.localStore, context.request.localStore)),
            target: 'migrating',
            reenter: true,
            actions: assign(({ context, event }) => requestFromSnapshot({ context, event })),
          },
          {
            guard: ({ event }) => event.localStatus !== 'ready',
            target: 'preserved',
            actions: assign(({ context, event }) => ({ ...updateEvidence({ context, event }), request: null })),
          },
          {
            actions: assign(({ context, event }) => updateEvidence({ context, event })),
          },
        ],
      },
    },
    complete: {
      on: {
        'host.snapshot': [
          {
            guard: ({ context, event }) =>
              event.localStatus === 'ready' &&
              (event.snapshot.revision > context.lastSnapshotRevision || !sameLocalStore(event.localStore, context.lastLocalStore)),
            target: 'migrating',
            actions: assign(({ context, event }) => requestFromSnapshot({ context, event })),
          },
          {
            guard: ({ event }) => event.localStatus !== 'ready',
            target: 'preserved',
            actions: assign(({ context, event }) => updateEvidence({ context, event })),
          },
          {
            actions: assign(({ context, event }) => updateEvidence({ context, event })),
          },
        ],
      },
    },
    failed: {
      on: {
        'host.snapshot': [
          {
            guard: ({ context, event }) =>
              event.localStatus === 'ready' &&
              (event.snapshot.revision > context.lastSnapshotRevision || !sameLocalStore(event.localStore, context.lastLocalStore)),
            target: 'migrating',
            actions: assign(({ context, event }) => requestFromSnapshot({ context, event })),
          },
          {
            guard: ({ event }) => event.localStatus !== 'ready',
            target: 'preserved',
            actions: assign(({ context, event }) => updateEvidence({ context, event })),
          },
          {
            actions: assign(({ context, event }) => updateEvidence({ context, event })),
          },
        ],
      },
    },
    preserved: {
      on: {
        'host.snapshot': [
          {
            guard: ({ event }) => event.localStatus === 'ready',
            target: 'migrating',
            actions: assign(({ context, event }) => requestFromSnapshot({ context, event })),
          },
          {
            actions: assign(({ context, event }) => updateEvidence({ context, event })),
          },
        ],
      },
    },
  },
})

type SharedPromptLibraryMigrationActor = ActorRefFrom<typeof promptLibraryMigrationMachine> & { stop(): void }

let sharedPromptLibraryMigrationActor: SharedPromptLibraryMigrationActor | undefined
let promptLibraryMigrationConsumers = 0

export class PromptLibraryMigration {
  private constructor() {}

  static readonly machine = promptLibraryMigrationMachine

  static readonly dispatch = (input: {
    readonly client: PromptLibraryMigrationClient
    readonly snapshot: PromptStashSnapshot
    readonly localStore: PromptLibraryStore
    readonly localStatus: PromptLibraryLocalStatus
  }): void => {
    if (sharedPromptLibraryMigrationActor === undefined) {
      sharedPromptLibraryMigrationActor = createActor(promptLibraryMigrationMachine, { input: { client: input.client } }).start()
    } else {
      sharedPromptLibraryMigrationActor.send({ type: 'client.update', client: input.client })
    }
    sharedPromptLibraryMigrationActor.send({
      type: 'host.snapshot',
      snapshot: input.snapshot,
      localStore: input.localStore,
      localStatus: input.localStatus,
    })
  }

  static readonly stop = (): void => {
    sharedPromptLibraryMigrationActor?.stop()
    sharedPromptLibraryMigrationActor = undefined
    promptLibraryMigrationConsumers = 0
  }

  static readonly retain = (): (() => void) => {
    promptLibraryMigrationConsumers += 1
    let retained = true
    return () => {
      if (!retained) return
      retained = false
      if (promptLibraryMigrationConsumers === 0) return
      promptLibraryMigrationConsumers -= 1
      if (promptLibraryMigrationConsumers === 0) PromptLibraryMigration.stop()
    }
  }
}
