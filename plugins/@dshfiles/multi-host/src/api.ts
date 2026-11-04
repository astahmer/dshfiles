import type { FileUploadValue } from '@deepseek-ai/dsh-client-file-upload/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { defineApi, method as defineMethod, zodSchemaFromEffect } from '@dshfiles/dshx/api'
import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import { nativeRpcRequestSchema } from '@dshfiles/dshx/platform/native-rpc'
import type { NativeRpcRequest as DshxNativeRpcRequest } from '@dshfiles/dshx/platform/native-rpc'
import { hostConnectorSchema, runtimeIdentitySchema, runtimeLocatorSchema } from './records.js'
import { SchemaFields } from './schema.js'

const method = <const Input extends Schema.ConstraintDecoder<unknown>, const Output extends Schema.ConstraintDecoder<unknown>>(
  options: Omit<ApiMethodOptions<Input, Output>, 'tool'> & {
    readonly input: Input
    readonly output: Output
    readonly tool?: ApiToolExposure<Output['Type']>
  },
) => defineMethod(options)

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

const idSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const brandedSessionIdSchema = Schema.declare<SessionId>((value): value is SessionId => typeof value === 'string' && value.length > 0 && value.length <= 256)

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type LocalProjectFileCandidate = {
  readonly path: string
  readonly bytes: number
  readonly ignored: boolean
  readonly copyable: boolean
  readonly copyReason?: 'potential-secret' | 'too-large' | undefined
}

export const jsonValueSchema: Schema.ConstraintDecoder<JsonValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.String,
    Schema.Number.check(Schema.isFinite()),
    Schema.Boolean,
    Schema.Null,
    Schema.Array(jsonValueSchema),
    Schema.Record(Schema.String, jsonValueSchema),
  ]),
)

const hostSummarySchema = Schema.Struct({
  id: idSchema,
  name: Schema.String,
  connector: hostConnectorSchema,
  runtimeCount: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  hidden: Schema.Boolean,
})

const failureSchema = Schema.Struct({ code: Schema.String.check(Schema.isMaxLength(128)), message: Schema.String.check(Schema.isMaxLength(2048)) })

const runtimeSummarySchema = Schema.Struct({
  id: idSchema,
  hostId: idSchema,
  name: Schema.String,
  identity: Schema.NullOr(runtimeIdentitySchema),
  remoteHome: Schema.optional(Schema.String),
  lastSeenAt: Schema.optional(SchemaFields.dateTimeString),
  /** Whether a pooled connection is open right now. */
  connected: Schema.Boolean,
  lastError: Schema.optional(Schema.Struct({ ...failureSchema.fields, at: SchemaFields.dateTimeString })),
})

const workspaceSchema = Schema.Struct({
  runtimeId: idSchema,
  workspaceId: Schema.String,
  path: Schema.String,
  title: Schema.String,
  sessionIds: Schema.Array(Schema.String),
})

const sessionSchema = Schema.Struct({
  runtimeId: idSchema,
  sessionId: Schema.String,
  cwd: Schema.optional(Schema.String),
  /** The remote thread's title projection when the runtime reports one; an older Host omits it. */
  title: Schema.optional(Schema.String),
  running: Schema.Boolean,
  blank: Schema.Boolean,
  updatedAt: Schema.Number.check(Schema.isFinite()),
})

const runtimeStatusSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    runtime: runtimeSummarySchema,
    workspaces: Schema.Array(workspaceSchema),
    sessions: Schema.Array(sessionSchema),
    stale: Schema.optional(Schema.Literal(true)),
    refreshing: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    hostId: idSchema,
    runtimeId: idSchema,
    code: Schema.String,
    message: Schema.String,
    stale: Schema.Literal(true),
    refreshing: Schema.optional(Schema.Boolean),
    lastSeenAt: Schema.optional(SchemaFields.dateTimeString),
  }),
])

export const resourceSnapshotSchema = Schema.Struct({
  sampledAt: SchemaFields.dateTimeString,
  platform: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  cpuCount: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(4096)),
  loadAverage1m: Schema.NullOr(Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThanOrEqualTo(0))),
  memoryTotalBytes: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  memoryFreeBytes: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
}).check(Schema.makeFilter(snapshot => (snapshot.memoryFreeBytes <= snapshot.memoryTotalBytes ? true : 'Free memory cannot exceed total memory.')))

const resourceProbeSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), snapshot: resourceSnapshotSchema }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String.check(Schema.isMaxLength(128)), message: Schema.String.check(Schema.isMaxLength(512)) }),
])

const resourcePoolEntrySchema = Schema.Struct({
  hostId: idSchema,
  hostName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  runtimeId: Schema.NullOr(idSchema),
  destination: Schema.NullOr(Schema.Struct({ kind: Schema.Literal('runtime'), runtimeId: idSchema })),
  hidden: Schema.Boolean,
  probe: resourceProbeSchema,
  stale: Schema.Boolean,
  refreshing: Schema.Boolean,
})

const resourceSelectionSchema = Schema.Struct({
  hostId: idSchema,
  hostName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  runtimeId: idSchema,
  score: Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThanOrEqualTo(0)),
})

const resourcePoolSchema = Schema.Struct({
  hosts: Schema.Array(resourcePoolEntrySchema).check(Schema.isMaxLength(64)),
  selected: Schema.NullOr(resourceSelectionSchema),
})

const failedSchema = Schema.Struct({ ...failureSchema.fields, ok: Schema.Literal(false) })
const runtimeRegistrationSchema = Schema.Union([Schema.Struct({ ok: Schema.Literal(true), runtime: runtimeSummarySchema }), failedSchema])
const remoteHomeSchema = Schema.Trim.check(Schema.isMinLength(2), Schema.isMaxLength(1024), Schema.isPattern(/^\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/))
const sshTargetSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(255), Schema.isPattern(/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/))
const connectionTestStepSchema = Schema.Struct({
  step: Schema.Literals(['ssh', 'runtime', 'identity']),
  ok: Schema.Boolean,
  ms: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})
