import { Schema } from 'effect'

const itemRefs = (ids: readonly number[]): string => ids.map(id => `b:${String(id)}`).join(', ')

export class BacklogItemNotFound extends Schema.TaggedError<BacklogItemNotFound>()(
  'BacklogItemNotFound',
  { ids: Schema.Array(Schema.Number) },
  { dshxWireCode: 'item-not-found' },
) {
  override get message(): string {
    return `No complete backlog context for ${itemRefs(this.ids)}.`
  }
}

export class BacklogWriteFailed extends Schema.TaggedError<BacklogWriteFailed>()(
  'BacklogWriteFailed',
  { itemId: Schema.Number, operation: Schema.Literals(['put', 'delete']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'backlog-write-failed' },
) {
  override get message(): string {
    return `Backlog item b:${String(this.itemId)} could not be saved. Retry; if it keeps failing, check the Host log for the storage error.`
  }
}

export class BackfillAlreadyRunning extends Schema.TaggedError<BackfillAlreadyRunning>()(
  'BackfillAlreadyRunning',
  { jobId: Schema.String },
  { dshxWireCode: 'backfill-already-running' },
) {
  override get message(): string {
    return `A backlog backfill is already running (${this.jobId}). Wait for it to finish, then start another.`
  }
}

/** Neither Jev nor a triage model is usable with the current settings. */
export class TriageUnconfigured extends Schema.TaggedError<TriageUnconfigured>()('TriageUnconfigured', {
  reason: Schema.Literals(['jev-key-missing', 'off']),
}) {
  override get message(): string {
    return this.reason === 'jev-key-missing'
      ? 'Jev is on but its key does not resolve: bind a TypeSafe secret or set TYPESAFE_API_KEY, or pick a triage model.'
      : 'Triage is off: turn on Jev or pick a triage provider and model in the Backlog settings.'
  }
}

export class LlmCompletionFailed extends Schema.TaggedError<LlmCompletionFailed>()(
  'LlmCompletionFailed',
  { provider: Schema.String, model: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'llm-completion-failed' },
) {
  override get message(): string {
    return `The ${this.provider}/${this.model} model did not answer. Check the account in AI Accounts or pick another model, then retry.`
  }
}

export class EmptyReply extends Schema.TaggedError<EmptyReply>()('EmptyReply', {}, { dshxWireCode: 'empty-reply' }) {
  override get message(): string {
    return 'The reply model returned no text.'
  }
}

export class AttachmentExportFailed extends Schema.TaggedError<AttachmentExportFailed>()(
  'AttachmentExportFailed',
  { itemId: Schema.Number, attachmentId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'attachment-export-failed' },
) {
  override get message(): string {
    return `Attachment ${this.attachmentId} of b:${String(this.itemId)} could not be written to a temporary file. Read it as a data URL instead.`
  }
}

export class StartContextInvalid extends Schema.TaggedError<StartContextInvalid>()(
  'StartContextInvalid',
  { reason: Schema.String },
  { dshxWireCode: 'start-context-invalid' },
) {
  override get message(): string {
    return this.reason
  }
}

export class WorkspaceProvisionFailed extends Schema.TaggedError<WorkspaceProvisionFailed>()(
  'WorkspaceProvisionFailed',
  { workspaceId: Schema.String, reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'workspace-failed' },
) {
  override get message(): string {
    return `The thread workspace could not be created: ${this.reason}`
  }
}

export class AgentsUnavailable extends Schema.TaggedError<AgentsUnavailable>()(
  'AgentsUnavailable',
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'agents-unavailable' },
) {
  override get message(): string {
    return `The agent registry could not be read: ${this.reason}`
  }
}

export class AgentNotFound extends Schema.TaggedError<AgentNotFound>()('AgentNotFound', { handle: Schema.String }, { dshxWireCode: 'agent-not-found' }) {
  override get message(): string {
    return `No agent is saved as @${this.handle}.`
  }
}

export class AgentDisabled extends Schema.TaggedError<AgentDisabled>()('AgentDisabled', { handle: Schema.String }, { dshxWireCode: 'agent-disabled' }) {
  override get message(): string {
    return `Agent @${this.handle} is disabled.`
  }
}

export class ThreadNotLinked extends Schema.TaggedError<ThreadNotLinked>()(
  'ThreadNotLinked',
  { itemId: Schema.Number, sessionId: Schema.String },
  { dshxWireCode: 'thread-not-linked' },
) {
  override get message(): string {
    return `Thread ${this.sessionId} is not linked to backlog item b:${String(this.itemId)}.`
  }
}

export class ThreadAgentMismatch extends Schema.TaggedError<ThreadAgentMismatch>()(
  'ThreadAgentMismatch',
  { handle: Schema.String, sessionId: Schema.String },
  { dshxWireCode: 'thread-agent-mismatch' },
) {
  override get message(): string {
    return `Thread ${this.sessionId} was not started by @${this.handle} or is no longer linked to this item.`
  }
}

export class SessionsUnavailable extends Schema.TaggedError<SessionsUnavailable>()(
  'SessionsUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'sessions-unavailable' },
) {
  override get message(): string {
    return 'The Host session controller is unavailable, so no thread can be started.'
  }
}

export class ThreadContextNotDelivered extends Schema.TaggedError<ThreadContextNotDelivered>()(
  'ThreadContextNotDelivered',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-context-not-delivered' },
) {
  override get message(): string {
    return `Session ${this.sessionId} was created, but mandatory backlog context was not delivered. Open the thread and paste the items, or start it again.`
  }
}

export class TweetUrlNotInItem extends Schema.TaggedError<TweetUrlNotInItem>()('TweetUrlNotInItem', {}, { dshxWireCode: 'tweet-url-not-in-item' }) {
  override get message(): string {
    return 'That public X post URL is not in the backlog item.'
  }
}

export class TweetContextUnavailable extends Schema.TaggedError<TweetContextUnavailable>()(
  'TweetContextUnavailable',
  {},
  { dshxWireCode: 'tweet-context-unavailable' },
) {
  override get message(): string {
    return 'Tweet Context is not available in this DSH profile.'
  }
}

export class TweetContextFailed extends Schema.TaggedError<TweetContextFailed>()(
  'TweetContextFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'tweet-context-failed' },
) {
  override get message(): string {
    return 'The public tweet could not be retrieved.'
  }
}

export class TweetImageInvalid extends Schema.TaggedError<TweetImageInvalid>()(
  'TweetImageInvalid',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'tweet-image-invalid' },
) {
  override get message(): string {
    return 'The retrieved tweet image failed its byte-count check.'
  }
}

export class TweetDescriptionFull extends Schema.TaggedError<TweetDescriptionFull>()('TweetDescriptionFull', {}, { dshxWireCode: 'tweet-description-full' }) {
  override get message(): string {
    return 'The backlog description has no room for tweet context. Shorten it before retrying.'
  }
}
