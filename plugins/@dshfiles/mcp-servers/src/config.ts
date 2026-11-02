import { Effect, Schema } from 'effect'
import { preferencesSchema, storedServerSchema } from './api.js'
import { McpCommandLineModel } from './command-line.js'
import type { McpFilterIssue } from './schema.js'

export const MAX_SERVERS = 64

/**
 * Loader row: the registered servers and the manager preferences. dshx refuses a Host that owns both a native Config
 * and a Settings namespace, so the preferences live in this row and the manager page edits them.
 */
const configRowSchema = Schema.Struct({
  servers: Schema.Array(storedServerSchema)
    .check(Schema.isMaxLength(MAX_SERVERS))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  preferences: Schema.optional(preferencesSchema),
})

export const configSchema = configRowSchema.check(
  Schema.makeFilter((value: typeof configRowSchema.Type) => {
    const issues: McpFilterIssue[] = []
    value.servers.forEach((server, index) => {
      if (server.transport === 'stdio' && McpCommandLineModel.hasInlineCredential([server.command, ...server.args])) {
        issues.push({ path: ['servers', index], issue: 'Use credential references instead of inline command credentials.' })
      }
      if (
        server.transport === 'streamable-http' &&
        server.startCommand !== undefined &&
        McpCommandLineModel.hasInlineCredential([server.startCommand.command, ...server.startCommand.args])
      ) {
        issues.push({ path: ['servers', index, 'startCommand'], issue: 'Use credential references instead of inline command credentials.' })
      }
    })
    return issues
  }),
)

export type ManagerConfig = typeof configSchema.Type