const directoryEntrySchema = Schema.Struct({ name: Schema.String, path: Schema.String, hidden: Schema.Boolean })
const directoryListingSchema = Schema.Struct({
  path: Schema.String,
  home: Schema.String,
  crumbs: Schema.Array(directoryEntrySchema),
  entries: Schema.Array(directoryEntrySchema),
  truncated: Schema.Boolean,
})
const fileReferenceCandidateSchema = Schema.Struct({ path: Schema.String.check(Schema.isMaxLength(4096)), kind: Schema.Literals(['file', 'directory']) })
const encodedFileDataSchema = Schema.String.check(
  Schema.isMaxLength(32_000_000),
  Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
)
const fileUploadValueShapeSchema = Schema.Struct({
  receiptId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  file: Schema.Struct({
    attachmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    name: Schema.String.check(Schema.isMaxLength(1024)),
    bytes: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  }),
})
const isFileUploadValue = (value: unknown): value is FileUploadValue =>
  Schema.decodeUnknownResult(fileUploadValueShapeSchema, { onExcessProperty: 'error' })(value)._tag === 'Success'
export const fileUploadValueSchema: Schema.ConstraintDecoder<FileUploadValue> = Schema.declare(isFileUploadValue)
const modelSelectionSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  reasoningEffort: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
})
const modelCatalogModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  reasoning: Schema.optional(
    Schema.Struct({
      efforts: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, description: Schema.optional(Schema.String) })),
      defaultEffort: Schema.optional(Schema.String),
    }),
  ),
})
const modelCatalogGroupSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  models: Schema.Array(modelCatalogModelSchema),
})
const modelCatalogFailureSchema = Schema.Struct({ id: Schema.String, name: Schema.String, message: Schema.String })
const transcriptEntrySchema = Schema.Struct({
  seq: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()),
  kind: Schema.Literals(['user', 'assistant', 'tool', 'status']),
  text: Schema.String,
})
const transcriptWaitingSchema = Schema.Struct({
  kind: Schema.Literals(['question', 'tool']),
  tool: Schema.String,
  since: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()),
})
const remoteThreadSchema = Schema.Struct({
  runtimeId: idSchema,
  sessionId: sessionIdSchema,
  cwd: Schema.String,
  title: Schema.String,
  mention: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
  createdAt: SchemaFields.dateTimeString,
  hostName: Schema.String,
  connected: Schema.Boolean,
})
/** jj-integration methods a manager may call on a remote runtime; the folder and bookmark pickers need these. */
const remotePluginMethodSchema = Schema.Literals(['projects', 'classifyWorkspaces', 'destination', 'provision', 'noFolder'])
export const jjRevisionEffectSchema = Schema.Struct({
  changeId: Schema.String,
  commitId: Schema.String,
  description: Schema.String,
  conflict: Schema.Boolean,
})

export const jjThreadEffectSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  workspaceId: Schema.NullOr(Schema.String),
  workspaceTitle: Schema.optional(Schema.String),
  sessionIds: Schema.Array(Schema.String).check(Schema.isMaxLength(10_000)),
  finished: Schema.Boolean,
  canRebase: Schema.optional(Schema.Boolean),
  missing: Schema.Boolean,
  behind: Schema.Boolean,
  behindCount: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
  rebasedAt: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
  rebasedTipChangeId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  integrationQueuedAt: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
  integrationQueueEvents: Schema.optional(
    Schema.Array(
      Schema.Struct({
        at: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
        kind: Schema.Literals(['queued', 'unqueued']),
      }),
    ).check(Schema.isMaxLength(10_000)),
  ),
  integrations: Schema.optional(
    Schema.Array(
      Schema.Struct({
        at: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
        tipChangeId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
      }),
    ).check(Schema.isMaxLength(10_000)),
  ),
  unlanded: Schema.Array(jjRevisionEffectSchema).check(Schema.isMaxLength(10_000)),
})

export const jjRepositoryEffectSchema = Schema.Struct({
  repoRoot: Schema.String.check(Schema.isMaxLength(4096)),
  title: Schema.String.check(Schema.isMaxLength(512)),
  workspaceId: Schema.NullOr(Schema.String),
  bookmarks: Schema.Array(Schema.String.check(Schema.isMaxLength(512)))
    .check(Schema.isMaxLength(10_000))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  threads: Schema.Array(jjThreadEffectSchema).check(Schema.isMaxLength(10_000)),
})

export const jjRepositoriesEffectSchema = Schema.Struct({
  repositories: Schema.Array(jjRepositoryEffectSchema).check(Schema.isMaxLength(200)),
  refreshing: Schema.optional(Schema.Boolean),
  refreshFailed: Schema.optional(Schema.Boolean),
})

/**
 * `@dshfiles/jj-integration` composes these four schemas with Zod in its own contract, so they stay Zod until that
 * plugin finishes its Effect conversion; the Effect twins above are the contract this bundle publishes.
 */
/**
 * `@dshfiles/jj-integration` composes these with zod in its own contract (z.infer, z.array, .nullable), so they are
 * published as zod views of the Effect schemas above rather than a second hand-written schema.
 */
export const jjRevisionSchema = zodSchemaFromEffect(jjRevisionEffectSchema)

export const jjThreadSchema = zodSchemaFromEffect(jjThreadEffectSchema)

export const jjRepositorySchema = zodSchemaFromEffect(jjRepositoryEffectSchema)

export const jjRepositoriesSchema = zodSchemaFromEffect(jjRepositoriesEffectSchema)

