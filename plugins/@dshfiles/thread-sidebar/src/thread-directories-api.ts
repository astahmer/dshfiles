import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

const threadDirectorySchema = Schema.Struct({
  threadsDirectory: Schema.String.check(Schema.isMinLength(1)),
  repoRoot: Schema.String.check(Schema.isMinLength(1)),
})

/** Where the VCS providers put each project's thread workspaces, so the browser groups them without guessing paths. */
export const threadSidebarThreadDirectoriesApi = defineApi({
  id: 'thread-sidebar-thread-directories',
  owner: '@dshfiles/thread-sidebar',
  version: 1,
  methods: {
    list: method({
      input: Schema.Struct({ projectPaths: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(1000)) }),
      output: Schema.Struct({ directories: Schema.Array(threadDirectorySchema).check(Schema.isMaxLength(1000)) }),
    }),
  },
})
