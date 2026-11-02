import type { PromptContentPart, SessionCreateRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { agentsApi, type Agent } from '@dshfiles/agents/contract'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { VcsProviderService } from '@dshfiles/vcs-provider-port/effect'
import { Context, Effect, Layer, Option } from 'effect'
import { AgentContinuation } from './agent-continuation.js'
import { HostSessions, HostUploads, HostWorkspaces } from './host-edge-promise.js'
import { AgentComments, type AgentContinuationThread } from './agent-dispatch.js'
import { BacklogStartContext } from './backlog-start-context.js'
import {
  AgentDisabled,
  AgentNotFound,
  AgentsUnavailable,
  BacklogItemNotFound,
  SessionsUnavailable,
  StartContextInvalid,
  ThreadAgentMismatch,
  ThreadContextNotDelivered,
  ThreadNotLinked,
  WorkspaceProvisionFailed,
  type BacklogWriteFailed,
} from './errors.js'
import { StartThreadForm, startThreadItemOf } from './start-thread.js'
import { StartThreadPlacementPlan } from './start-thread-workspace.js'
import { BacklogStore, type BacklogActor } from './store.js'

/** The opening message carries the same bounded preview the list shows, not a whole body. */
const PREVIEW_CHARS = 280

export const actorOf = (caller: ApiCaller): BacklogActor =>
  caller.kind === 'agent' ? { kind: 'agent', sessionId: caller.sessionId, cwd: caller.cwd } : { kind: 'user' }

// SAFETY: SessionRequestId is a type-only brand over a Host-minted unique id.
const requestId = (): SessionRequestId => globalThis.crypto.randomUUID() as SessionRequestId

export interface StartThreadInput {
  readonly ids: readonly number[]
  readonly workspaceId?: string | undefined
  readonly cwd?: string | undefined
  readonly agent?: string | undefined
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly reasoningEffort?: string | undefined
  readonly message?: string | undefined
}

type StartThreadError =
  | BacklogItemNotFound
  | AgentsUnavailable
  | AgentNotFound
  | AgentDisabled
  | WorkspaceProvisionFailed
  | SessionsUnavailable
  | StartContextInvalid
  | ThreadContextNotDelivered

/**
 * One thread for the items a caller named: its own workspace of their project, the agent's or the caller's model, the
 * first message with every item's full context, and every item link. The panel and `backlog_start_thread` share it.
 */
export class ThreadStart extends Context.Service<
  ThreadStart,
  {
    readonly start: (
      input: StartThreadInput,
      caller: ApiCaller,
    ) => Effect.Effect<{ readonly sessionId: string; readonly linked: number[]; readonly missing: number[] }, StartThreadError>
    readonly continuationCandidates: (input: {
      readonly id: number
      readonly handle: string
    }) => Effect.Effect<AgentContinuationThread[], BacklogItemNotFound | AgentsUnavailable | AgentNotFound | AgentDisabled>
    readonly continueThread: (input: {
      readonly id: number
      readonly handle: string
      readonly sessionId: string
      readonly text: string
    }) => Effect.Effect<
      { readonly sessionId: string; readonly queued: true },
      BacklogItemNotFound | AgentsUnavailable | AgentNotFound | AgentDisabled | ThreadNotLinked | ThreadAgentMismatch | SessionsUnavailable
    >
  }
>()('@dshfiles/backlog/ThreadStart') {
  static readonly layer = Layer.effect(
    ThreadStart,
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const agents = (yield* HostApis).client(agentsApi)
      const vcs = yield* VcsProviderService
      const sessions = yield* HostSessions
      const workspaces = yield* HostWorkspaces
      const uploads = yield* HostUploads

      const agentsFailed = (error: { readonly message: string }) => new AgentsUnavailable({ reason: error.message, cause: error })

      /** The agent a start names, refused when it is unknown or disabled so the thread is not started as the wrong one. */
      const agentForStart = Effect.fn('backlog agent for start')(function* (handle: string) {
        const agent = (yield* agents.get({ handle }).pipe(Effect.mapError(agentsFailed))).agent
        if (agent === null) return yield* new AgentNotFound({ handle })
        if (!agent.enabled) return yield* new AgentDisabled({ handle })
        return agent
      })

      const threadOwner = (sessionId: string) =>
        agents.threadAgent({ sessionId }).pipe(
          Effect.map(found => found.agent?.handle ?? null),
          Effect.mapError(agentsFailed),
        )

      const linkedItem = Effect.fn('backlog linked item')(function* (id: number) {
        const found = yield* store.get(id)
        if (!found.ok) return yield* new BacklogItemNotFound({ ids: [id] })
        return found.value.item
      })

      const continuationCandidates = Effect.fn('backlog agent continuation candidates')(function* (input: { readonly id: number; readonly handle: string }) {
        const item = yield* linkedItem(input.id)
        yield* agentForStart(input.handle)
        const linkedSessions = item.links.filter(link => link.type === 'thread').map(link => link.target)
        const owners = yield* Effect.forEach(linkedSessions, sessionId => Effect.map(threadOwner(sessionId), owner => ({ sessionId, owner })), {
          concurrency: 'unbounded',
        })
        const threads = owners.filter(entry => entry.owner === input.handle).map(entry => ({ sessionId: entry.sessionId, title: entry.sessionId }))
        return AgentContinuation.candidates({ links: item.links, threads })
      })

      const continueThread = Effect.fn('backlog agent continuation queue')(function* (input: {
        readonly id: number
        readonly handle: string
        readonly sessionId: string
        readonly text: string
      }) {
        const item = yield* linkedItem(input.id)
        if (!item.links.some(link => link.type === 'thread' && link.target === input.sessionId))
          return yield* new ThreadNotLinked({ itemId: input.id, sessionId: input.sessionId })
        yield* agentForStart(input.handle)
        const ownerHandle = yield* threadOwner(input.sessionId)
        if (!AgentContinuation.ownsLinkedThread({ links: item.links, sessionId: input.sessionId, requestedHandle: input.handle, ownerHandle }))
          return yield* new ThreadAgentMismatch({ handle: input.handle, sessionId: input.sessionId })
        yield* sessions.prompt({
          requestId: requestId(),
          sessionId: input.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: input.text }],
        })
        return { sessionId: input.sessionId, queued: true as const }
      })

      /**
       * The workspace a started thread runs in: the version-control provider that claims the project cuts a thread
       * workspace from it, and a project no provider claims, or a Host without any provider, starts in the checkout.
       */
      const isolatedWorkspaceOf = Effect.fn('backlog isolated workspace')(function* (workspaceId: string) {
        const path = (yield* workspaces.list).find(workspace => workspace.id === workspaceId)?.path
        const provider = path === undefined ? Option.none() : yield* vcs.resolve({ path })
        if (Option.isNone(provider)) return WorkspaceId(workspaceId)
        const provisioned = yield* provider.value.client
          .provision({ workspaceId, isolate: true })
          .pipe(Effect.mapError(error => new WorkspaceProvisionFailed({ workspaceId, reason: error.message, cause: error })))
        return WorkspaceId(provisioned.workspaceId)
      })

      const start = Effect.fn('backlog thread start')(function* (input: StartThreadInput, caller: ApiCaller) {
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.items': input.ids.length })
        const { items, missing } = yield* store.getMany(input.ids)
        if (items.length === 0 || missing.length > 0) return yield* new BacklogItemNotFound({ ids: missing.length === 0 ? input.ids : missing })
        const agent: Agent | null = input.agent === undefined ? null : yield* agentForStart(input.agent)
        const details = items.map(detail => startThreadItemOf({ ...detail.item, preview: detail.item.body.slice(0, PREVIEW_CHARS) }))
        const context = yield* BacklogStartContext.prepare({ details: items, readFile: store.readFile })
        const raw = input.message ?? StartThreadForm.message(details)
        const task = raw === '' ? context.text : `${raw}\n\n${context.text}`
        const message = agent === null ? task : AgentComments.opening(agent, task)
        const placement = StartThreadPlacementPlan.of({
          workspaceId: input.workspaceId,
          cwd: input.cwd,
          registered: yield* workspaces.list,
          itemProjects: items.map(detail => detail.item.project),
        })
        const base: SessionCreateRequest =
          placement.workspaceId !== undefined
            ? { workspaceId: yield* isolatedWorkspaceOf(placement.workspaceId) }
            : placement.cwd === undefined
              ? {}
              : { cwd: placement.cwd }
        const created = yield* sessions.create(agent?.preset == null ? base : { ...base, agentPreset: agent.preset })
        const sessionId = created.sessionId
        const title = StartThreadForm.title(details)
        const route =
          agent?.route ??
          (input.provider === undefined || input.model === undefined ? null : { provider: input.provider, model: input.model, reasoningEffort: input.reasoningEffort })
        if (route !== null) {
          const selection = { sessionId, provider: route.provider, model: route.model, ...(route.reasoningEffort !== undefined && { reasoningEffort: route.reasoningEffort }) }
          yield* sessions
            .selectModel(selection)
            .pipe(Effect.catch(error => Effect.logWarning('backlog: the started thread kept the Host default model', error)))
        }
        yield* sessions.rename({ sessionId, title }).pipe(Effect.catch(error => Effect.logWarning('backlog: the started thread kept its created title', error)))
        yield* Effect.gen(function* () {
          const content: PromptContentPart[] = [{ type: 'text', text: message }]
          // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- the prompt parts keep the item's attachment order.
          for (const attachment of context.attachments) {
            if (attachment.type === 'image') {
              content.push({ type: 'image', data: attachment.data, mediaType: attachment.mediaType, name: attachment.name })
              continue
            }
            const uploaded = yield* uploads.upload({ sessionId, name: attachment.name, bytes: attachment.bytes })
            content.push({ type: 'file', receiptId: uploaded.receiptId })
          }
          yield* sessions.prompt({ requestId: requestId(), sessionId, mode: 'queue', content }).pipe(
            Effect.mapError(cause => new ThreadContextNotDelivered({ sessionId, cause })),
          )
        })
        if (agent !== null)
          yield* agents
            .recordUse({ handle: agent.handle, thread: { sessionId, title } })
            .pipe(Effect.catch(error => Effect.logWarning(`backlog: agent @${agent.handle} thread history was not updated`, error)))
        const actor = actorOf(caller)
        const provenance = caller.kind === 'agent' ? 'agent' : 'user'
        const linked: number[] = []
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each link is one serialized store write and `linked` keeps the request order.
        for (const detail of items) {
          const result = yield* store
            .link({ id: detail.item.id, link: { type: 'thread', target: sessionId, provenance }, actor })
            .pipe(Effect.catch((error: BacklogWriteFailed) => Effect.as(Effect.logWarning('backlog: an item was not linked to its thread', error), { ok: false } as const)))
          if (result.ok) linked.push(detail.item.id)
        }
        return { sessionId, linked, missing }
      })

      return ThreadStart.of({ start, continuationCandidates, continueThread })
    }),
  )
}
