import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const worktreeMemorySettings = defineSettings({
  namespace: 'dshfiles-worktree-memory',
  schema: Schema.object({
    orphanAlertCpuPercent: Schema.natural()
      .default(50)
      .description('Warn in the status strip while orphaned scratch DSH Hosts use at least this much CPU, in percent of one core.'),
    orphanAlertMemoryMb: Schema.natural()
      .default(1024)
      .description('Warn in the status strip while orphaned scratch DSH Hosts hold at least this much resident memory, in MB.'),
  }),
  applies: 'live',
})
