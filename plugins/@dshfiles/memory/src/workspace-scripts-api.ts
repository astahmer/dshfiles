import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { MemoryContract } from './schema.ts'

/** Kept apart from the memory API so another plugin's Host can call it without compiling memory's sources. */
export const workspaceScriptsApi = defineApi({
  id: 'workspace-scripts',
  version: 1,
  owner: '@dshfiles/memory',
  methods: {
    scripts: MemoryContract.method({
      input: Schema.Struct({ cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096)) }),
      output: Schema.NullOr(Schema.Struct({ project: Schema.String, setup: Schema.String, cleanup: Schema.String })),
      description:
        "The project's thread-workspace setup and cleanup scripts, written once from its lockfile; null for a project without one. Each takes the workspace path.",
    }),
  },
})