export type JjRevisionView = Schema.Schema.Type<typeof jjRevisionEffectSchema>
export type JjThreadView = Schema.Schema.Type<typeof jjThreadEffectSchema>
export type JjRepositoryView = Schema.Schema.Type<typeof jjRepositoryEffectSchema>

export const nativeRpcSchema: Schema.ConstraintDecoder<DshxNativeRpcRequest> = Schema.declare(
  (value): value is DshxNativeRpcRequest => Schema.is(nativeRpcRequestSchema)(value),
  { toJsonSchema: () => Schema.toJsonSchemaDocument(nativeRpcRequestSchema).schema },
)

const nativeValueSchema = Schema.Union([
  Schema.Struct({
    items: Schema.Array(
      Schema.Struct({
        sessionId: sessionIdSchema,
        updatedAt: Schema.Number.check(Schema.isFinite()),
        running: Schema.Boolean,
        blank: Schema.Boolean,
        agentAvailable: Schema.optional(Schema.Boolean),
        cwd: Schema.optional(Schema.String),
      }).pipe(SchemaFields.passthrough),
    ).check(Schema.isMaxLength(10_000)),
  }).pipe(SchemaFields.passthrough),
  Schema.Struct({
    items: Schema.Array(Schema.Struct({ sessionId: sessionIdSchema, snippet: Schema.String }).pipe(SchemaFields.passthrough)).check(Schema.isMaxLength(10_000)),
    hasMore: Schema.Boolean,
  }).pipe(SchemaFields.passthrough),
  Schema.Struct({ sessionId: sessionIdSchema, agentPreset: Schema.optional(Schema.String) }).pipe(SchemaFields.passthrough),
  Schema.Struct({ accepted: Schema.Literal(true) }).pipe(SchemaFields.passthrough),
  Schema.Struct({ title: Schema.String, seq: Schema.Number.check(Schema.isFinite()) }).pipe(SchemaFields.passthrough),
  Schema.Struct({ records: Schema.Array(jsonValueSchema).check(Schema.isMaxLength(10_000)), hasMore: Schema.Boolean }).pipe(SchemaFields.passthrough),
  Schema.Struct({ archivedSessionIds: Schema.Array(sessionIdSchema).check(Schema.isMaxLength(10_000)) }).pipe(SchemaFields.passthrough),
])

export const nativeRpcResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: nativeValueSchema }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const trimmedStringSchema = <S extends Schema.ConstraintDecoder<string>>(schema: S) => {
  const constraints = { ...Schema.toJsonSchemaDocument(schema).schema }
  delete constraints.type

  return Schema.String.check(
    Schema.makeFilter(
      value => {
        const result = Schema.decodeUnknownResult(schema)(value.trim())
        return result._tag === 'Success' ? true : result.failure.message
      },
      { toJsonSchema: () => constraints },
    ),
  ).pipe(Schema.decodeTo(Schema.Trim))
}
const stringMinLength = (minimum: number) =>
  Schema.makeFilter((value: string) => (value.length >= minimum ? true : 'Expected a longer string.'), {
    toJsonSchema: () => ({ minLength: minimum }),
  })
const remotePathSchema = trimmedStringSchema(
  Schema.String.check(stringMinLength(2), Schema.isMaxLength(4096), Schema.isPattern(/^\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/u)),
)
const cloneDestinationSchema = Schema.Union([
  remotePathSchema,
  trimmedStringSchema(Schema.String.check(stringMinLength(3), Schema.isMaxLength(4096), Schema.isPattern(/^~\/(?!\.\.(?:\/|$))(?!.*\/\.\.(?:\/|$)).+$/u))),
])
const localProjectPathSchema = trimmedStringSchema(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)))
const localProjectFilePathSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)).check(
  Schema.makeFilter(path =>
    !path.includes('\0') && !path.startsWith('/') && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
      ? true
      : 'Invalid input',
  ),
)
const repositoryUrlSchema = trimmedStringSchema(
  Schema.String.check(
    Schema.isMaxLength(2048),
    Schema.isPattern(
      /^(?:https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?:\.git)?|git@[A-Za-z0-9.-]+:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?:\.git)?)$/u,
    ),
  ),
)
export const cloneProjectInputEffectSchema = Schema.Struct({
  runtimeId: idSchema,
  repositoryUrl: repositoryUrlSchema,
  destinationPath: cloneDestinationSchema,
  copyFromPath: Schema.optionalKey(localProjectPathSchema),
  copyPaths: Schema.optionalKey(Schema.Array(localProjectFilePathSchema).check(Schema.isMaxLength(128))),
  includeIgnored: Schema.optionalKey(Schema.Boolean),
}).check(
  Schema.makeFilter(input => {
    const issues: string[] = []
    if ((input.copyFromPath === undefined) !== (input.copyPaths === undefined)) {
      issues.push('Local source folder and selected file list must be supplied together.')
    }
    if (input.includeIgnored === true && input.copyFromPath === undefined) {
      issues.push('Scanning ignored files requires an explicit local source folder.')
    }
    return issues
  }),
)

const profileNameSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64), Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u))

const semanticVersionSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64), Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u))

const repositorySchema = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1024),
  Schema.isPattern(/^(?:https:\/\/[^\s]+|git@[^\s]+|ssh:\/\/[^\s]+)$/u),
)

const provisionStepSchema = Schema.Literals(['node', 'checkout', 'install', 'build', 'cli', 'profile', 'runtime'])

const remoteNodeSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  resolved: Schema.optional(Schema.String),
  nix: Schema.Boolean,
})

const hostUpdateResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  applied: Schema.Boolean,
  checkoutPath: Schema.String,
  revision: Schema.optional(Schema.String),
  rebuilt: Schema.Array(Schema.String),
  restartNeeded: Schema.Boolean,
  detail: Schema.String,
})

