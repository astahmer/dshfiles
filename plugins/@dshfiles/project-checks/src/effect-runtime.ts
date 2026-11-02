import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Context, Schema } from 'effect'

export class ProjectChecksRuntime extends Context.Service<ProjectChecksRuntime, { readonly context: CordisContext }>()('@dshfiles/project-checks/Runtime') {}

export class ProjectChecksOperationError extends Schema.TaggedError<ProjectChecksOperationError>()('ProjectChecksOperationError', {
  operation: Schema.Literals([
    'actions',
    'receipts',
    'hook-events',
    'run',
    'dispatch',
    'tasks',
    'cancel-task',
    'retry-task',
    'assert-verified-completion',
    'verify-candidate',
    'setup',
  ]),
}) {}

export type ProjectChecksOperation = ProjectChecksOperationError['operation']
