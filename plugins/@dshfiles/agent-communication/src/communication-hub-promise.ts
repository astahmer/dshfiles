import {
  CommunicationError,
  createCommunicationService,
  startHostCommunicationBridge,
  type CommunicationAgent,
  type CommunicationService,
} from '@dshfiles/dshx/communication'
import { liftPromiseClient, type LiftedClient } from '@dshfiles/dshx/effect/communication'
import { Context, Effect, Layer, Schema, type Scope } from 'effect'

const hubOperations = [
  'acknowledge',
  'browseMessages',
  'diagnostics',
  'enqueueActivity',
  'ensureSubscription',
  'inbox',
  'listTopics',
  'messageRecipients',
  'pruneInactiveWorkspaceTopics',
  'publish',
  'revealMessageBody',
  'send',
  'subscribe',
  'unreadCount',
  'unreadCounts',
  'unsubscribe',
] as const

/** A communication store operation failed; `code` and `detail` are the store's own error code and message. */
export class CommunicationOperationFailed extends Schema.TaggedError<CommunicationOperationFailed>()(
  'CommunicationOperationFailed',
  {
    operation: Schema.String,
    code: Schema.String,
    detail: Schema.String.check(Schema.isMaxLength(1_000)),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'communication-operation-error' },
) {
  override get message(): string {
    return this.detail
  }
}

export const communicationFailure = (operation: string, cause: unknown) =>
  cause instanceof CommunicationError
    ? new CommunicationOperationFailed({ operation, code: cause.code, detail: cause.message.slice(0, 1_000), cause })
    : new CommunicationOperationFailed({ operation, code: 'operation-failed', detail: `Agent communication ${operation} failed.`, cause })

export type CommunicationHubShape = LiftedClient<CommunicationService, (typeof hubOperations)[number], CommunicationOperationFailed> & {
  /**
   * Serve the local CLI/MCP bridge over this store for the Scope. Another DSH instance may own it already; then
   * in-process Agent tools keep working and this answers false.
   */
  readonly serveBridge: (listAgents: () => Promise<readonly CommunicationAgent[]>) => Effect.Effect<boolean, CommunicationOperationFailed, Scope.Scope>
}

const makeHub = (service: CommunicationService): CommunicationHubShape => ({
  ...liftPromiseClient({ subject: 'agent communication', client: service, operations: hubOperations, onError: communicationFailure }),
  serveBridge: listAgents =>
    Effect.acquireRelease(
      Effect.tryPromise({ try: () => startHostCommunicationBridge(service, { listAgents }), catch: cause => communicationFailure('serve bridge', cause) }),
      bridge => Effect.promise(() => bridge.close()),
    ).pipe(
      Effect.as(true),
      Effect.catchIf(
        error => error.code === 'host-already-active',
        () =>
          Effect.as(
            Effect.logWarning(
              'agent-communication: another DSH instance owns the local communication bridge; in-process Agent tools stay available and the external CLI/MCP bridge is not served by this instance',
            ),
            false,
          ),
      ),
      Effect.withSpan('agent communication serve bridge'),
    ),
})

/** The Host's durable peer-message store, as Effect methods. */
export class CommunicationHub extends Context.Service<CommunicationHub, CommunicationHubShape>()('@dshfiles/agent-communication/CommunicationHub') {
  static readonly layer = Layer.effect(
    CommunicationHub,
    Effect.sync(() => makeHub(createCommunicationService())),
  )

  /** A hub over an explicit store, e.g. one with a scratch state path in tests. */
  static readonly fromService = (service: CommunicationService) => Layer.succeed(CommunicationHub, makeHub(service))
}
