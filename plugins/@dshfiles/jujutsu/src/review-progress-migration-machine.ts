import { assign, createActor, fromPromise, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import type { ReviewProgressSnapshot, ReviewProgressToggle } from './review-progress-api.js'
import { ReviewProgressModel, type ReviewStore } from './review-progress.js'

export interface ReviewProgressMigrationClient {
  readonly toggle: (input: ReviewProgressToggle, options: { readonly signal: AbortSignal }) => Promise<ReviewProgressSnapshot>
  readonly adoptSnapshot: (snapshot: ReviewProgressSnapshot) => ReviewProgressSnapshot
  readonly completeMigration: (snapshot: ReviewProgressSnapshot) => void
}

interface ReviewProgressMigrationRequest {
  readonly operationId: number
  readonly snapshot: ReviewProgressSnapshot
  readonly localStore: ReviewStore
  readonly migrationDone: boolean
}

interface ReviewProgressMigrationResult {
  readonly operationId: number
  readonly status: 'complete' | 'failed'
  readonly snapshot: ReviewProgressSnapshot
}

interface ReviewProgressMigrationContext {
  readonly client: ReviewProgressMigrationClient
  readonly operationId: number
  readonly request: ReviewProgressMigrationRequest | null
  readonly lastSnapshotRevision: number
  readonly lastLocalStore: ReviewStore | null
  readonly lastMigrationDone: boolean | null
}

interface ReviewProgressMigrationInput {
  readonly client: ReviewProgressMigrationClient
}

interface ReviewProgressMigrationSnapshotEvent {
  readonly snapshot: ReviewProgressSnapshot
  readonly localStore: ReviewStore
  readonly migrationDone: boolean
}

interface ReviewProgressMigrationHostSnapshotEvent extends ReviewProgressMigrationSnapshotEvent {
  readonly type: 'host.snapshot'
}

type ReviewProgressMigrationEvent =
  | ReviewProgressMigrationHostSnapshotEvent
  | { readonly type: 'client.update'; readonly client: ReviewProgressMigrationClient }

const migrateReviewProgress = fromPromise<
  ReviewProgressMigrationResult,
  { readonly client: ReviewProgressMigrationClient; readonly request: ReviewProgressMigrationRequest }
>(async ({ input, signal }) => {
  let snapshot = input.client.adoptSnapshot(input.request.snapshot)
  if (input.request.migrationDone) {
    input.client.completeMigration(snapshot)
    return { operationId: input.request.operationId, status: 'complete', snapshot }
  }

  const pending = input.request.localStore.marks.filter(
    mark => !ReviewProgressModel.isReviewed(snapshot.store, mark.repositoryRoot, mark.commitId, { path: mark.path, contentDigest: mark.contentDigest }),
  )

  // Sequential writes preserve each monotone Host snapshot; the local copy stays intact until the whole migration succeeds.
  for (const mark of pending) {
    signal.throwIfAborted()
    try {
      snapshot = input.client.adoptSnapshot(
        await input.client.toggle(
          {
            repositoryRoot: mark.repositoryRoot,
            commitId: mark.commitId,
            file: { path: mark.path, contentDigest: mark.contentDigest },
            reviewed: true,
          },
          { signal },
        ),
      )
    } catch (error) {
      if (signal.aborted) throw error
      return { operationId: input.request.operationId, status: 'failed', snapshot }
    }
  }

  signal.throwIfAborted()
  input.client.completeMigration(snapshot)
  return { operationId: input.request.operationId, status: 'complete', snapshot }
})

const migrationRequestFromSnapshot = (input: {
  readonly context: ReviewProgressMigrationContext
  readonly event: ReviewProgressMigrationHostSnapshotEvent
}) => {
  const operationId = input.context.operationId + 1
  return {
    operationId,
    request: {
      operationId,
      snapshot: input.event.snapshot,
      localStore: input.event.localStore,
      migrationDone: input.event.migrationDone,
    },
    lastSnapshotRevision: input.event.snapshot.revision,
    lastLocalStore: input.event.localStore,
    lastMigrationDone: input.event.migrationDone,
  }
}

const reviewProgressMigrationMachine = setup({
  // SAFETY: XState uses this empty object only as a compile-time witness; runtime context and input are built below.
  types: {} as {
    context: ReviewProgressMigrationContext
    input: ReviewProgressMigrationInput
    events: ReviewProgressMigrationEvent
  },
  actors: { migrateReviewProgress },
}).createMachine({
  id: 'reviewProgressMigration',
  initial: 'waiting',
  context: ({ input }) => ({
    client: input.client,
    operationId: 0,
    request: null,
    lastSnapshotRevision: 0,
    lastLocalStore: null,
    lastMigrationDone: null,
  }),
  on: {
    'client.update': { actions: assign(({ event }) => ({ client: event.client })) },
  },
  states: {
    waiting: {
      on: {
        'host.snapshot': {
          target: 'migrating',
          actions: assign(({ context, event }) => migrationRequestFromSnapshot({ context, event })),
        },
      },
    },
    migrating: {
      tags: ['busy'],
      invoke: {
        src: 'migrateReviewProgress',
        input: ({ context }) => {
          if (context.request === null) throw new Error('Review progress migration started without a request.')
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
            actions: assign(({ context, event }) => ({
              request: null,
              lastSnapshotRevision: event.output.snapshot.revision,
              lastLocalStore: context.request?.localStore ?? context.lastLocalStore,
              lastMigrationDone: context.request?.migrationDone ?? context.lastMigrationDone,
            })),
          },
          {
            guard: ({ context, event }) =>
              context.request !== null &&
              event.output.operationId === context.request.operationId &&
              event.output.operationId === context.operationId &&
              event.output.status === 'failed',
            target: 'failed',
            actions: assign(({ context, event }) => ({
              request: null,
              lastSnapshotRevision: event.output.snapshot.revision,
              lastLocalStore: context.request?.localStore ?? context.lastLocalStore,
              lastMigrationDone: context.request?.migrationDone ?? context.lastMigrationDone,
            })),
          },
          { target: 'waiting', actions: assign({ request: null }) },
        ],
        onError: {
          target: 'failed',
          actions: assign(({ context }) => ({
            request: null,
            lastSnapshotRevision: context.request?.snapshot.revision ?? context.lastSnapshotRevision,
            lastLocalStore: context.request?.localStore ?? context.lastLocalStore,
            lastMigrationDone: context.request?.migrationDone ?? context.lastMigrationDone,
          })),
        },
      },
    },
    complete: {
      on: {
        'host.snapshot': {
          actions: ({ context, event }) => {
            if (event.type === 'host.snapshot') context.client.completeMigration(event.snapshot)
          },
        },
      },
    },
    failed: {
      on: {
        'host.snapshot': {
          guard: ({ context, event }) =>
            event.snapshot.revision > context.lastSnapshotRevision ||
            event.localStore !== context.lastLocalStore ||
            event.migrationDone !== context.lastMigrationDone,
          target: 'migrating',
          actions: assign(({ context, event }) => migrationRequestFromSnapshot({ context, event })),
        },
      },
    },
  },
})