const remoteFactsSchema = Schema.Struct({
  uname: Schema.String,
  osVersion: Schema.optional(Schema.String),
  user: Schema.optional(Schema.String),
  home: Schema.optional(Schema.String),
  node: remoteNodeSchema,
  fnm: Schema.Struct({ path: Schema.optional(Schema.String), nodes: Schema.Array(Schema.Struct({ version: Schema.String, path: Schema.String })) }),
  dsh: Schema.Struct({ path: Schema.optional(Schema.String), version: Schema.optional(Schema.String) }),
  jj: Schema.Struct({ path: Schema.optional(Schema.String), version: Schema.optional(Schema.String) }),
  pnpm: Schema.Struct({ path: Schema.optional(Schema.String), version: Schema.optional(Schema.String) }),
  launch: Schema.Struct({
    files: Schema.Array(Schema.String),
    port: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt())),
    pid: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt())),
  }),
  profile: Schema.Struct({
    path: Schema.String,
    exists: Schema.Boolean,
    pluginLinks: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()),
    coreVersion: Schema.optional(Schema.String),
  }),
  checkout: Schema.Struct({
    path: Schema.String,
    exists: Schema.Boolean,
    installed: Schema.Boolean,
    built: Schema.Boolean,
    changeId: Schema.optional(Schema.String),
    commitId: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    conflicts: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()),
    mainOrigin: Schema.optional(Schema.String),
  }),
})

const remoteDiagnosticSchema = Schema.Struct({
  code: Schema.String.check(Schema.isMaxLength(128)),
  severity: Schema.Literals(['error', 'warning', 'info']),
  message: Schema.String.check(Schema.isMaxLength(2048)),
})

const remoteExecOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  code: Schema.NullOr(Schema.Number.check(Schema.isFinite()).check(Schema.isInt())),
  stdout: Schema.String,
  stderr: Schema.String,
  timedOut: Schema.Boolean,
  durationMs: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
})

const provisionPlanStepSchema = Schema.Struct({
  id: provisionStepSchema,
  title: Schema.String,
  state: Schema.Literals(['done', 'pending', 'blocked']),
  reason: Schema.String,
  commands: Schema.Array(Schema.String),
})

const provisionStepRunSchema = Schema.Struct({
  id: provisionStepSchema,
  ok: Schema.Boolean,
  state: Schema.Literals(['ran', 'failed', 'skipped', 'blocked']),
  detail: Schema.String,
  stdout: Schema.String,
  stderr: Schema.String,
})

const remoteRuntimeStatusSchema = Schema.Struct({
  running: Schema.Boolean,
  port: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt())),
  pid: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt())),
  command: Schema.optional(Schema.String),
  listening: Schema.Boolean,
  launchFiles: Schema.Array(Schema.String),
  logFile: Schema.String,
  logBytes: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt())),
})

const checkoutSyncPlanSchema = Schema.Struct({
  path: Schema.String,
  bookmark: Schema.String,
  upToDate: Schema.Boolean,
  reason: Schema.String,
  commands: Schema.Array(Schema.String),
})

