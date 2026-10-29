import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { pressureSnapshotSchema, memorySnapshotSchema, stopResultSchema, stopTargetSchema } from './types.js'

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const worktreeMemoryApi = defineApi({
  id: 'worktree-memory',
  version: 1,
  owner: '@dshfiles/worktree-memory',
  methods: {
    snapshot: method({
      input: z.object({}).strict(),
      output: memorySnapshotSchema,
      description:
        'Resident memory of DSH process trees grouped by workspace, plus a deterministic, argv-redacted summary of this user’s Node processes grouped by script label, nearest app or parent, and working directory. Node memory is resident RSS. Includes the memory-pressure level. Read-only.',
      tool: { name: 'worktree_memory_snapshot', readOnly: true, render: compactJson },
    }),
    pressure: method({
      input: z.object({}).strict(),
      output: pressureSnapshotSchema,
      description: 'The system memory-pressure level alone, read without probing process trees, plus total system memory. Read-only.',
      tool: { name: 'worktree_memory_pressure', readOnly: true, render: compactJson },
    }),
    stop: method({
      input: z
        .object({
          targets: z.array(stopTargetSchema).min(1).max(200).describe('Process trees from the snapshot, identified by root pid and startedAt.'),
          confirm: z.literal(true).describe('Must be true: stopping a process tree is destructive.'),
        })
        .strict(),
      output: stopResultSchema,
      description:
        'Stop process trees from the snapshot on the user’s behalf: a live job through the job registry, any other tree with SIGTERM then SIGKILL. Only trees the snapshot lists can be stopped, and a recycled pid is refused. Call only when the user asked to stop them; pass confirm: true, which is required.',
      tool: { name: 'worktree_memory_stop', readOnly: false, render: compactJson },
    }),
  },
})
