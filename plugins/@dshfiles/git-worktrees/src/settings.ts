import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const gitWorktreesSettings = defineSettings({
  namespace: 'dshfiles-git-worktrees',
  schema: Schema.object({
    isolate: Schema.boolean()
      .default(false)
      .description(
        'Start isolated threads in their own git worktree.',
      ),
    threadsDirectory: Schema.string()
      .default('')
      .description('Parent directory for thread worktrees. Empty uses `<repository>-threads` beside the repository.'),
  }),
})
