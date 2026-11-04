import { Schema } from 'effect'

export class JobNotFound extends Schema.TaggedError<JobNotFound>()('JobNotFound', { jobId: Schema.String }, { dshxWireCode: 'job-not-found' }) {
  override get message(): string {
    return 'No such job is retained on this Host.'
  }
}

export class JobKillFailed extends Schema.TaggedError<JobKillFailed>()(
  'JobKillFailed',
  { jobId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'job-kill-failed' },
) {
  override get message(): string {
    return 'The job could not be stopped.'
  }
}

export class HistoryPersistFailed extends Schema.TaggedError<HistoryPersistFailed>()('HistoryPersistFailed', {
  path: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Could not save the job history index to ${this.path}.`
  }
}
