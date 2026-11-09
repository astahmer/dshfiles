import { Schema } from 'effect'
import { defineApi, event, method } from '@dshfiles/dshx/api'
import { renderBoard } from './board-render.js'
import { jobBoardFilterSchema, jobBoardSchema, jobIndexingSchema, jobKillSchema, jobOutputSchema, jobWaitInputSchema, jobWaitSchema } from './types.js'

const compactJson = <Output>(output: Output): string => JSON.stringify(output)
const jobIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const outputInputSchema = Schema.Struct({
  jobId: jobIdSchema.annotate({ description: 'Job id from a board row.' }),
  from: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)).annotate({
      description: 'Absolute byte offset to resume from; omit for the retained head.',
    }),
  ),
})
const killInputSchema = Schema.Struct({
  jobId: jobIdSchema.annotate({ description: 'Job id of a running job.' }),
  confirm: Schema.Literal(true).annotate({ description: 'Must be true: stopping another Session’s background job is destructive.' }),
})
const emptyInputSchema = Schema.Struct({})

export const backgroundJobsApi = defineApi({
  id: 'background-jobs',
  version: 1,
  owner: '@dshfiles/background-jobs',
  methods: {
    board: method({
      input: jobBoardFilterSchema,
      output: jobBoardSchema,
      description:
        'List background jobs across every Session on this Host: what is still running and, opt-in, what already finished. Rows carry a category derived from the job kind and label. Read-only.',
      tool: { name: 'background_jobs_board', readOnly: true, render: renderBoard },
    }),
    output: method({
      input: outputInputSchema,
      output: jobOutputSchema,
      description:
        'Read one job’s retained output without consuming the model cursor. Only jobs of the current DSH process keep an output ring; an earlier process leaves the lifecycle record alone. Read-only.',
      tool: { name: 'background_jobs_output', readOnly: true, render: compactJson },
    }),
    kill: method({
      input: killInputSchema,
      output: jobKillSchema,
      description:
        'Stop one running background job on the user’s behalf, identified by job id. Call only when the user asked to stop that job; pass confirm: true, which is required.',
      tool: { name: 'background_jobs_kill', readOnly: false, render: compactJson },
    }),
    refresh: method({
      input: emptyInputSchema,
      output: jobIndexingSchema,
      description: 'Index whatever the session logs gained since the last pass and report the indexing state. Call only when the user asked to re-index.',
      tool: { name: 'background_jobs_refresh', readOnly: false, render: compactJson },
    }),
    wait: method({
      input: jobWaitInputSchema,
      output: jobWaitSchema,
      description:
        'Block until background jobs settle instead of polling job_output or sleeping. Waits for the given jobIds, or for every job running when the call starts when jobIds is omitted. Returns the final status of each target and which are still running on timeout. Read-only.',
      tool: { name: 'background_jobs_wait', readOnly: true, render: compactJson },
    }),
  },
  events: {
    changed: event({
      schema: emptyInputSchema,
      description: 'The board changed: a job started, finished or wrote output, or history indexing found more. Read the board again.',
    }),
  },
})
