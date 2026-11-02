import { Schema } from 'effect'

/** The store could not be opened at activation; every memory call reports why until the next restart. */
export class MemoryInactive extends Schema.TaggedError<MemoryInactive>()(
  'MemoryInactive',
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'memory-inactive' },
) {
  override get message(): string {
    return `Memory failed to start: ${this.reason}. Fix the cause in the Host log, then restart DSH.`
  }
}

/** A statement on memory's own SQLite file failed. */
export class MemoryStoreFailed extends Schema.TaggedError<MemoryStoreFailed>()(
  'MemoryStoreFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'memory-store-failed' },
) {
  override get message(): string {
    return 'The memory store could not complete the request; retry, and check the Host log if it keeps failing.'
  }
}

/** Two rekey mappings name the same source path with different targets; the caller built an inconsistent plan. */
export class ProjectRekeyAmbiguous extends Schema.TaggedError<ProjectRekeyAmbiguous>()('ProjectRekeyAmbiguous', {
  from: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'A project path cannot be rekeyed to multiple targets.'
  }
}

export class InvalidDateFilter extends Schema.TaggedError<InvalidDateFilter>()(
  'InvalidDateFilter',
  { value: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-date-filter' },
) {
  override get message(): string {
    return `${JSON.stringify(this.value)} is not a date: use YYYY-MM-DD or an ISO 8601 timestamp.`
  }
}

export class NoteNoLongerValid extends Schema.TaggedError<NoteNoLongerValid>()(
  'NoteNoLongerValid',
  { id: Schema.Number, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'note-no-longer-valid' },
) {
  override get message(): string {
    return `Note n:${this.id} is no longer valid; refresh the list.`
  }
}

/** DSH could not read a Session log memory asked for. */
export class SessionLogUnavailable extends Schema.TaggedError<SessionLogUnavailable>()(
  'SessionLogUnavailable',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'session-log-unavailable' },
) {
  override get message(): string {
    return `The log of ${this.sessionId} could not be read; check that the thread still exists, then retry.`
  }
}

export class JevDisabled extends Schema.TaggedError<JevDisabled>()(
  'JevDisabled',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'jev-disabled' },
) {
  override get message(): string {
    return 'Enable Jev in Memory settings before requesting a relevance review.'
  }
}

export class JevUnavailable extends Schema.TaggedError<JevUnavailable>()(
  'JevUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'jev-unavailable' },
) {
  override get message(): string {
    return 'Configure a Jev credential before requesting a relevance review.'
  }
}

export class CrossProjectDisabled extends Schema.TaggedError<CrossProjectDisabled>()(
  'CrossProjectDisabled',
  { project: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'cross-project-disabled' },
) {
  override get message(): string {
    return 'Cross-project memory is disabled for this Agent.'
  }
}

export class FinderInvalidRequest extends Schema.TaggedError<FinderInvalidRequest>()(
  'FinderInvalidRequest',
  { reason: Schema.Literals(['empty-query', 'foreign-cursor']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-request' },
) {
  override get message(): string {
    return this.reason === 'empty-query' ? 'A finder query needs at least one character.' : 'The cursor is not one this finder issued; start the search again.'
  }
}

export class FinderStaleCursor extends Schema.TaggedError<FinderStaleCursor>()(
  'FinderStaleCursor',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'stale-cursor' },
) {
  override get message(): string {
    return 'The session corpus changed since that cursor was issued; start the search again to page over current results.'
  }
}

export class FinderSessionNotFound extends Schema.TaggedError<FinderSessionNotFound>()(
  'FinderSessionNotFound',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-found' },
) {
  override get message(): string {
    return `No Session ${JSON.stringify(this.sessionId)} is visible in this scope.`
  }
}

export class FinderSearchUnavailable extends Schema.TaggedError<FinderSearchUnavailable>()(
  'FinderSearchUnavailable',
  { code: Schema.String, attempts: Schema.Number, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'search-unavailable' },
) {
  override get message(): string {
    return `Session content search is unavailable (${this.code} after ${this.attempts} attempt(s)) and no session matched by title, workspace, or memory. Retry shortly or narrow the query.`
  }
}

export type FinderError = FinderInvalidRequest | FinderStaleCursor | FinderSessionNotFound | FinderSearchUnavailable
