/** Session commands whose activation policy is explicit at each Remote method. */

import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { continuationProjectionDefinition, type ContinuationState } from './continuation.ts'

import { modelAvailable } from './catalog.ts'
import { PluginApiError } from '@dshfiles/dshx/api'
import { annotateThreadModel } from '../thread-model-policy.ts'
import type { ThreadModelSelect, ThreadModelSnapshot } from '../thread-model-api.ts'
import { underArchivedSession } from './archived-session-gate.ts'
import { latestInterruptedTurn, latestStoppedTurn } from '../interrupted-turn.ts'
import { turnRetryMessage } from '../turn-retry.ts'
import type { TurnAdmissionQueue } from '../turn-admission.ts'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, ModelSelection as AgentModelSelection } from '@deepseek-ai/dsh-agent'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentAdmissionPart,
} from '@deepseek-ai/dsh-attachment'
import type { FileUploadReceiptId, StagedAttachment } from '@deepseek-ai/dsh-client-file-upload/types'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import {
  ReasoningEffortId, createUserMessage, freezeMessage,
} from '@deepseek-ai/dsh-llm'
import type { MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  ApiSessionAgentController,
  ApiSessionCwdConflict,
  ApiSessionPresetConflict,
  ApiSessionSubagentOwnership,
  apiSessionSubagentOwnershipError,
  hasApiSessionSubagentOwner,
  type ApiSessionCreated,
} from './agent.ts'
import type {
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionCreateRequest,
  SessionCreateValue,
  SessionForkDestination,
  SessionForkRequest,
  SessionForkValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
  SessionRequestId,
} from './types.ts'

type PromptContentCandidate =
  | SessionPromptRequest['content'][number]
  | Extract<SessionUpdateQueueRequest['action'], { readonly kind: 'edit' }>['content'][number]

/**
 * Whether prompt content carries non-whitespace text or an attachment.
 * @param content - submitted or edited prompt parts.
 * @returns whether any part supplies ordinary prompt content.
 */
export function hasPromptContent(content: readonly PromptContentCandidate[]): boolean {
  return content.some(part => part.type !== 'text' || part.text.trim().length > 0)
}

/**
 * Resolve the omitted-`atSeq` default to the latest completed-turn prefix,
 * including standalone events before the next turn begins.
 */
function latestCompletedPrefixBoundary(events: readonly SessionEvent[]): SessionSeq | undefined {
  const lastTurnEnd = events.findLast(event => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return undefined
  let boundary = lastTurnEnd.seq
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start' || (next.type === 'user/message' && next.surfaceOp === 'append')
      || next.type === 'agent/inbox/spliced') break
    boundary = next.seq
  }
  return boundary
}

/** Implements Session business commands delegated by the Session Controller Remote service. */
export class SessionCommandController {
  /** First-insertion facts cached per exact Session; the log remains the recovery source. */
  private readonly promptReceipts = new WeakMap<Session, {
    offset: SessionLogOffset
    messages: Set<MessageId>
    requests: Set<SessionRequestId>
  }>()

  private continuation!: ProjectionHandle<ContinuationState>

  /** Register complete-history empty-prompt eligibility. @returns when command admission is ready. */
  async initialize(): Promise<void> {
    this.continuation = await this.ctx.sessionProjections.register(continuationProjectionDefinition)
  }

