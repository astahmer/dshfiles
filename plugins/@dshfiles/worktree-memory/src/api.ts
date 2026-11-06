import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { pressureSnapshotSchema, memorySnapshotSchema, scratchHostsSchema, stopOrphansResultSchema, stopResultSchema, stopTargetSchema } from './types.js'

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const worktreeMemoryApi = defineApi({
  id: 'worktree-memory',
  version: 1,
  owner: '@dshfiles/worktree-memory',
  methods: {
    snapshot: method({
      input: Schema.Struct({}),
      output: memorySnapshotSchema,
      description:
        'Resident memory of DSH process trees grouped by workspace, plus a deterministic, argv-redacted summary of this user’s Node processes grouped by script label, nearest app or parent, and working directory. Node memory is resident RSS. Includes the memory-pressure level. Read-only.',
      tool: { name: 'worktree_memory_snapshot', readOnly: true, render: compactJson },
    }),
    pressure: method({
      input: Schema.Struct({}),
      output: pressureSnapshotSchema,
      description: 'The system memory-pressure level alone, read without probing process trees, plus total system memory. Read-only.',
      tool: { name: 'worktree_memory_pressure', readOnly: true, render: compactJson },
    }),
    stop: method({
      input: Schema.Struct({
        targets: Schema.Array(stopTargetSchema)
          .check(Schema.isMinLength(1), Schema.isMaxLength(200))
          .annotate({ description: 'Process trees from the snapshot, identified by root pid and startedAt.' }),
        confirm: Schema.Literal(true).annotate({ description: 'Must be true: stopping a process tree is destructive.' }),
      }),
      output: stopResultSchema,
      description:
        'Stop process trees from the snapshot on the user’s behalf: a live job through the job registry, any other tree with SIGTERM then SIGKILL. Only trees the snapshot lists can be stopped, and a recycled pid is refused. Call only when the user asked to stop them; pass confirm: true, which is required.',
      tool: { name: 'worktree_memory_stop', readOnly: false, render: compactJson },
    }),
    scratchHosts: method({
      input: Schema.Struct({}),
      output: scratchHostsSchema,
      description:
        'Scratch DSH Hosts (`--profile dshx-boot`) of this user, labelled by the owner their dshx record names, with orphan flags, CPU and resident memory, plus the status-strip alert thresholds. Read-only.',
    }),
    stopOrphans: method({
      input: Schema.Struct({
        confirm: Schema.Literal(true).annotate({ description: 'Must be true: stopping orphaned scratch Hosts ends their process groups.' }),
      }),
      output: stopOrphansResultSchema,
      description:
        'Stop every orphaned scratch DSH Host (owner gone, or a pre-record Host init adopted more than 2 h ago): SIGTERM on its process group, SIGKILL after 3 s. Each one is re-checked first: it must still run `--profile dshx-boot` with the same start time, and the serving Host and its ancestors are never signalled. Call only when the user asked to stop orphans; pass confirm: true, which is required.',
      tool: { name: 'worktree_memory_stop_orphans', readOnly: false, render: compactJson },
    }),
  },
})
