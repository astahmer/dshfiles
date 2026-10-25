import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { durableTaskSchema } from './durable-tasks.js'

export const durableTaskDomain = defineDomain({
  name: 'project_check_tasks',
  version: 1,
  tables: {
    tasks: { valueSchema: durableTaskSchema, __key: 'tasks' },
  },
})