const effectMultiHostApi = defineApi({
  id: 'multi-host',
  version: 1,
  owner: '@dshfiles/multi-host',
  methods: {
    identity: method({
      input: Schema.Void,
      output: runtimeIdentitySchema,
      description: 'Identity of this DSH runtime as other hosts see it. Read-only.',
      tool: { name: 'multi_host_identity', readOnly: true, render: compactJson },
    }),
    resourceSnapshot: method({
      input: Schema.Void,
      output: resourceSnapshotSchema,
      description: 'Read CPU load and memory capacity for this DSH machine. Read-only.',
      tool: { name: 'multi_host_resource_snapshot', readOnly: true, render: compactJson },
    }),
    resourcePool: method({
      input: Schema.Void,
      output: resourcePoolSchema,
      description: 'Read resource snapshots for registered hosts and the least-pressured eligible remote destination. Read-only.',
      tool: { name: 'multi_host_resource_pool', readOnly: true, render: compactJson },
    }),
    list: method({
      input: Schema.Void,
      output: Schema.Struct({ hosts: Schema.Array(hostSummarySchema), runtimes: Schema.Array(runtimeSummarySchema) }),
      description:
        'List the machines (hosts) this DSH can run threads on and their DSH runtimes: connector, remote home, whether a connection is open, and the last error. Read-only.',
      tool: { name: 'multi_host_list', readOnly: true },
    }),
    hostUpsert: method({
      input: Schema.Struct({ id: idSchema, name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)), connector: hostConnectorSchema }),
      output: hostSummarySchema,
    }),
    hostRemove: method({
      input: Schema.Struct({ id: idSchema, removeDirectory: Schema.Boolean }),
      output: Schema.Struct({ removed: Schema.Boolean }),
      description:
        'Remove one host record, optionally deleting its directory on that machine; its threads are kept. Call only when the user asked to remove that host.',
      tool: { name: 'multi_host_remove_host', render: compactJson },
    }),
    hostSetHidden: method({
      input: Schema.Struct({ id: idSchema, hidden: Schema.Boolean }),
      output: hostSummarySchema,
      description:
        'Hide or show one host in the destination picker without removing it: its runtimes, threads and remote data stay. Call only when the user asked to hide or show that host.',
      tool: { name: 'multi_host_set_host_hidden', render: compactJson },
    }),
    hostReorder: method({
      input: Schema.Struct({ ids: Schema.Array(idSchema).check(Schema.isMinLength(1), Schema.isMaxLength(64)) }),
      output: Schema.Struct({ hosts: Schema.Array(hostSummarySchema) }),
      description:
        'Reorder the hosts: pass every host id exactly once, in the order the picker page should list them. Call only when the user asked to reorder hosts.',
      tool: { name: 'multi_host_reorder_hosts', render: compactJson },
    }),
    sshConfigHosts: method({
      input: Schema.Void,
      output: Schema.Struct({ hosts: Schema.Struct({ aliases: Schema.Array(Schema.String), knownHosts: Schema.Array(Schema.String) }) }),
      description: 'SSH aliases from the local ssh config and known_hosts entries, as suggestions when adding a host. Read-only.',
      tool: { name: 'multi_host_ssh_hosts', readOnly: true, render: compactJson },
    }),
    discoverHomes: method({
      input: Schema.Struct({ sshTarget: sshTargetSchema }),
      output: Schema.Union([
        Schema.Struct({
          ok: Schema.Literal(true),
          homes: Schema.Array(Schema.Struct({ path: Schema.String, source: Schema.Literals(['multi-host', 'web-url']) })),
        }),
        failedSchema,
      ]),
      description: 'Look for DSH homes on a host over SSH, the way the add-host dialog does. Call only when the user asked to set that host up.',
      tool: { name: 'multi_host_find_homes', render: compactJson },
    }),
    testConnection: method({
      input: Schema.Struct({
        name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
        sshTarget: sshTargetSchema,
        remoteHome: remoteHomeSchema,
      }),
      output: Schema.Union([
        Schema.Struct({ ok: Schema.Literal(true), steps: Schema.Array(connectionTestStepSchema), identity: runtimeIdentitySchema }),
        Schema.Struct({ ...failedSchema.fields, steps: Schema.optional(Schema.Array(connectionTestStepSchema)) }),
      ]),
      description:
        'Run the stepwise connection test for one host configuration (ssh, then runtime, then identity). Call only when the user asked to test that host.',
      tool: { name: 'multi_host_test', render: compactJson },
    }),
    saveSshHost: method({
      input: Schema.Struct({
        hostId: Schema.optional(idSchema),
        name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
        sshTarget: sshTargetSchema,
        remoteHome: remoteHomeSchema,
      }),
      output: runtimeRegistrationSchema,
      description:
        'Add or edit an SSH host: its name, ssh target and the remote DSH home to register. Call only when the user asked to add or change that host.',
      tool: { name: 'multi_host_save_ssh_host', render: compactJson },
    }),
    runtimeUpsert: method({
      input: Schema.Struct({
        hostId: idSchema,
        name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
        locator: runtimeLocatorSchema,
      }),
      output: runtimeRegistrationSchema,
    }),
    runtimeStatus: method({
      input: Schema.Struct({ runtimeId: idSchema }),
      output: runtimeStatusSchema,
      description:
        'Connection state of one remote DSH runtime: whether a connection is open, the last error, and when it was last seen. A cold or stale result returns immediately while one coalesced background refresh runs. Read-only.',
      tool: { name: 'multi_host_status', readOnly: true, render: compactJson },
    }),
    /** Connect if needed and round-trip once; the chip menu shows the latency as the host's status. */
    runtimePing: method({
      input: Schema.Struct({ runtimeId: idSchema }),
      output: Schema.Union([
        Schema.Struct({ ok: Schema.Literal(true), ms: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)) }),
        failedSchema,
      ]),
    }),
    runtimeReconnect: method({
      input: Schema.Struct({ runtimeId: idSchema }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true) }), failedSchema]),
      description: 'Drop and reopen the pooled connection to one remote runtime. Call only when the user asked to reconnect it.',
      tool: { name: 'multi_host_reconnect', render: compactJson },
    }),
    /** This runtime's own folders; a manager calls it on a remote runtime to browse that machine. */
    listDirectory: method({
      input: Schema.Struct({ path: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))) }),
      output: directoryListingSchema,
    }),
    createDirectory: method({
      input: Schema.Struct({
        path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
        name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
      }),
      output: Schema.Struct({ path: Schema.String }),
    }),
    runtimeCreateDirectory: method({
      input: Schema.Struct({
        runtimeId: idSchema,
        path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
        name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
      }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), path: Schema.String }), failedSchema]),
      description: 'Create one folder on a remote runtime. Call only when the user asked to create that folder.',
      tool: { name: 'multi_host_mkdir', render: compactJson },
    }),
    /** Register a folder as a workspace on the runtime, so its jj-integration can describe and isolate it. */
    runtimeOpenFolder: method({
      input: Schema.Struct({ runtimeId: idSchema, path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)) }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), workspaceId: Schema.String, path: Schema.String }), failedSchema]),
      description:
        'Register a folder on a remote runtime as a workspace, so the remote jj-integration can describe and isolate it. Call only when the user asked to open that folder there.',
      tool: { name: 'multi_host_open_folder', render: compactJson },
    }),
    localProjectFiles: method({
      input: Schema.Struct({ path: localProjectPathSchema, includeIgnored: Schema.optional(Schema.Boolean) }),
      output: Schema.Union([
        Schema.Struct({
          ok: Schema.Literal(true),
          root: Schema.String,
          files: Schema.Array(
            Schema.Struct({
              path: Schema.String,
              bytes: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
              ignored: Schema.Boolean,
              copyable: Schema.Boolean,
              copyReason: Schema.optional(Schema.Literals(['potential-secret', 'too-large'])),
            }),
          ),
          truncated: Schema.Boolean,
        }),
        failedSchema,
      ]),
      description:
        'List untracked files under one local Git project without reading contents. Ignored files appear only when includeIgnored is explicitly true; credential-like paths are marked non-copyable. Read-only.',

      tool: { name: 'multi_host_local_project_files', readOnly: true, render: compactJson },
    }),
    runtimeCloneProject: method({
      input: cloneProjectInputEffectSchema,
      output: Schema.Union([
        Schema.Struct({
          ok: Schema.Literal(true),
          workspaceId: Schema.String,
          path: Schema.String,
          copiedFileCount: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
          copyWarning: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
        }),
        failedSchema,
      ]),
      description:
        'Clone a Git repository to one remote host and register the clone as a project workspace. Optionally copy individually selected local files; ignored files require includeIgnored: true, no file is selected automatically, and credential-like paths are blocked. Call only when the user asked to clone there.',
      tool: { name: 'multi_host_clone_project', render: compactJson },
    }),
    runtimeBrowse: method({
      input: Schema.Struct({ runtimeId: idSchema, path: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))) }),
      output: Schema.Union([Schema.Struct({ ...directoryListingSchema.fields, ok: Schema.Literal(true) }), failedSchema]),
      description: 'List folders on a remote runtime at one path (default: the runtime home), for choosing where a remote thread runs. Read-only.',
      tool: { name: 'multi_host_browse', readOnly: true, render: compactJson },
    }),
    runtimePluginCall: method({
      input: Schema.Struct({ runtimeId: idSchema, method: remotePluginMethodSchema, input: jsonValueSchema }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }), failedSchema]),
    }),
    runtimeModels: method({
      input: Schema.Struct({ runtimeId: idSchema }),
      output: Schema.Union([
        Schema.Struct({
          ok: Schema.Literal(true),
          default: Schema.NullOr(modelSelectionSchema),
          routableProviders: Schema.Array(Schema.String),
          groups: Schema.Array(modelCatalogGroupSchema),
          failures: Schema.Array(modelCatalogFailureSchema),
        }),
        failedSchema,
      ]),
      description:
        "The provider-grouped model catalog of one remote runtime, including adapter reasoning efforts, so remote thread composers can use that Host's model choices. Read-only.",
      tool: { name: 'multi_host_models', readOnly: true, render: compactJson },
    }),
    sessionRuntime: method({
      input: Schema.Struct({ sessionId: brandedSessionIdSchema }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), runtimeId: Schema.NullOr(idSchema) }), failedSchema]),
      description: 'Return the known runtime for a Session already claimed by a source, or null when no runtime is known.',
    }),
    sessionJjRepositories: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), repositories: jjRepositoriesEffectSchema }), failedSchema]),
      description: 'Read JJ repository and thread-workspace status from the runtime that owns this mirrored Session. Read-only.',
      tool: { name: 'multi_host_session_jj_repositories', readOnly: true, render: compactJson },
    }),
    runtimeFileReferences: method({
      input: Schema.Struct({ runtimeId: idSchema, sessionId: sessionIdSchema, query: Schema.String.check(Schema.isMaxLength(4096)) }),
      output: Schema.Union([
        Schema.Struct({ ok: Schema.Literal(true), candidates: Schema.Array(fileReferenceCandidateSchema).check(Schema.isMaxLength(1000)) }),
        failedSchema,
      ]),
      description: 'List file and directory mentions for one remote Session cwd. Read-only.',
      tool: { name: 'multi_host_file_references', readOnly: true, render: compactJson },
    }),
    sessionUploadFile: method({
      input: Schema.Struct({
        runtimeId: idSchema,
        sessionId: brandedSessionIdSchema,
        data: encodedFileDataSchema,
        name: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
      }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), value: fileUploadValueSchema }), failedSchema]),
      description: 'Stage one file attachment up to 24 MB for a remote Session. This is a non-replayable mutation.',
    }),
    threadCreate: method({
      input: Schema.Struct({ runtimeId: idSchema, cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)) }),
      output: Schema.Union([
        Schema.Struct({ ok: Schema.Literal(true), sessionId: sessionIdSchema }),
        Schema.Struct({ ...failedSchema.fields, sessionId: Schema.optional(sessionIdSchema) }),
      ]),
      description:
        'Create an empty thread on one remote runtime and open it in the native chat composer. Call only when the user asked to start a thread on that machine.',
      tool: { name: 'multi_host_create_thread', render: compactJson },
    }),
    threadStart: method({
      input: Schema.Struct({
        runtimeId: idSchema,
        cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
        text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
        agentPreset: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
        model: Schema.optional(modelSelectionSchema),
      }),
      output: Schema.Union([
        Schema.Struct({ ok: Schema.Literal(true), sessionId: sessionIdSchema }),
        Schema.Struct({ ...failedSchema.fields, sessionId: Schema.optional(sessionIdSchema) }),
      ]),
      description:
        'Start a thread on one remote runtime: its directory, the first message, and optionally an agent preset and model. Call only when the user asked to start a thread on that machine.',
      tool: { name: 'multi_host_start_thread', render: compactJson },
    }),
    /** The latest messages of a remote thread, reduced to text, for the local remote-thread view. */
    threadTranscript: method({
      input: Schema.Struct({
        runtimeId: idSchema,
        sessionId: sessionIdSchema,
        maxMessages: Schema.optional(
          Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(200)),
        ),
      }),
      output: Schema.Union([
        Schema.Struct({
          ok: Schema.Literal(true),
          cursor: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()),
          cwd: Schema.optional(Schema.String),
          title: Schema.optional(Schema.String),
          running: Schema.Boolean,
          model: Schema.optional(modelSelectionSchema),
          waiting: Schema.optional(transcriptWaitingSchema),
          entries: Schema.Array(transcriptEntrySchema),
        }),
        failedSchema,
      ]),
      description: 'The latest messages of one remote thread, reduced to text, with its cursor, directory, title, running state and model. Read-only.',
      tool: { name: 'multi_host_thread_transcript', readOnly: true, render: compactJson },
    }),
    threadList: method({
      input: Schema.Void,
      output: Schema.Struct({ threads: Schema.Array(remoteThreadSchema) }),
      description: 'Every thread this DSH started on remote runtimes, with its host, Session, title and state. Read-only.',
      tool: { name: 'multi_host_threads', readOnly: true, render: compactJson },
    }),
    threadForget: method({
      input: Schema.Struct({ runtimeId: idSchema, sessionId: Schema.optional(sessionIdSchema) }),
      output: Schema.Struct({ removed: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)) }),
      description:
        'Forget the local records of remote threads (one Session, or every thread on a runtime). The remote threads keep running. Call only when the user asked to forget them.',
      tool: { name: 'multi_host_forget_thread', render: compactJson },
    }),
    /** Reply on one remote thread. Steer when it is running, otherwise queue. */
    threadReply: method({
      input: Schema.Struct({
        runtimeId: idSchema,
        sessionId: sessionIdSchema,
        text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
        steer: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
      }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true) }), failedSchema]),
      description:
        'Send a message to one thread running on another machine: it queues the message, or steers the running turn when steer is true. Call only when the user asked to reply on that thread.',
      tool: {
        name: 'multi_host_thread_reply',
        render: output => (output.ok ? 'Sent to the remote thread.' : `Failed: ${output.message}`),
      },
    }),
    /** Stop one remote thread through the same cancel path the local Stop uses. */
    threadStop: method({
      input: Schema.Struct({ runtimeId: idSchema, sessionId: sessionIdSchema }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true) }), failedSchema]),
      description:
        'Stop the running turn of one thread on another machine, through the same cancel path its Stop button uses. Call only when the user asked to stop that thread.',
      tool: {
        name: 'multi_host_thread_stop',
        render: output => (output.ok ? 'Asked the remote thread to stop.' : `Failed: ${output.message}`),
      },
    }),

    remoteExec: method({
      input: Schema.Struct({
        sshTarget: sshTargetSchema,
        command: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
        cwd: Schema.optional(remotePathSchema),
        timeoutMs: Schema.Number.check(Schema.isFinite())
          .check(Schema.isInt())
          .check(Schema.isGreaterThanOrEqualTo(1000))
          .check(Schema.isLessThanOrEqualTo(120_000))
          .pipe(Schema.withDecodingDefault(Effect.succeed(30_000))),
      }),
      output: Schema.Union([remoteExecOutputSchema, failedSchema]),
      description:
        'Run one bounded command on an SSH host and return its exit code, stdout and stderr (120 s at most). Call only when the user asked to run something on that machine.',
      tool: { name: 'multi_host_exec', render: compactJson },
    }),
    doctor: method({
      input: Schema.Struct({
        sshTarget: sshTargetSchema,
        profile: profileNameSchema.pipe(Schema.withDecodingDefault(Effect.succeed('web'))),
        checkoutPath: Schema.optional(remotePathSchema),
        dshVersion: Schema.optional(semanticVersionSchema),
      }),
      output: Schema.Union([
        Schema.Struct({ ok: Schema.Literal(true), facts: remoteFactsSchema, diagnostics: Schema.Array(remoteDiagnosticSchema) }),
        failedSchema,
      ]),
      description:
        'Report what one SSH host has for DSH: node (and whether it is the Nix build DSH cannot boot), fnm, jj, pnpm, dsh, profile core version, checkout revision and any running runtime, plus the diagnostics worth acting on. Read-only.',
      tool: { name: 'multi_host_doctor', readOnly: true, render: compactJson },
    }),
    provision: method({
      input: Schema.Struct({
        sshTarget: sshTargetSchema,
        remoteHome: remoteHomeSchema,
        checkoutPath: Schema.optional(remotePathSchema),
        profile: profileNameSchema.pipe(Schema.withDecodingDefault(Effect.succeed('web'))),
        repository: repositorySchema,
        revision: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
        dshVersion: semanticVersionSchema,
        nodeVersion: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(32)).pipe(Schema.withDecodingDefault(Effect.succeed('22.23.3'))),
        steps: Schema.Array(provisionStepSchema)
          .check(Schema.isMinLength(1))
          .pipe(Schema.withDecodingDefault(Effect.succeed(['node', 'checkout', 'install', 'build', 'cli', 'profile', 'runtime']))),
        confirm: Schema.Literals(['all', 'next']).pipe(Schema.withDecodingDefault(Effect.succeed('next'))),
        dryRun: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
      }),
      output: Schema.Union([
        Schema.Struct({
          ok: Schema.Literal(true),
          plan: Schema.Array(provisionPlanStepSchema),
          executed: Schema.Array(provisionStepRunSchema),
          remaining: Schema.Array(provisionStepSchema),
        }),
        failedSchema,
      ]),
      description:
        'Install and start DSH on an SSH host: official Node through fnm, the dshfiles checkout, its dependencies and build, the dsh CLI, the web profile and a headless runtime. dryRun only plans. confirm "next" (default) runs one step per call, so each step is its own opt-in; "all" runs every named step. Call only when the user asked to provision that machine.',
      tool: { name: 'multi_host_provision', render: compactJson },
    }),
    remoteRuntimeStatus: method({
      input: Schema.Struct({ sshTarget: sshTargetSchema, remoteHome: Schema.optional(remoteHomeSchema) }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), status: remoteRuntimeStatusSchema }), failedSchema]),
      description: 'Whether a DSH runtime answers on one SSH host: its launch file, port, pid, process command and log size. Read-only.',
      tool: { name: 'multi_host_runtime_status', readOnly: true, render: compactJson },
    }),
    runtimeControl: method({
      input: Schema.Struct({
        sshTarget: sshTargetSchema,
        remoteHome: Schema.optional(remoteHomeSchema),
        action: Schema.Literals(['start', 'stop']),
        checkoutPath: Schema.optional(remotePathSchema),
        profile: profileNameSchema.pipe(Schema.withDecodingDefault(Effect.succeed('web'))),
      }),
      output: Schema.Union([
        Schema.Struct({ ok: Schema.Literal(true), action: Schema.Literals(['start', 'stop']), detail: Schema.String, status: remoteRuntimeStatusSchema }),
        failedSchema,
      ]),
      description:
        'Start or stop the headless DSH runtime on one SSH host (start uses an official Node build and a free loopback port; stop refuses a process that is not that machine DSH web). Call only when the user asked to start or stop it.',
      tool: { name: 'multi_host_runtime_control', render: compactJson },
    }),
    runtimeLogs: method({
      input: Schema.Struct({
        sshTarget: sshTargetSchema,
        remoteHome: Schema.optional(remoteHomeSchema),
        lines: Schema.Number.check(Schema.isFinite())
          .check(Schema.isInt())
          .check(Schema.isGreaterThanOrEqualTo(1))
          .check(Schema.isLessThanOrEqualTo(400))
          .pipe(Schema.withDecodingDefault(Effect.succeed(200))),
      }),
      output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), logFile: Schema.String, tail: Schema.String }), failedSchema]),
      description: 'Read the tail of the headless DSH runtime log on one SSH host (400 lines at most). Read-only.',
      tool: { name: 'multi_host_runtime_logs', readOnly: true, render: compactJson },
    }),
    checkoutSync: method({
      input: Schema.Struct({
        sshTarget: sshTargetSchema,
        path: remotePathSchema,
        bookmark: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128)).pipe(Schema.withDecodingDefault(Effect.succeed('main'))),
        apply: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
      }),
      output: Schema.Union([
        Schema.Struct({
          ok: Schema.Literal(true),
          applied: Schema.Boolean,
          detail: Schema.String,
          plan: checkoutSyncPlanSchema,
          stdout: Schema.String,
          stderr: Schema.String,
        }),
        failedSchema,
      ]),
      description:
        'Fetch and rebase one checkout on an SSH host onto its bookmark origin, keeping that machine edits. Without apply it only reports the commands. Call only when the user asked to update that checkout.',
      tool: { name: 'multi_host_checkout_sync', render: compactJson },
    }),
    hostUpdate: method({
      input: Schema.Struct({
        hostId: idSchema,
        bookmark: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128)).pipe(Schema.withDecodingDefault(Effect.succeed('main'))),
        apply: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
      }),
      output: Schema.Union([hostUpdateResultSchema, failedSchema]),
      description:
        "Bring one SSH host's dshfiles checkout onto the bookmark from origin: fetch, then its own dshx checkout sync rebases, installs and rebuilds what changed, and reports whether that host needs a restart. It never restarts the host. Without apply it reports what would change. Call only when the user asked to update that host.",
      tool: { name: 'multi_host_update', render: compactJson },
    }),
    runtimeCall: method({
      input: Schema.Struct({ runtimeId: idSchema, request: nativeRpcSchema }),
      output: nativeRpcResultSchema,
    }),
    sessionCursor: method({
      input: Schema.Struct({ runtimeId: idSchema, sessionId: Schema.String.check(Schema.isMinLength(1)) }),
      output: Schema.Struct({
        cursor: Schema.Number.check(Schema.isFinite())
          .check(Schema.isInt())
          .check(Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }))
          .check(Schema.isGreaterThanOrEqualTo(-1)),
      }),
    }),
    runtimeOpenView: method({
      input: Schema.Struct({ runtimeId: idSchema, sessionId: Schema.optional(sessionIdSchema) }),
      output: Schema.Struct({
        leaseId: Schema.String.check(Schema.isUUID()),
        launchUrl: SchemaFields.urlString,
        threadUrl: Schema.optional(SchemaFields.urlString),
      }),
    }),
    runtimeCloseView: method({
      input: Schema.Struct({ leaseId: Schema.String.check(Schema.isUUID()) }),
      output: Schema.Struct({ closed: Schema.Boolean }),
    }),
    runtimeRemove: method({
      input: Schema.Struct({ runtimeId: idSchema }),
      output: Schema.Struct({ removed: Schema.Boolean }),
      description: 'Remove one runtime registration from a host. Call only when the user asked to remove it.',
      tool: { name: 'multi_host_remove_runtime', render: compactJson },
    }),
  },
})

