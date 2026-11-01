import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { durableTaskSchema } from './durable-tasks.js'

/** `defineDomain` still types its record validator as `z.ZodType`; the Effect schema stays the source of truth. */
export const durableTaskDomain = defineDomain({
  name: 'project_check_tasks',
  version: 1,
  tables: {
    tasks: { valueSchema: zodSchemaFromEffect(durableTaskSchema), __key: 'tasks' },
  },
})
