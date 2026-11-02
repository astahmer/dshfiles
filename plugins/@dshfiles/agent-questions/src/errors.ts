import { Schema } from 'effect'

/** What a refusal is about: a child's parent question, or a child's Markdown feedback. */
const Subject = Schema.Literals(['question', 'feedback'])
type Subject = typeof Subject.Type

const subjectNoun = (subject: Subject): string => (subject === 'question' ? 'Parent question' : 'Parent feedback')

const LiveAgentOperation = Schema.Literals([
  'question-operation',
  'question-list',
  'question-answer',
  'feedback-operation',
  'feedback-read',
  'feedback-resolution',
])

const liveAgentMessages = {
  'question-operation': 'Question operation requires the exact live Agent.',
  'question-list': 'Question list requires the exact live parent Agent.',
  'question-answer': 'Question answer requires the exact live parent Agent.',
  'feedback-operation': 'Feedback operation requires the exact live Agent.',
  'feedback-read': 'Feedback read requires the exact live child Agent.',
  'feedback-resolution': 'Feedback resolution requires the exact live parent Agent.',
} as const satisfies Record<typeof LiveAgentOperation.Type, string>

export class AgentNotLive extends Schema.TaggedError<AgentNotLive>()(
  'AgentNotLive',
  { operation: LiveAgentOperation, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'agent-not-live' },
) {
  override get message(): string {
    return liveAgentMessages[this.operation]
  }
}

/** The calling Agent is not a live direct subagent, so it has no parent to ask. */
export class NotDirectSubagent extends Schema.TaggedError<NotDirectSubagent>()(
  'NotDirectSubagent',
  { subject: Subject, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-direct-subagent' },
) {
  override get message(): string {
    return this.subject === 'question'
      ? 'A question can only be requested by a live direct subagent.'
      : 'Feedback can only be submitted by a live direct subagent.'
  }
}

export class RequestNotFound extends Schema.TaggedError<RequestNotFound>()(
  'RequestNotFound',
  { subject: Subject, id: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-found' },
) {
  override get message(): string {
    return `${subjectNoun(this.subject)} was not found.`
  }
}

export class RequestForbidden extends Schema.TaggedError<RequestForbidden>()(
  'RequestForbidden',
  { subject: Subject, allowed: Schema.Literals(['requesting-child', 'direct-parent']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'forbidden' },
) {
  override get message(): string {
    if (this.allowed === 'direct-parent') return 'Only the direct parent can answer this question.'
    return `Only the requesting direct child can read or cancel this ${this.subject}.`
  }
}

export class RequestLimitReached extends Schema.TaggedError<RequestLimitReached>()(
  'RequestLimitReached',
  { subject: Subject, scope: Schema.Literals(['parent', 'retained']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'limit-reached' },
) {
  override get message(): string {
    if (this.scope === 'parent') return `The parent has reached its pending ${this.subject} limit.`
    return this.subject === 'question' ? 'The retained parent question limit has been reached.' : 'The retained feedback limit has been reached.'
  }
}

export class OperationIdReused extends Schema.TaggedError<OperationIdReused>()(
  'OperationIdReused',
  { subject: Subject, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'operation-id-reused' },
) {
  override get message(): string {
    return `${this.subject === 'question' ? 'Question' : 'Feedback'} operation id was reused with different input.`
  }
}

export class RequestInputInvalid extends Schema.TaggedError<RequestInputInvalid>()(
  'RequestInputInvalid',
  { subject: Subject, issue: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-input' },
) {
  override get message(): string {
    return `Invalid ${this.subject} input: ${this.issue}`
  }
}

export class AnswerConflict extends Schema.TaggedError<AnswerConflict>()(
  'AnswerConflict',
  { questionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'answer-conflict' },
) {
  override get message(): string {
    return 'Parent question already has a different answer.'
  }
}

export class QuestionNotPending extends Schema.TaggedError<QuestionNotPending>()(
  'QuestionNotPending',
  { questionId: Schema.String, status: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'question-not-pending' },
) {
  override get message(): string {
    return `Parent question is ${this.status}.`
  }
}

export class QuestionNotDeferred extends Schema.TaggedError<QuestionNotDeferred>()(
  'QuestionNotDeferred',
  { questionId: Schema.String, status: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'question-not-deferred' },
) {
  override get message(): string {
    return `Parent question is ${this.status}; only deferred questions can attach a file.`
  }
}

export class DeferredFileConflict extends Schema.TaggedError<DeferredFileConflict>()(
  'DeferredFileConflict',
  { questionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'deferred-file-conflict' },
) {
  override get message(): string {
    return 'Deferred question already has a different file path.'
  }
}

export class FeedbackParentChanged extends Schema.TaggedError<FeedbackParentChanged>()(
  'FeedbackParentChanged',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'feedback-parent-changed' },
) {
  override get message(): string {
    return 'Feedback parent changed before submission.'
  }
}

export class MarkdownChanged extends Schema.TaggedError<MarkdownChanged>()(
  'MarkdownChanged',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'markdown-changed' },
) {
  override get message(): string {
    return 'Markdown changed before feedback could be sent. Capture a new anchor and retry.'
  }
}

/** The parent (or, for a resolution, the child's parent) is not a live Agent the Host can wake. */
export class ParentUnavailable extends Schema.TaggedError<ParentUnavailable>()(
  'ParentUnavailable',
  { subject: Schema.Literals(['question', 'feedback', 'resolution']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'parent-unavailable' },
) {
  override get message(): string {
    if (this.subject === 'resolution') return 'The direct parent is unavailable; the resolution remains in durable storage.'
    return `The direct parent is unavailable; ${this.subject === 'question' ? 'the question was' : 'feedback was'} not delivered.`
  }
}

/** The subagent message carrying a notice was refused by the Host. */
export class NotificationFailed extends Schema.TaggedError<NotificationFailed>()(
  'NotificationFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'notification-failed' },
) {
  override get message(): string {
    return 'The Host could not deliver the notice to the other Agent.'
  }
}

export type DeliveryError = ParentUnavailable | NotificationFailed

/** A tool needs an Agent of a given role and the call carries none. */
export class AgentRequired extends Schema.TaggedError<AgentRequired>()(
  'AgentRequired',
  { tool: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'agent-required' },
) {
  override get message(): string {
    return `${this.tool} must be called by an active Agent.`
  }
}

export class RootAgentRequired extends Schema.TaggedError<RootAgentRequired>()(
  'RootAgentRequired',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'root-agent-required' },
) {
  override get message(): string {
    return 'Only an active root Agent may submit cross-thread native question answers.'
  }
}

export class WorkspacePathMissing extends Schema.TaggedError<WorkspacePathMissing>()(
  'WorkspacePathMissing',
  { purpose: Schema.Literals(['defer-question', 'markdown-feedback']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'workspace-path-missing' },
) {
  override get message(): string {
    return this.purpose === 'defer-question'
      ? 'Cannot defer a parent question without a child workspace path.'
      : 'Markdown feedback requires a child workspace path.'
  }
}

export class DeferredQuestionChanged extends Schema.TaggedError<DeferredQuestionChanged>()(
  'DeferredQuestionChanged',
  { questionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'deferred-question-changed' },
) {
  override get message(): string {
    return `Deferred parent question ${this.questionId} changed before its file path was recorded.`
  }
}

export class ResolutionReceiptMissing extends Schema.TaggedError<ResolutionReceiptMissing>()(
  'ResolutionReceiptMissing',
  { feedbackId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'resolution-receipt-missing' },
) {
  override get message(): string {
    return `Feedback ${this.feedbackId} has no resolution receipt.`
  }
}
