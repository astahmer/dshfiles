import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const gitWorktreesSettings = defineSettings({
  namespace: 'dshfiles-git-worktrees',
  schema: Schema.object({
    isolate: Schema.boolean()
      .default(false)
      .description(
        'Start an isolated thread (a backlog item, a caller asking for isolation) in its own git worktree. Off keeps every thread in the project checkout.',
      ),
    threadsDirectory: Schema.string()
      .default('')
      .description('Parent directory for thread worktrees. Empty uses `<repository>-threads` beside the repository.'),
  }),
})
