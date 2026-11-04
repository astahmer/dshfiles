import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEventSearchPage, SessionEventSearchRequest, SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { agentsApi } from '@dshfiles/agents/contract'
import type { CommunicationActivityOperation, CommunicationAgent } from '@dshfiles/dshx/communication'
import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { createHostApiClient, isApiServed } from '@dshfiles/dshx/host'
import { Context, Effect, Layer, Option, Schema, type Scope } from 'effect'
import type { DelegationSender } from './delegation-guard.js'
import { LiveAgentDirectoryModel } from './live-agent-directory.js'

/**
 * The `communication-message` payload this bundle emits on `dshfiles/activity/event`;
 * `@dshfiles/activity-timeline` decodes it by `kind` into one Activity item.
 */
export interface CommunicationMessageActivityPayload {
  readonly kind: 'communication-message'
  readonly value: {
    readonly at: number
    readonly messageId: string
    readonly senderId: string
    readonly recipientCount: number
    readonly intent: 'notice' | 'request'
    readonly topic: string | null
    readonly correlationId?: string | undefined
    readonly sessionId: string | null
  }
}

/** The `communication-activity` payload for one tracked tool call on the same event. */
export interface CommunicationOperationActivityPayload {
  readonly kind: 'communication-activity'
  readonly value: {
    readonly at: number
    readonly sessionId: string
    readonly operation: CommunicationActivityOperation
    readonly outcome: 'success' | 'failure'
    readonly callId: string
    readonly rootCallId: string | null
    readonly errorCode: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: CommunicationMessageActivityPayload | CommunicationOperationActivityPayload): void
    'dshfiles/activity/backfill'(payload: { readonly since?: number }): void
  }
}