export type EffectMultiHostApi = typeof effectMultiHostApi
export const multiHostApi = effectMultiHostApi

export type HostSummary = Schema.Schema.Type<typeof hostSummarySchema>
export type ConnectionTestStep = Schema.Schema.Type<typeof connectionTestStepSchema>
export type RemoteThreadSummary = Schema.Schema.Type<typeof remoteThreadSchema>
export type DirectoryListing = Schema.Schema.Type<typeof directoryListingSchema>
export type TranscriptEntry = Schema.Schema.Type<typeof transcriptEntrySchema>
export type TranscriptWaiting = Schema.Schema.Type<typeof transcriptWaitingSchema>
export type ModelSelection = Schema.Schema.Type<typeof modelSelectionSchema>
export type RuntimeSummary = Schema.Schema.Type<typeof runtimeSummarySchema>
export type WorkspaceSummary = Schema.Schema.Type<typeof workspaceSchema>
export type SessionSummary = Schema.Schema.Type<typeof sessionSchema>
export type RuntimeStatus = Schema.Schema.Type<typeof runtimeStatusSchema>
export type ResourceSnapshot = Schema.Schema.Type<typeof resourceSnapshotSchema>
export type ResourceProbe = Schema.Schema.Type<typeof resourceProbeSchema>
export type ResourcePoolEntry = Schema.Schema.Type<typeof resourcePoolEntrySchema>
export type ResourceSelection = Schema.Schema.Type<typeof resourceSelectionSchema>
export type ResourcePool = Schema.Schema.Type<typeof resourcePoolSchema>
export type NativeRpcRequest = Schema.Schema.Type<typeof nativeRpcSchema>
export type NativeRpcResult = Schema.Schema.Type<typeof nativeRpcResultSchema>
