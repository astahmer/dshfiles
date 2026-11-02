import { Effect, Schema } from 'effect'
import type { JobsBoard } from './service.js'

export class JobNotFound extends Schema.TaggedError<JobNotFound>()('JobNotFound', {
  message: Schema.String,
}) {}

export class JobKillFailed extends Schema.TaggedError<JobKillFailed>()('JobKillFailed', {
  jobId: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const killJob = Effect.fn('background-jobs kill')(function* (options: { readonly board: JobsBoard; readonly jobId: string }) {
  const killed = yield* Effect.try({
    try: () => options.board.kill({ jobId: options.jobId }),
    catch: cause => new JobKillFailed({ jobId: options.jobId, message: 'The job could not be stopped.', cause }),
  })
  if (killed === null) return yield* new JobNotFound({ message: 'No such job is retained on this Host.' })
  return killed
})