/** A Host service the lookup needs is not loaded, or it refused the request. */
export class HostLookupFailed extends Schema.TaggedError<HostLookupFailed>()('HostLookupFailed', {
  service: Schema.Literals(['sessionQuery', 'workspaceRegistry']),
  reason: Schema.Literals(['unavailable', 'failed']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.service} is ${this.reason === 'unavailable' ? 'not loaded' : 'failing'} on this Host.`
  }
}

/** The live Agents of this Host and the activity events other plugins read. */
export class HostAgents extends Context.Service<
  HostAgents,
  {
    readonly list: Effect.Effect<readonly Agent[]>
    readonly isOwnedBy: (candidate: Agent, owner: Agent) => boolean
    readonly communicationAgents: Effect.Effect<readonly CommunicationAgent[]>
    readonly emitActivity: (payload: CommunicationMessageActivityPayload | CommunicationOperationActivityPayload) => Effect.Effect<void>
  }
>()('@dshfiles/agent-communication/HostAgents') {
  static readonly layer = Layer.effect(
    HostAgents,
    Effect.map(HostContext, host => {
      const list = Effect.sync((): readonly Agent[] => host.ctx.agents.list())
      return HostAgents.of({
        list,
        isOwnedBy: (candidate, owner) => host.ctx.agents.isOwnedBy(candidate.id, owner),
        communicationAgents: Effect.map(list, agents =>
          agents.map((agent): CommunicationAgent => ({
            id: agent.id,
            status: agent.status,
            workspaceTopic: LiveAgentDirectoryModel.communicationWorkspaceTopic(agent.session.header.cwd) ?? null,
          })),
        ),
        emitActivity: payload => Effect.sync(() => host.ctx.emit('dshfiles/activity/event', payload)),
      })
    }),
  )

  /** A fixed set of communication Agents standing in for the Host registry in tests; nothing is emitted. */
  static readonly layerTest = (agents: readonly CommunicationAgent[]) =>
    Layer.succeed(
      HostAgents,
      HostAgents.of({ list: Effect.succeed([]), isOwnedBy: () => false, communicationAgents: Effect.succeed(agents), emitActivity: () => Effect.void }),
    )
}

/** The persisted Session corpus and the workspace registry, both optional Host services read per call. */
export class SessionCorpus extends Context.Service<
  SessionCorpus,
  {
    readonly listSessions: Effect.Effect<readonly SessionRecord[], HostLookupFailed>
    readonly searchEvents: (request: SessionEventSearchRequest) => Effect.Effect<SessionEventSearchPage, HostLookupFailed>
    readonly workspaceAt: (cwd: string) => Effect.Effect<Option.Option<Workspace>, HostLookupFailed>
  }
>()('@dshfiles/agent-communication/SessionCorpus') {
  static readonly layer = Layer.effect(
    SessionCorpus,
    Effect.map(HostContext, host => {
      const service = <Name extends 'sessionQuery' | 'workspaceRegistry'>(name: Name) =>
        Effect.suspend(() => {
          const found = host.ctx.get(name)
          return found === undefined ? Effect.fail(new HostLookupFailed({ service: name, reason: 'unavailable' })) : Effect.succeed(found)
        })
      const failed = (name: 'sessionQuery' | 'workspaceRegistry') => (cause: unknown) => new HostLookupFailed({ service: name, reason: 'failed', cause })
      return SessionCorpus.of({
        listSessions: Effect.flatMap(service('sessionQuery'), sessionQuery =>
          Effect.tryPromise({ try: () => sessionQuery.listSessions(), catch: failed('sessionQuery') }),
        ),
        searchEvents: request =>
          Effect.flatMap(service('sessionQuery'), sessionQuery =>
            Effect.tryPromise({ try: signal => sessionQuery.searchEvents(request, { signal }), catch: failed('sessionQuery') }),
          ),
        workspaceAt: cwd =>
          Effect.flatMap(service('workspaceRegistry'), registry =>
            Effect.tryPromise({ try: () => registry.resolveByPath(cwd), catch: failed('workspaceRegistry') }),
          ).pipe(Effect.map(Option.fromUndefinedOr)),
      })
    }),
  )
}

/**
 * The agent that started a thread, when the agents bundle serves the registry. An absent bundle, a missing Session row
 * or an older agents build all answer none, which leaves messaging exactly as it was.
 */
export class ThreadAgents extends Context.Service<
  ThreadAgents,
  { readonly delegationOf: (sessionId: string) => Effect.Effect<Option.Option<DelegationSender>> }
>()('@dshfiles/agent-communication/ThreadAgents') {
  static readonly layer = Layer.effect(
    ThreadAgents,
    Effect.map(HostContext, host =>
      ThreadAgents.of({
        delegationOf: sessionId =>
          Effect.suspend(() => {
            if (!isApiServed(host.ctx, agentsApi, 'agent-communication')) return Effect.succeedNone
            const client = createHostApiClient(host.ctx, agentsApi, 'agent-communication')
            return Effect.tryPromise(() => client.safe.threadAgent({ sessionId })).pipe(
              Effect.map(result => {
                const agent = result.ok ? result.value.agent : null
                return agent === null ? Option.none<DelegationSender>() : Option.some({ handle: agent.handle, delegation: agent.delegation })
              }),
              Effect.orElseSucceed(() => Option.none<DelegationSender>()),
            )
          }),
      }),
    ),
  )

  /** No agents registry: every thread is unattributed, as when the agents bundle is not loaded. */
  static readonly layerNone = Layer.succeed(ThreadAgents, ThreadAgents.of({ delegationOf: () => Effect.succeedNone }))
}

/**
 * Run `handler` for every created Agent for the Scope. Cordis awaits it inside session creation, so the Agent is
 * registered before its first turn; `HostEvents.on` would run it detached.
 */
export const onAgentCreated = <R>(handler: (agent: Agent) => Effect.Effect<void, never, R>): Effect.Effect<void, never, HostContext | Scope.Scope | R> =>
  Effect.gen(function* () {
    const host = yield* HostContext
    const run = yield* DshxPlugin.callback(handler)
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        host.ctx.on('agent/created', async ({ agent }) => {
          await run(agent)
          return undefined
        }),
      ),
      dispose => Effect.sync(dispose),
    )
  })
