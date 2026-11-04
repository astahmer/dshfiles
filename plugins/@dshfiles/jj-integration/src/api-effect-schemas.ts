import { Schema } from 'effect'

/**
 * Effect Schema contracts for the jj-integration API. `strictStandardSchema` in `api.ts` publishes closed objects
 * and excess-property rejection.
 */

const countSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const boundedString = (maxLength: number) => Schema.String.check(Schema.isMaxLength(maxLength))
const nonEmptyString = Schema.String.check(Schema.isMinLength(1))
const nonEmptyBoundedString = (maxLength: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maxLength))

export const threadWorkspaceNameEffect = Schema.String.check(Schema.isPattern(/^thread-[0-9a-f]{6}$/u))

export const integrationProgressSchema = Schema.Struct({
  phase: Schema.Literals(['queued', 'validating', 'rebasing']),
  updatedAt: countSchema,
})

export const destinationSchema = Schema.Struct({
  vcs: Schema.Literals(['jj', 'git', 'none']),
  isolated: Schema.Boolean,
  projectWorkspaceId: Schema.NullOr(Schema.String),
  bookmark: Schema.NullOr(Schema.String),
  bookmarks: Schema.Array(Schema.String),
  isolateByDefault: Schema.Boolean,
  ownedByAnotherSession: Schema.optionalKey(Schema.Boolean),
})

export const isolatedWorkspaceSchema = Schema.Struct({
  name: nonEmptyString,
  path: nonEmptyString,
  created: Schema.Boolean,
})

export const cleanupKindSchema = Schema.Literals(['empty', 'integrated', 'secondary', 'untracked'])

export const cleanupTargetSchema = Schema.Struct({
  repoRoot: nonEmptyString,
  name: nonEmptyString,
  kind: cleanupKindSchema,
})

export const workspaceSyncSchema = Schema.Struct({
  state: Schema.Literals(['running', 'done', 'failed']),
  workspace: Schema.String,
  bookmark: Schema.String,
  status: Schema.NullOr(Schema.Literals(['up-to-date', 'synced', 'would-sync', 'refused', 'conflicted', 'build-failed'])),
  pluginsRebuilt: Schema.Array(Schema.String),
  hotPlugins: Schema.Array(Schema.String),
  restartNeeded: Schema.Boolean,
  conflicts: Schema.Array(Schema.String),
  message: Schema.NullOr(Schema.String),
  finishedAt: Schema.NullOr(Schema.String),
})

export const registeredProjectSchema = Schema.Struct({ workspaceId: Schema.String, title: Schema.String, path: Schema.String })

export const projectsOutputSchema = Schema.Struct({
  projects: Schema.Array(registeredProjectSchema),
  workspaces: Schema.optionalKey(Schema.Array(registeredProjectSchema)),
})

export const reviewHistoryOutputSchema = Schema.Struct({
  repoRoot: nonEmptyString,
  name: threadWorkspaceNameEffect,
  integrations: Schema.Array(
    Schema.Struct({
      at: countSchema,
      tipChangeId: Schema.optionalKey(nonEmptyBoundedString(128)),
      baseChangeId: Schema.optionalKey(nonEmptyBoundedString(128)),
      sessionId: Schema.optionalKey(nonEmptyBoundedString(128)),
    }),
  ),
})

export const provisionInputSchema = Schema.Struct({
  workspaceId: nonEmptyString,
  isolate: Schema.optionalKey(Schema.Boolean),
  base: Schema.optionalKey(nonEmptyBoundedString(256)),
  name: Schema.optionalKey(threadWorkspaceNameEffect),
})

export const provisionOutputSchema = Schema.Struct({
  workspaceId: Schema.String,
  isolated: Schema.Boolean,
  destination: Schema.optionalKey(destinationSchema),
})

export const classifyWorkspacesInputSchema = Schema.Struct({
  workspaceIds: Schema.Array(nonEmptyBoundedString(256)).check(Schema.isMaxLength(256)),
})

export const classifyWorkspacesOutputSchema = Schema.Struct({
  jjWorkspaceIds: Schema.Array(nonEmptyBoundedString(256)).check(Schema.isMaxLength(256)),
})

export const ownWorkspaceForInputSchema = Schema.Struct({ workspaceId: nonEmptyString })

export const ownWorkspaceForOutputSchema = Schema.Struct({ workspaceId: Schema.String, branched: Schema.Boolean })

export const destinationInputSchema = Schema.Struct({
  workspaceId: nonEmptyString,
  sessionId: Schema.optionalKey(nonEmptyString),
})

export const pathInputSchema = Schema.Struct({ path: nonEmptyString })

export const queueLandInputSchema = Schema.Struct({ path: nonEmptyString, sessionId: Schema.optionalKey(Schema.String) })

export const revisionGraphOutputSchema = Schema.Struct({ graph: boundedString(16_000) })

export const cancelQueuedLandOutputSchema = Schema.Struct({ status: Schema.Literals(['cancelled', 'not-queued', 'integrating']) })

export const integrationProgressOutputSchema = Schema.Struct({ progress: Schema.NullOr(integrationProgressSchema) })

export const startedOutputSchema = Schema.Struct({ started: Schema.Boolean })

export const queuedAtOutputSchema = Schema.Struct({ queuedAt: countSchema })

export const noFolderOutputSchema = Schema.Struct({ workspaceId: Schema.String })

export const workspaceSyncOutputSchema = Schema.Struct({ sync: Schema.NullOr(workspaceSyncSchema) })

export const emptyInputSchema = Schema.Struct({})