type SharedReviewProgressMigrationActor = ActorRefFrom<typeof reviewProgressMigrationMachine> & { stop(): void }

let sharedReviewProgressMigrationActor: SharedReviewProgressMigrationActor | undefined
let reviewProgressMigrationConsumers = 0

export class ReviewProgressMigration {
  private constructor() {}

  static readonly machine = reviewProgressMigrationMachine

  static readonly dispatch = (input: {
    readonly client: ReviewProgressMigrationClient
    readonly snapshot: ReviewProgressSnapshot
    readonly localStore: ReviewStore
    readonly migrationDone: boolean
  }): SharedReviewProgressMigrationActor => {
    if (sharedReviewProgressMigrationActor === undefined) {
      sharedReviewProgressMigrationActor = createActor(reviewProgressMigrationMachine, { input: { client: input.client } }).start()
    } else {
      sharedReviewProgressMigrationActor.send({ type: 'client.update', client: input.client })
    }
    sharedReviewProgressMigrationActor.send({
      type: 'host.snapshot',
      snapshot: input.snapshot,
      localStore: input.localStore,
      migrationDone: input.migrationDone,
    })
    return sharedReviewProgressMigrationActor
  }

  static readonly stop = (): void => {
    sharedReviewProgressMigrationActor?.stop()
    sharedReviewProgressMigrationActor = undefined
  }

  static readonly retain = (): (() => void) => {
    reviewProgressMigrationConsumers += 1
    let retained = true
    return () => {
      if (!retained) return
      retained = false
      reviewProgressMigrationConsumers -= 1
      if (reviewProgressMigrationConsumers === 0) ReviewProgressMigration.stop()
    }
  }
}
