import type { PromptContentPart, SessionCreateRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { agentsApi, type Agent } from '@dshfiles/agents/contract'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { VcsProviderService } from '@dshfiles/vcs-provider-port/effect'
import { Clock, Context, Effect, Layer, Option } from 'effect'
import { AgentContinuation } from './agent-continuation.js'
import type { BacklogDetailView } from './api.js'
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
import { StartIntentClaims, StartIntents, type StartIntent, type StartIntentCreate, type StartIntentDraft, type StartIntentRoute } from './start-intents.js'
import { StartThreadForm, startThreadItemOf } from './start-thread.js'
import { StartThreadPlacementPlan } from './start-thread-workspace.js'
import { BacklogStore, type BacklogActor } from './store.js'
import { ProjectGuidance } from './project-guidance.js'

/** The opening message carries the same bounded preview the list shows, not a whole body. */
const PREVIEW_CHARS = 280

export const actorOf = (caller: ApiCaller): BacklogActor =>
  caller.kind === 'agent' ? { kind: 'agent', sessionId: caller.sessionId, cwd: caller.cwd } : { kind: 'user' }

// SAFETY: SessionRequestId is a type-only brand over a Host-minted unique id.
const requestId = (): SessionRequestId => globalThis.crypto.randomUUID() as SessionRequestId
// SAFETY: the same brand, for the id one recorded start already minted and reuses on every retry.
const requestIdOf = (value: string): SessionRequestId => value as SessionRequestId

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

export type StartThreadResult = { readonly sessionId: string; readonly linked: number[]; readonly missing: number[] }

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
 *
 * The start is written to a durable log before its Session exists, so a Host death inside the create → model → rename →
 * prompt → link sequence is finished by the next boot instead of leaving an empty Session and an unlinked item behind.
 */
export class ThreadStart extends Context.Service<
  ThreadStart,
  {
    readonly start: (input: StartThreadInput, caller: ApiCaller) => Effect.Effect<StartThreadResult, StartThreadError>
    /** Finishes a recorded start: reuses the Session it created and prompts it only when it never received its message. */
    readonly resume: (intent: StartIntent) => Effect.Effect<StartThreadResult, StartThreadError>
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
      const intents = yield* StartIntents
      const claims = yield* StartIntentClaims

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

      const threadItemsOf = (details: readonly BacklogDetailView[]) =>
        details.map(detail => startThreadItemOf({ ...detail.item, preview: StartThreadForm.preview(detail.item.body, PREVIEW_CHARS) }))

      /**
       * The opening message for these items as they read now: the item context, the project guidance every thread gets,
       * and the agent's identity in front. Recomposed on a resume, so a thread finished after a restart carries the
       * item's current text and attachments rather than a stale snapshot.
       */
      const openingOf = Effect.fn('backlog thread opening')(function* (input: {
        readonly intent: StartIntent
        readonly details: readonly BacklogDetailView[]
        readonly agent: Agent | null
      }) {
        const threadItems = threadItemsOf(input.details)
        const context = yield* BacklogStartContext.prepare({ details: input.details, readFile: store.readFile })
        const raw = input.intent.message ?? StartThreadForm.message(threadItems)
        const brief = raw === '' ? context.text : `${raw}\n\n${context.text}`
        const guided = [
          ...new Map(
            input.details.flatMap(detail =>
              detail.item.project === null || detail.guidance === null ? [] : [[detail.item.project, detail.guidance] as const],
            ),
          ).entries(),
        ]
        const task =
          guided.length === 0 ? brief : `${ProjectGuidance.preamble(guided.map(([project, guidance]) => ({ project, guidance })))}\n\n---\n\n${brief}`
        const message = input.agent === null ? task : AgentComments.opening(input.agent, task)
        return { title: StartThreadForm.title(threadItems), message, attachments: context.attachments, threadItems }
      })

      const forgetIntent = (id: string) =>
        intents.remove(id).pipe(Effect.catch(error => Effect.logWarning('backlog: the finished thread start was not cleared from the recovery log', error)))

      const rememberSession = (id: string, sessionId: string) =>
        Effect.flatMap(Clock.currentTimeMillis, now =>
          intents
            .setSession(id, sessionId, now)
            .pipe(Effect.catch(error => Effect.logWarning('backlog: the started thread was not recorded for recovery', error))),
        )

      const keepAlive = (id: string) =>
        Effect.flatMap(Clock.currentTimeMillis, now =>
          intents.touch(id, now).pipe(Effect.catch(error => Effect.logWarning('backlog: the running thread start was not refreshed', error))),
        )

      /** Every step one start runs, from the recorded intent: the only difference between a first run and a resume. */
      const execute = Effect.fn('backlog thread start execute')(function* (input: {
        readonly intent: StartIntent
        readonly details: readonly BacklogDetailView[]
        readonly agent: Agent | null
        readonly missing: number[]
      }) {
        const { title, message, attachments } = yield* openingOf(input)
        const known = input.intent.sessionId === null ? null : yield* sessions.summary(input.intent.sessionId)
        let sessionId: string | null = known === null ? null : String(known.sessionId)
        if (sessionId === null) {
          const base: SessionCreateRequest =
            input.intent.create.workspaceId === undefined
              ? input.intent.create.cwd === undefined
                ? {}
                : { cwd: input.intent.create.cwd }
              : { workspaceId: WorkspaceId(input.intent.create.workspaceId) }
          const created = yield* sessions.create(input.intent.agentPreset === null ? base : { ...base, agentPreset: input.intent.agentPreset })
          sessionId = created.sessionId
          yield* rememberSession(input.intent.id, sessionId)
        }
        const route: StartIntentRoute | null = input.intent.route
        if (route !== null) {
          const selection =
            route.reasoningEffort === undefined
              ? { sessionId, provider: route.provider, model: route.model }
              : { sessionId, provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort }
          yield* sessions
            .selectModel(selection)
            .pipe(Effect.catch(error => Effect.logWarning('backlog: the started thread kept the Host default model', error)))
        }
        yield* sessions.rename({ sessionId, title }).pipe(Effect.catch(error => Effect.logWarning('backlog: the started thread kept its created title', error)))
        // A resume prompts the same request id again: the Host answers `accepted` for a message it already has (inbox or
        // log), so a retried start never delivers its opening message twice and never drops it either.
        yield* keepAlive(input.intent.id)
        const content: PromptContentPart[] = [{ type: 'text', text: message }]
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- the prompt parts keep the item's attachment order.
        for (const attachment of attachments) {
          if (attachment.type === 'image') {
            content.push({ type: 'image', data: attachment.data, mediaType: attachment.mediaType, name: attachment.name })
            continue
          }
          const uploaded = yield* uploads.upload({ sessionId, name: attachment.name, bytes: attachment.bytes })
          content.push({ type: 'file', receiptId: uploaded.receiptId })
        }
        yield* sessions
          .prompt({ requestId: requestIdOf(input.intent.promptRequestId), sessionId, mode: 'queue', content })
          .pipe(Effect.mapError(cause => new ThreadContextNotDelivered({ sessionId, cause })))
        yield* keepAlive(input.intent.id)
        if (input.agent !== null)
          yield* agents
            .recordUse({ handle: input.agent.handle, thread: { sessionId, title } })
            .pipe(Effect.catch(error => Effect.logWarning(`backlog: agent @${input.agent?.handle ?? ''} thread history was not updated`, error)))
        const linked: number[] = []
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each link is one serialized store write and `linked` keeps the request order.
        for (const detail of input.details) {
          const alreadyLinked = detail.item.links.some(link => link.type === 'thread' && link.target === sessionId)
          if (alreadyLinked) {
            linked.push(detail.item.id)
          } else {
            const result = yield* store
              .link({
                id: detail.item.id,
                link: { type: 'thread', target: sessionId, provenance: input.intent.actor.kind === 'agent' ? 'agent' : 'user' },
                actor: input.intent.actor,
              })
              .pipe(
                Effect.catch((error: BacklogWriteFailed) =>
                  Effect.as(Effect.logWarning('backlog: an item was not linked to its thread', error), { ok: false } as const),
                ),
              )
            if (result.ok) linked.push(detail.item.id)
          }
          if (detail.item.delegate !== `agent:${sessionId}`)
            yield* store
              .delegateTo({ id: detail.item.id, sessionId, actor: input.intent.actor })
              .pipe(Effect.catch((error: BacklogWriteFailed) => Effect.logWarning('backlog: an item was not handed to its thread', error)))
        }
        return { sessionId, linked, missing: input.missing }
      })

      /** Clears a failed start that created nothing, and keeps one whose Session exists so the next boot finishes it. */
      const forgetAbandonedIntent = (id: string) =>
        Effect.gen(function* () {
          const stored = yield* intents.find(id).pipe(Effect.catch(() => Effect.succeed(null)))
          if (stored !== null && stored.sessionId !== null) return
          yield* forgetIntent(id)
        })

      const start = Effect.fn('backlog thread start')(function* (input: StartThreadInput, caller: ApiCaller) {
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.items': input.ids.length })
        const { items, missing } = yield* store.getMany(input.ids)
        if (items.length === 0 || missing.length > 0) return yield* new BacklogItemNotFound({ ids: missing.length === 0 ? input.ids : missing })
        const agent: Agent | null = input.agent === undefined ? null : yield* agentForStart(input.agent)
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
        const route: StartIntentRoute | null =
          agent?.route ??
          (input.provider === undefined || input.model === undefined
            ? null
            : { provider: input.provider, model: input.model, reasoningEffort: input.reasoningEffort })
        const create: StartIntentCreate =
          base.workspaceId === undefined ? (base.cwd === undefined ? {} : { cwd: base.cwd }) : { workspaceId: String(base.workspaceId) }
        const draft: StartIntentDraft = {
          id: globalThis.crypto.randomUUID(),
          promptRequestId: requestId(),
          itemIds: input.ids,
          agent: agent === null ? null : agent.handle,
          agentPreset: agent === null ? null : agent.preset,
          create,
          route,
          message: input.message ?? null,
          actor: actorOf(caller),
        }
        const now = yield* Clock.currentTimeMillis
        const intent: StartIntent = { ...draft, createdAt: now, updatedAt: now, sessionId: null, attempts: 0, lastError: null }
        const recorded = yield* intents
          .record(draft, now)
          .pipe(Effect.catch(error => Effect.as(Effect.logWarning('backlog: the thread start could not be recorded for recovery', error), false)))
        const outcome = yield* claims.hold(intent.id, execute({ intent, details: items, agent, missing })).pipe(Effect.result)
        if (outcome._tag === 'Failure') {
          // A start that never created its Session failed for the caller, who sees the reason; only a created Session is
          // resumed, so a manual retry cannot race a recovery pass into a second thread.
          if (recorded) yield* forgetAbandonedIntent(intent.id)
          return yield* Effect.fail(outcome.failure)
        }
        if (recorded && outcome.success.linked.length === intent.itemIds.length) yield* forgetIntent(intent.id)
        yield* Effect.annotateCurrentSpan('dshx.backlog.started_thread', outcome.success.sessionId)
        return outcome.success
      })

      const resume = Effect.fn('backlog thread resume')(function* (intent: StartIntent) {
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.start_intent': intent.id })
        const { items, missing } = yield* store.getMany(intent.itemIds)
        if (items.length === 0 || missing.length > 0) return yield* new BacklogItemNotFound({ ids: items.length === 0 ? intent.itemIds : missing })
        const agent: Agent | null = intent.agent === null ? null : yield* agentForStart(intent.agent)
        return yield* execute({ intent, details: items, agent, missing })
      })

      return ThreadStart.of({ start, resume, continuationCandidates, continueThread })
    }),
  )
}
