import { Schema } from 'effect'

export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()('SessionNotFound', { key: Schema.String }, { dshxWireCode: 'session-not-found' }) {
  override get message(): string {
    return `No agent session ${this.key} is indexed on this Host. List sessions again, or press Refresh if the log was written just now.`
  }
}

export class SessionUnreadable extends Schema.TaggedError<SessionUnreadable>()(
  'SessionUnreadable',
  { key: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'session-unreadable' },
) {
  override get message(): string {
    return `The log of ${this.key} could not be read. Check that the file still exists and is readable by the DSH Host, then press Refresh.`
  }
}
