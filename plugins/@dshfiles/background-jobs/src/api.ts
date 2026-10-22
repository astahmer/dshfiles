import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { jobBoardFilterSchema, jobBoardSchema, jobIndexingSchema, jobKillSchema, jobOutputSchema, jobWaitInputSchema, jobWaitSchema } from './types.js'

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

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
      tool: { name: 'background_jobs_board', readOnly: true, render: compactJson },
    }),
    output: method({
      input: z
        .object({
          jobId: z.string().min(1).max(128).describe('Job id from a board row.'),
          from: z.number().int().nonnegative().optional().describe('Absolute byte offset to resume from; omit for the retained head.'),
        })
        .strict(),
      output: jobOutputSchema,
      description:
        'Read one job’s retained output without consuming the model cursor. Only jobs of the current DSH process keep an output ring; an earlier process leaves the lifecycle record alone. Read-only.',
      tool: { name: 'background_jobs_output', readOnly: true, render: compactJson },
    }),
    kill: method({
      input: z
        .object({
          jobId: z.string().min(1).max(128).describe('Job id of a running job.'),
          confirm: z.literal(true).describe('Must be true: stopping another Session’s background job is destructive.'),
        })
        .strict(),
      output: jobKillSchema,
      description:
        'Stop one running background job on the user’s behalf, identified by job id. Call only when the user asked to stop that job; pass confirm: true, which is required.',
      tool: {
        name: 'background_jobs_kill',
        readOnly: false,
        render: compactJson,
      },
    }),
    refresh: method({
      input: z.object({}).strict(),
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
})
