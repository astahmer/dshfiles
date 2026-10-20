import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/** Kept apart from the memory API so another plugin's Host can call it without compiling memory's sources. */
export const workspaceScriptsApi = defineApi({
  id: 'workspace-scripts',
  version: 1,
  owner: '@dshfiles/memory',
  methods: {
    scripts: method({
      input: z.object({ cwd: z.string().min(1).max(4_096) }).strict(),
      output: z.object({ project: z.string(), setup: z.string(), cleanup: z.string() }).nullable(),
      description:
        "The project's thread-workspace setup and cleanup scripts, written once from its lockfile; null for a project without one. Each takes the workspace path.",
    }),
  },
})
