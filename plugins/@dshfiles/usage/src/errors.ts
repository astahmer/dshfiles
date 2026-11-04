import { Schema } from 'effect'

/** A read or write of the local usage database failed; the wire code is the one the store failure always had. */
export class UsageStoreFailed extends Schema.TaggedError<UsageStoreFailed>()(
  'UsageStoreFailed',
  { operation: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'usage-store-failure' },
) {
  override get message(): string {
    return 'The local usage store could not complete this request.'
  }
}

/** One step of an index pass failed; the pass records it as the index's last error and the next pass retries. */
export class IndexPassFailed extends Schema.TaggedError<IndexPassFailed>()(
  'IndexPassFailed',
  {
    step: Schema.Literals(['prune', 'tool-sources', 'session-logs', 'reconcile', 'pricing']),
    reason: Schema.String.check(Schema.isMaxLength(400)),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'usage-store-failure' },
) {
  override get message(): string {
    return `Usage indexing failed at ${this.step}: ${this.reason}`
  }
}

/** A plugin tried to record Jev usage for a source it is not. */
export class JevCallerRejected extends Schema.TaggedError<JevCallerRejected>()('JevCallerRejected', { source: Schema.String }, { dshxWireCode: 'jev-caller' }) {
  override get message(): string {
    return 'Only the Jev source plugin may record its own usage.'
  }
}