  /**
   * @param ctx - Host context carrying Agent, model, attachment, title, and Workspace services.
   * @param agents - sole owner of create, resume, and Agent composition.
   * @param defaultCwd - project directory used when create names neither a Workspace nor a cwd.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
    private readonly defaultCwd: string,
    private readonly admission?: TurnAdmissionQueue,
  ) {}

  /**
   * Create one ordinary Session for a new conversation, reusing the named
   * blank Session while it is an unarchived member of the requested Workspace.
   * @param request - optional blank Session to reuse, location, and Agent preset.
   * @returns the created or reused Session identity and its preset when configured.
   */
  async create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    if (request.workspaceId !== undefined && request.cwd !== undefined) {
      throw new RemoteError('gateway/bad-request', 'session.create accepts workspaceId or cwd, not both', {})
    }
    let workspace: Workspace | undefined
    if (request.workspaceId !== undefined) {
      workspace = this.ctx.workspaceRegistry.get(request.workspaceId)
      if (workspace === undefined) {
        throw new RemoteError('workspace/not-found', `workspace "${request.workspaceId}" not found`, {
          workspaceId: request.workspaceId,
        })
      }
    }
    const cwd = workspace?.path ?? request.cwd ?? this.defaultCwd
    let created: ApiSessionCreated
    try {
      created = await this.agents.createSession({
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        cwd,
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
        reusable: sessionId => !this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)
          && (workspace === undefined || workspace.sessionIds.includes(sessionId)),
      })
    } catch (error) {
      this.rejectCreation(error)
    }
    const sessionId = created.agent.id
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(sessionId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${sessionId}" was created but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId, workspaceId: workspace.id },
        )
      }
    }
    return { sessionId, ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }) }
  }

  /**
   * Validate and record one Session model selection; save the default in the background.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection recorded for the Session, without waiting for default persistence.
   */
  async selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return this.withValidatedModel(request, (agent, selected) => {
      agent.model.select(selected)
      void this.ctx.agentDefaultModel.saveSelection(selected).catch((error: unknown) => {
        this.ctx.logger.warn(`session-controller: model selection changed for the Session but the default was not saved: ${String(error)}`)
      })
      return { selected: { ...selected } }
    })
  }

  /** Thread-only selection: compare intent after every validation await, then commit without yielding. */
  async selectThreadModel(request: ThreadModelSelect & { sessionId: SessionId }): Promise<ThreadModelSnapshot> {
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(request.sessionId)) {
      throw new PluginApiError('Restore the archived thread before changing its model.', { code: 'thread-model-archived' })
    }
    return this.withValidatedModel({ sessionId: request.sessionId, ...request.selection }, (agent, selected) => {
      if (!this.ctx.remoteAccess.allows({ kind: 'session', id: agent.id })) {
        throw new PluginApiError('No thread with that id exists.', { code: 'thread-not-found' })
      }
      if (underArchivedSession(this.ctx, agent)) {
        throw new PluginApiError('Restore the archived thread before changing its model.', { code: 'thread-model-archived' })
      }
      if (hasApiSessionSubagentOwner(agent.session)) throw apiSessionSubagentOwnershipError(agent.id)
      if (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) {
        throw new PluginApiError('Let the thread’s queued input settle before changing its account.', { code: 'thread-model-busy' })
      }
      const policy = this.ctx.sessionProjections.snapshot(agent.session, ['threadModelPolicy']).values.threadModelPolicy
      if (policy === undefined) throw new PluginApiError('Thread model policy is unavailable.', { code: 'thread-model-unavailable' })
      if (policy.revision !== request.expectedRevision) {
        throw new PluginApiError('The thread model changed. Read its current state and confirm again.', { code: 'thread-model-stale' })
      }
      // The policy revision is the seq after this selection's own event, so a same-route reselection still records one;
      // `agent.model.select` skips a selection equal to the recorded one.
      agent.session.append('model/selection', selected)
      const revision = agent.session.seq
      annotateThreadModel(agent.session, { revision, selection: selected, preferSelectedProvider: request.preferSelectedProvider })
      return { sessionId: agent.id, selection: { ...selected }, revision, running: agent.status !== 'idle', preferSelectedProvider: request.preferSelectedProvider }
    })
  }

  private async withValidatedModel<Value>(request: SessionSelectModelRequest, commit: (agent: Agent, selected: AgentModelSelection) => Value): Promise<Value> {
    const agent = await this.resolveAgent(request.sessionId)
    return this.agents.serializeImageAdmission(agent, async () => {
      try {
        await this.requireModel(request)
        const selected: AgentModelSelection = {
          provider: request.provider,
          model: request.model,
          ...(request.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
        }
        await this.ctx.llm.resolveCallConfig(selected)
        return commit(agent, selected)
      } catch (error) {
        if (remoteErrorOf(error) !== undefined || error instanceof PluginApiError) throw error
        throw new RemoteError(
          'session/model-unavailable',
          error instanceof Error ? error.message : String(error),
          { provider: request.provider, model: request.model },
        )
      }
    })
  }

  /**
   * Normalize and append a user-owned Session title.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  async rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    const agent = await this.resolveAgent(request.sessionId)
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) {
      throw new RemoteError('gateway/internal', 'renaming is unavailable: this deployment mounts no session-title service', {})
    }
    try {
      const accepted = titles.rename(agent.session, request.title)
      return { title: accepted.title, seq: accepted.eventSeq }
    } catch (error) {
      if (error instanceof SessionTitleInvalidError) {
        throw new RemoteError('session/title-invalid', error.message, { sessionId: request.sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `failed to rename session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
  }

  /**
   * Create a new ordinary Session from an exact event prefix. An explicit
   * `atSeq` is the inclusive cut; an omitted value selects the latest
   * completed-turn prefix. An open cut receives synthetic fork closers.
   * @param request - source Session and optional exact event boundary.
   * @param destination - dshfiles: Host-only target Workspace the fork runs in instead of the source's own.
   * @returns the new Session identity.
   */
  async fork(request: SessionForkRequest, destination?: SessionForkDestination): Promise<SessionForkValue> {
    let atSeq: ReturnType<typeof SessionSeq> | undefined
    try {
      atSeq = request.atSeq === undefined ? undefined : SessionSeq(request.atSeq)
    } catch {
      throw new RemoteError('gateway/bad-request', 'atSeq must be a non-negative safe integer', {})
    }
    let observed: SessionObservation
    try {
      observed = await this.ctx.sessionQuery.observeSession(request.sessionId)
    } catch (error) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${request.sessionId}" not found`, {
          sessionId: request.sessionId,
        })
      }
      throw new RemoteError(
        'gateway/internal',
        `fork source unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    using source = observed
    const boundary = atSeq
      ?? (destination?.includeOpenTurn === true ? source.events.at(-1)?.seq : latestCompletedPrefixBoundary(source.events))
    if (boundary === undefined || source.events[boundary]?.seq !== boundary) {
      throw new RemoteError(
        'session/fork-unavailable',
        request.atSeq === undefined
          ? `session "${request.sessionId}" has no completed turn to fork from`
          : `event ${String(request.atSeq)} does not exist in session "${request.sessionId}" (last seq: ${String(source.events.at(-1)?.seq ?? 'none')})`,
        { sessionId: request.sessionId },
      )
    }
    const seed = buildForkSeed(source.events, boundary)
    let workspace: Workspace | undefined
    try {
      workspace = destination === undefined
        ? await this.forkWorkspace(source.header)
        : this.destinationWorkspace(destination.workspaceId)
    } catch (error) {
      if (remoteErrorOf(error) !== undefined) throw error
      throw new RemoteError(
        'gateway/internal',
        `failed to resolve fork workspace for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    const childId = brandString<SessionId>(`session-${randomUUID()}`)
    const composition = await this.agents.composeAgent(this.agents.presetForObservation(source))
    const cwd = destination === undefined ? source.header.cwd : workspace?.path
    let child: Agent
    try {
      const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
      child = this.agents.own(await this.ctx.agents.create({
        sessionId: childId,
        seed,
        inheritedEventCount: SessionLogOffset(boundary + 1),
        meta: {
          ...(cwd === undefined ? {} : { cwd }),
          isSeeded: true,
          ...(composition.agentPreset === undefined
            ? {}
            : { agentPreset: composition.agentPreset }),
        },
        agentOptions: { provider, model },
        setup: composition.setup,
      }))
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `failed to fork session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    if (destination !== undefined && cwd !== undefined) {
      await this.announceDestination({ child, cwd, source: source.header })
    }
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(childId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${childId}" was forked but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId: childId, workspaceId: workspace.id },
        )
      }
    }
    return { sessionId: childId }
  }

  /**
   * Admit one prompt after Agent and attachment validation; the Remote method
   * has already validated the content and built the durable message source.
   * @param request - Session identity, prompt content, and delivery mode.
   * @param source - caller metadata recorded on the accepted ordinary or retry user message.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  async prompt(request: SessionPromptRequest, source: MessageSource): Promise<SessionPromptValue> {
    const agent = await this.resolveAgent(request.sessionId)
    if (this.hasPromptRequest(agent.session, request.requestId)) return { accepted: true }
    if (request.content.length === 0) {
      try {
        return await agent.runMaintenance(() => {
          const inbox = agent.inbox
          if (request.mode !== 'queue' || this.continuation.stateOf(agent.session).ending === null
            || inbox.nextTurn.length > 0 || inbox.nextStep.some(message => message.source.kind === 'user')) {
            throw new RemoteError('session/agent-busy', 'generation continuation is unavailable', { reason: 'NO_CONTINUABLE_FAILURE_OR_PENDING_INPUT' })
          }
          agent.followup(createUserMessage({ content: [], source }))
          return Promise.resolve({ accepted: true as const })
        })
      } catch (error: unknown) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError('session/agent-busy', 'generation continuation was not accepted', { reason: String(error) })
      }
    }
    const admission = resolvePromptFileReceipts(
      request.content,
      receiptId => this.ctx.fileUploads.resolve(agent, receiptId),
    )
    // Encoded images and image upload receipts both make an image prompt.
    const hasImage = admission.content.some(part => part.type === 'image')
    const admit = async (): Promise<SessionPromptValue> => {
      try {
        if (this.hasPromptRequest(agent.session, request.requestId)) return { accepted: true }
        if (hasImage) {
          const current = agent.model.current()
          if (current !== undefined) {
            const model = await this.ctx.llm.resolveModelInfo(current.provider, current.model)
            if (model.inputModalities !== undefined && !model.inputModalities.includes('image')) {
              throw new RemoteError(
                'session/attachment-invalid',
                `Model "${current.model}" does not support image input.`,
                { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
              )
            }
          }
        }
        const content = await this.ctx.attachments.admitPromptContent(admission.content)
        if (this.hasPromptRequest(agent.session, request.requestId)) return { accepted: true }
        const message: UserMessage = createUserMessage({ content, source })
        if (this.ctx.agents.get(agent.id) !== agent) {
          throw new RemoteError(
            'session/not-found',
            `session "${agent.id}" was disposed during prompt admission`,
            { sessionId: agent.id },
          )
        }
        if (this.hasPromptRequest(agent.session, request.requestId)) return { accepted: true }
        if (request.expectedInterruptedSeq !== undefined
          && (agent.status !== 'idle' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0
            || latestInterruptedTurn(agent.session.snapshotEvents()) !== request.expectedInterruptedSeq)) {
          throw new RemoteError('session/interruption-superseded', 'That stopped task is no longer waiting to be resumed.', {})
        }
        using binding = this.ctx.fileUploads.bindPrompt(agent, admission.receiptIds, request.requestId)
        // dshfiles: a new turn waits for a free slot under the running-thread limit, parked durably in its inbox.
        if (this.admission !== undefined && agent.status === 'idle' && this.admission.shouldHold()) {
          agent.send(message, 'next-turn', false)
          this.admission.hold({
            sessionId: agent.id,
            messageId: message.id,
            mode: request.mode === 'steer' ? 'steer' : 'followup',
            heldAt: Date.now(),
          })
          this.admission.pump()
        } else if (request.mode === 'steer') agent.steer(message)
        else agent.followup(message)
        binding.commit()
      } catch (error) {
        if (this.hasPromptRequest(agent.session, request.requestId)) return { accepted: true }
        if (remoteErrorOf(error) !== undefined) throw error
        if (error instanceof AttachmentError) {
          throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
        }
        throw new RemoteError('session/agent-busy', 'prompt rejected', { reason: String(error) })
      }
      return { accepted: true }
    }
    return hasImage ? this.agents.serializeImageAdmission(agent, admit) : admit()
  }

  /**
   * dshfiles: run a stopped turn that produced nothing again. Every turn opens from a message, so the request is woken by
   * a `turn-retry` notice instead of a human prompt asking the model to "continue" work that never started.
   * @returns whether the retry was queued; false once anything else happened in the Session.
   */
  async retryStoppedTurn(request: { readonly sessionId: SessionId; readonly seq: number }): Promise<boolean> {
    const found = await this.agents.resolveAgent(request.sessionId)
    if ('error' in found) return false
    const agent = found.agent
    if (underArchivedSession(this.ctx, agent) || agent.status !== 'idle' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) return false
    const stopped = latestStoppedTurn(agent.session.snapshotEvents())
    if (stopped?.action !== 'retry' || stopped.seq !== request.seq) return false
    agent.followup(turnRetryMessage(request.seq))
    return true
  }

  /** Recover first input acceptance, including claimed or removed messages, from unseen log entries. */
  private hasPromptRequest(session: Session, requestId: SessionRequestId): boolean {
    let receipts = this.promptReceipts.get(session)
    if (receipts === undefined) {
      receipts = { offset: SessionLogOffset(0), messages: new Set(), requests: new Set() }
      this.promptReceipts.set(session, receipts)
    }
    if (receipts.offset !== session.seq) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing prompt retry history read, retained for acceptance recovery.
      for (const event of session.snapshotEvents(receipts.offset)) {
        if (event.type !== 'agent/inbox/spliced' && event.type !== 'user/message') continue
        const messages = event.type === 'agent/inbox/spliced' ? event.data.inserted : [event.data]
        for (const message of messages) {
          if (receipts.messages.has(message.id)) continue
          receipts.messages.add(message.id)
          // A copied input is not a new request in the child, even if later reinserted there.
          if (event.seq < session.inheritedEventCount) continue
          const source = message.source
          if ((source.kind === 'user' || source.kind === 'retry') && 'rpcId' in source) receipts.requests.add(source.rpcId)
        }
      }
      receipts.offset = session.seq
    }
    return receipts.requests.has(requestId)
  }
  private async requireModel(selection: Pick<AgentModelSelection, 'provider' | 'model'>): Promise<void> {
    if (!await modelAvailable(this.ctx, selection)) {
      throw new RemoteError('session/model-unavailable', 'Select an available model before sending a message.',
        { provider: selection.provider, model: selection.model })
    }
  }

  /**
   * Read one durable image using the supplied reference without consulting Session history.
   * @param request - image reference and gateway permission scope; Session existence is not checked.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  async attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    try {
      const stored = await this.ctx.attachments.readImage(request.attachment)
      return {
        attachment: stored.ref,
        data: Buffer.from(stored.data).toString('base64'),
      }
    } catch (error) {
      if (error instanceof AttachmentError) {
        throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
      }
      throw new RemoteError('gateway/internal', 'Unable to read image attachment.', {})
    }
  }

  /**
   * Mutate one pending Inbox occurrence, restoring an ordinary cold Agent when needed.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  async updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    if (request.action.kind === 'edit') {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Remote callers can submit untyped JSON.
      if (request.action.content.some(block => block.type !== 'text')) {
        throw new RemoteError(
          'session/attachment-invalid',
          'queue edits accept text content only',
          { reason: 'QUEUE_EDIT_NON_TEXT' },
        )
      }
      if (!hasPromptContent(request.action.content)) {
        throw new RemoteError(
          'gateway/bad-request',
          'queue edit content must include non-whitespace text',
          {},
        )
      }
    }
    let agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      const found = await this.agents.resolveAgent(request.sessionId)
      if ('error' in found) {
        if (found.error.code !== 'session/not-found') throw found.error
        throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
      }
      agent = found.agent
    }
    if (hasApiSessionSubagentOwner(agent.session)) {
      const identity = this.ctx.sessionProjections
        .snapshot(agent.session, ['subagent'])
        .values.subagent
      if (identity?.mode !== 'continuable'
        || !agent.session.isOwnSeq(identity.seq)) {
        throw apiSessionSubagentOwnershipError(request.sessionId)
      }
    }
    const nextTurn = agent.inbox.nextTurn.find(message => message.id === request.itemId)
    const nextStep = agent.inbox.nextStep.find(message => message.id === request.itemId)
    const located = nextTurn === undefined
      ? nextStep === undefined ? undefined : { target: 'next-step' as const, message: nextStep }
      : { target: 'next-turn' as const, message: nextTurn }
    if (located === undefined) {
      throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
    }
    const { target, message } = located
    if (request.action.kind === 'steer' && (target !== 'next-turn' || agent.status !== 'running')) {
      throw new RemoteError('session/steer-unavailable', 'current turn no longer accepts steering', { itemId: request.itemId })
    }
    switch (request.action.kind) {
      case 'edit':
        agent.inbox.replace(request.itemId, freezeMessage<UserMessage>({
          ...message,
          content: [...request.action.content],
        }))
        break
      case 'remove': {
        agent.inbox.remove(request.itemId)
        const source = message.source
        if (source.kind === 'user' && 'rpcId' in source) {
          this.ctx.fileUploads.retirePrompt(agent, source.rpcId)
        }
        break
      }
      case 'steer':
        agent.inbox.remove(request.itemId)
        agent.steer(message)
        break
      /* v8 ignore next 2 -- closed-union exhaustiveness guard */
      default:
        assertNever(request.action, 'queue action')
    }
    return { accepted: true }
  }

  /**
   * Cancel one live ordinary Agent while retaining pending inbox work.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  cancel(request: SessionCancelRequest): SessionCancelValue {
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      throw new RemoteError(
        'session/not-found',
        `session "${request.sessionId}" not found (not attached)`,
        { sessionId: request.sessionId },
      )
    }
    if (hasApiSessionSubagentOwner(agent.session)) {
      throw apiSessionSubagentOwnershipError(request.sessionId)
    }
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    return { accepted: true }
  }

  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    const found = await this.agents.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    return found.agent
  }

  private rejectCreation(error: unknown): never {
    if (remoteErrorOf(error) !== undefined) throw error
    if (error instanceof ApiSessionPresetConflict) {
      throw new RemoteError('agent-preset/conflict', error.message, {
        sessionId: error.sessionId,
        requestedPreset: error.requestedPreset,
      })
    }
    if (error instanceof ApiSessionCwdConflict) {
      throw new RemoteError('session/conflict', error.message, {
        sessionId: error.sessionId,
        requestedCwd: error.requestedCwd,
        ...(error.existingCwd === undefined ? {} : { existingCwd: error.existingCwd }),
      })
    }
    if (error instanceof ApiSessionSubagentOwnership) {
      throw apiSessionSubagentOwnershipError(error.sessionId)
    }
    throw new RemoteError('gateway/internal', `failed to create session: ${String(error)}`, {})
  }

  private destinationWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) {
      throw new RemoteError('workspace/not-found', `workspace "${workspaceId}" not found`, { workspaceId })
    }
    return workspace
  }

  /**
   * A seeded `working-directory/change` would put the child back in the source's folder, so the destination is
   * committed again, and the model learns where the conversation came from before its next request.
   */
  private async announceDestination(input: { readonly child: Agent; readonly cwd: string; readonly source: SessionHeader }): Promise<void> {
    await this.ctx.get('workingDirectory')?.set(input.child, input.cwd)
    const origin = input.source.cwd === undefined ? '' : ` in ${JSON.stringify(input.source.cwd)}`
    input.child.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `This thread continues thread ${input.source.id}, which ran${origin}. It now runs in ${JSON.stringify(input.cwd)}: use that directory for every file, command and project check from here on.`,
      }],
      source: { kind: 'working-directory' },
    }))
  }

  private async forkWorkspace(source: SessionHeader): Promise<Workspace | undefined> {
    const workspaces = this.ctx.workspaceRegistry.list()
    const direct = workspaces.find(workspace => workspace.sessionIds.includes(source.id))
    if (direct !== undefined || source.origin !== 'subagent') return direct
    const lineage = await this.ctx.sessionQuery.traceSession(source.id)
    for (const ancestor of lineage.ancestors) {
      const workspace = workspaces.find(candidate => candidate.sessionIds.includes(ancestor.header.id))
      if (workspace !== undefined) return workspace
    }
    return undefined
  }
}

/** Replace each file part with the file or image its staged receipt names. */
function resolvePromptFileReceipts(
  content: SessionPromptRequest['content'],
  staged: (receiptId: FileUploadReceiptId) => StagedAttachment | undefined,
): { readonly content: AttachmentAdmissionPart[]; readonly receiptIds: readonly FileUploadReceiptId[] } {
  const receiptIds = new Set<FileUploadReceiptId>()
  const resolved = content.map((part): AttachmentAdmissionPart => {
    if (part.type !== 'file') return part
    const attachment = staged(part.receiptId)
    if (attachment === undefined) {
      throw new RemoteError(
        'session/attachment-invalid',
        'File was not uploaded for this session.',
        { reason: 'FILE_NOT_STAGED' },
      )
    }
    receiptIds.add(part.receiptId)
    return attachment
  })
  return { content: resolved, receiptIds: [...receiptIds] }
}
