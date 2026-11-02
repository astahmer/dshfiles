import { Schema } from 'effect'

/** A request without `sessionId` from a caller that is not an Agent session. */
export class ChecksTargetUnknown extends Schema.TaggedError<ChecksTargetUnknown>()(
  'ChecksTargetUnknown',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-target-unknown' },
) {
  override get message(): string {
    return 'Pass sessionId: this tool cannot tell which thread to check.'
  }
}

export class ActionNotConfigured extends Schema.TaggedError<ActionNotConfigured>()(
  'ActionNotConfigured',
  { actionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-action-not-configured' },
) {
  override get message(): string {
    return 'Project action is not configured.'
  }
}

export class ActionNotVisible extends Schema.TaggedError<ActionNotVisible>()(
  'ActionNotVisible',
  { actionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-action-not-visible' },
) {
  override get message(): string {
    return 'Project action is not available in this session directory.'
  }
}

export class DurableActionUnsupported extends Schema.TaggedError<DurableActionUnsupported>()(
  'DurableActionUnsupported',
  { actionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-durable-action-unsupported' },
) {
  override get message(): string {
    return 'Durable Project Checks currently supports configured local actions only.'
  }
}

const sessionPathReasons = {
  'no-directory': 'This session has no absolute project directory.',
  'root-not-canonical': 'Configured project root must be a canonical path.',
  'outside-root': 'This session is outside the action’s trusted project root.',
  unreadable: 'This session’s project directory could not be read.',
} as const

export class SessionPathUnavailable extends Schema.TaggedError<SessionPathUnavailable>()(
  'SessionPathUnavailable',
  { reason: Schema.Literals(['no-directory', 'root-not-canonical', 'outside-root', 'unreadable']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-session-path-unavailable' },
) {
  override get message(): string {
    return sessionPathReasons[this.reason]
  }
}

export class ProfileConfigUnavailable extends Schema.TaggedError<ProfileConfigUnavailable>()(
  'ProfileConfigUnavailable',
  { reason: Schema.Literals(['row-missing', 'invalid']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-config-unavailable' },
) {
  override get message(): string {
    return this.reason === 'row-missing' ? 'Project checks profile row is unavailable.' : 'Project checks profile configuration is invalid.'
  }
}

export class TaskNotFound extends Schema.TaggedError<TaskNotFound>()(
  'TaskNotFound',
  { taskId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-task-not-found' },
) {
  override get message(): string {
    return 'No durable task belongs to this session.'
  }
}

const idempotencyReasons = {
  'other-task': 'That idempotency key resolves to a different Project Checks task identity.',
  'other-action': 'That idempotency key is already bound to a different Project Checks action.',
  expired: 'That idempotency key was already used; its task history has expired.',
} as const

export class IdempotencyKeyConflict extends Schema.TaggedError<IdempotencyKeyConflict>()(
  'IdempotencyKeyConflict',
  { reason: Schema.Literals(['other-task', 'other-action', 'expired']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-idempotency-conflict' },
) {
  override get message(): string {
    return idempotencyReasons[this.reason]
  }
}

export class TaskHistoryFull extends Schema.TaggedError<TaskHistoryFull>()(
  'TaskHistoryFull',
  { limit: Schema.Int, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-task-history-full' },
) {
  override get message(): string {
    return 'Durable Project Checks task history is full; resolve pending/unknown work before dispatching more.'
  }
}

export class RetryNotConfirmed extends Schema.TaggedError<RetryNotConfirmed>()(
  'RetryNotConfirmed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-retry-unconfirmed' },
) {
  override get message(): string {
    return 'Confirm possible duplicate effects before retrying this task.'
  }
}

export class RetryNotAllowed extends Schema.TaggedError<RetryNotAllowed>()(
  'RetryNotAllowed',
  { status: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-retry-not-allowed' },
) {
  override get message(): string {
    return 'Only failed, cancelled, timed-out or unknown tasks can be retried.'
  }
}

export class HandlerUnavailable extends Schema.TaggedError<HandlerUnavailable>()(
  'HandlerUnavailable',
  { taskId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-handler-unavailable' },
) {
  override get message(): string {
    return 'The configured Project Checks handler changed or is unavailable.'
  }
}

export class TasksStopping extends Schema.TaggedError<TasksStopping>()(
  'TasksStopping',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-tasks-stopping' },
) {
  override get message(): string {
    return 'Durable Project Checks runner is stopping.'
  }
}

export class CallerRefused extends Schema.TaggedError<CallerRefused>()(
  'CallerRefused',
  { method: Schema.Literals(['assertVerifiedCompletion', 'verifyCandidate']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-caller-refused' },
) {
  override get message(): string {
    return 'Only jj-integration may verify a completion candidate.'
  }
}

/** The task database stayed locked past its write deadline, or a statement failed. */
export class TaskStoreUnavailable extends Schema.TaggedError<TaskStoreUnavailable>()(
  'TaskStoreUnavailable',
  { operation: Schema.String, busy: Schema.Boolean, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-store-unavailable' },
) {
  override get message(): string {
    return this.busy ? 'Project Checks task database remained busy past its write deadline.' : `Project Checks task database failed (${this.operation}).`
  }
}

export class ReceiptStoreUnavailable extends Schema.TaggedError<ReceiptStoreUnavailable>()(
  'ReceiptStoreUnavailable',
  { operation: Schema.Literals(['read', 'write']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-receipts-unavailable' },
) {
  override get message(): string {
    return `Project Checks receipts could not be ${this.operation === 'read' ? 'read' : 'saved'}.`
  }
}

export class SessionEventsUnavailable extends Schema.TaggedError<SessionEventsUnavailable>()(
  'SessionEventsUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'checks-session-events-unavailable' },
) {
  override get message(): string {
    return 'The session’s hook events could not be read.'
  }
}

/** A completion check refused to mark the turn complete; its message is what the turn reports. */
export class TurnVerificationBlocked extends Schema.TaggedError<TurnVerificationBlocked>()('TurnVerificationBlocked', {
  reason: Schema.Literals(['attempt-limit', 'checks-failed', 'revision-split']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason === 'attempt-limit') return 'Project verification attempt limit was exceeded.'
    if (this.reason === 'revision-split') return 'Project checks did not verify one exact working-copy revision; this turn cannot be marked complete.'
    return 'Configured project checks failed; this turn cannot be marked complete.'
  }
}

/** The process range of a stopped check could not be confirmed empty; its outcome stays unknown. */
export class ProcessGroupStillRunning extends Schema.TaggedError<ProcessGroupStillRunning>()('ProcessGroupStillRunning', {
  executable: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The ${this.executable} process group did not confirm its exit.`
  }
}

export class ExecutableUnresolved extends Schema.TaggedError<ExecutableUnresolved>()('ExecutableUnresolved', {
  command: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The ${this.command} executable could not be resolved.`
  }
}

const storeCorruptions = {
  'symlink-path': 'A Project Checks data path must not be a symlink.',
  'not-directory': 'Project Checks data path must be a directory.',
  'not-file': 'Project Checks database path must be a regular file.',
  'key-mismatch': 'Durable Project Checks task key does not match its record identity.',
  'receipt-identity': 'A durable task receipt is missing its task identity.',
  'receipt-mismatch': 'A durable attempt receipt does not match a persisted task attempt.',
  'receipt-conflict': 'A durable task attempt already has a different persisted receipt.',
} as const

/** Project Checks' own storage broke an invariant it relies on; the operation dies rather than guess. */
export class TaskStoreCorrupted extends Schema.TaggedError<TaskStoreCorrupted>()('TaskStoreCorrupted', {
  reason: Schema.Literals(['symlink-path', 'not-directory', 'not-file', 'key-mismatch', 'receipt-identity', 'receipt-mismatch', 'receipt-conflict']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return storeCorruptions[this.reason]
  }
}
