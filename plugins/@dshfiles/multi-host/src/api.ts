import type { FileUploadValue } from '@deepseek-ai/dsh-client-file-upload/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineApi, method } from '@dshfiles/dshx/api'
import { nativeRpcRequestSchema } from '@dshfiles/dshx/platform/native-rpc'
import { z } from 'zod'
import { hostConnectorSchema, runtimeIdentitySchema, runtimeLocatorSchema } from './records.js'

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

const idSchema = z.string().min(1).max(64)
const sessionIdSchema = z.string().min(1).max(256)
const brandedSessionIdSchema = z.custom<SessionId>(value => typeof value === 'string' && value.length > 0 && value.length <= 256)

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type LocalProjectFileCandidate = {
  readonly path: string
  readonly bytes: number
  readonly ignored: boolean
  readonly copyable: boolean
  readonly copyReason?: 'potential-secret' | 'too-large' | undefined
}

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
)

const hostSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  connector: hostConnectorSchema,
  runtimeCount: z.number().int().nonnegative(),
  hidden: z.boolean(),
})

const failureSchema = z.object({ code: z.string().max(128), message: z.string().max(2048) })

const runtimeSummarySchema = z.object({
  id: idSchema,
  hostId: idSchema,
  name: z.string(),
  identity: runtimeIdentitySchema.nullable(),
  remoteHome: z.string().optional(),
  lastSeenAt: z.string().datetime().optional(),
  /** Whether a pooled connection is open right now. */
  connected: z.boolean(),
  lastError: failureSchema.extend({ at: z.string().datetime() }).optional(),
})

const workspaceSchema = z.object({
  runtimeId: idSchema,
  workspaceId: z.string(),
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(z.string()),
})

const sessionSchema = z.object({
  runtimeId: idSchema,
  sessionId: z.string(),
  cwd: z.string().optional(),
  /** The remote thread's title projection when the runtime reports one; an older Host omits it. */
  title: z.string().optional(),
  running: z.boolean(),
  blank: z.boolean(),
  updatedAt: z.number(),
})

const runtimeStatusSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    runtime: runtimeSummarySchema,
    workspaces: z.array(workspaceSchema),
    sessions: z.array(sessionSchema),
    stale: z.literal(true).optional(),
    refreshing: z.boolean().optional(),
  }),
  z.object({
    ok: z.literal(false),
    hostId: idSchema,
    runtimeId: idSchema,
    code: z.string(),
    message: z.string(),
    stale: z.literal(true),
    refreshing: z.boolean().optional(),
    lastSeenAt: z.string().datetime().optional(),
  }),
])

export const resourceSnapshotSchema = z
  .object({
    sampledAt: z.string().datetime(),
    platform: z.string().min(1).max(32),
    cpuCount: z.number().int().nonnegative().max(4096),
    loadAverage1m: z.number().finite().nonnegative().nullable(),
    memoryTotalBytes: z.number().int().nonnegative(),
    memoryFreeBytes: z.number().int().nonnegative(),
  })
  .strict()
  .refine(snapshot => snapshot.memoryFreeBytes <= snapshot.memoryTotalBytes, 'Free memory cannot exceed total memory.')

const resourceProbeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: resourceSnapshotSchema }),
  z.object({ ok: z.literal(false), code: z.string().max(128), message: z.string().max(512) }),
])

const resourcePoolEntrySchema = z.object({
  hostId: idSchema,
  hostName: z.string().min(1).max(120),
  runtimeId: idSchema.nullable(),
  destination: z
    .object({ kind: z.literal('runtime'), runtimeId: idSchema })
    .strict()
    .nullable(),
  hidden: z.boolean(),
  probe: resourceProbeSchema,
  stale: z.boolean(),
  refreshing: z.boolean(),
})

const resourceSelectionSchema = z.object({
  hostId: idSchema,
  hostName: z.string().min(1).max(120),
  runtimeId: idSchema,
  score: z.number().finite().nonnegative(),
})

const resourcePoolSchema = z.object({ hosts: z.array(resourcePoolEntrySchema).max(64), selected: resourceSelectionSchema.nullable() }).strict()

const failedSchema = failureSchema.extend({ ok: z.literal(false) })
const runtimeRegistrationSchema = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), runtime: runtimeSummarySchema }), failedSchema])
const remoteHomeSchema = z
  .string()
  .trim()
  .min(2)
  .max(1024)
  .regex(/^\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/)
const sshTargetSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/)
const connectionTestStepSchema = z.object({
  step: z.enum(['ssh', 'runtime', 'identity']),
  ok: z.boolean(),
  ms: z.number().int().nonnegative(),
  code: z.string().optional(),
  message: z.string().optional(),
})
const directoryEntrySchema = z.object({ name: z.string(), path: z.string(), hidden: z.boolean() })
const directoryListingSchema = z.object({
  path: z.string(),
  home: z.string(),
  crumbs: z.array(directoryEntrySchema),
  entries: z.array(directoryEntrySchema),
  truncated: z.boolean(),
})
const fileReferenceCandidateSchema = z.object({ path: z.string().max(4096), kind: z.enum(['file', 'directory']) })
const encodedFileDataSchema = z
  .string()
  .max(32_000_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
export const fileUploadValueSchema = z.custom<FileUploadValue>(
  value =>
    z
      .object({
        receiptId: z.string().min(1).max(256),
        file: z
          .object({
            attachmentId: z.string().min(1).max(256),
            name: z.string().max(1024),
            bytes: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict()
      .safeParse(value).success,
)
const modelSelectionSchema = z.object({
  provider: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  reasoningEffort: z.string().min(1).max(128).optional(),
})
const modelCatalogModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  reasoning: z
    .object({
      efforts: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() })),
      defaultEffort: z.string().optional(),
    })
    .optional(),
})
const modelCatalogGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  models: z.array(modelCatalogModelSchema),
})
const modelCatalogFailureSchema = z.object({ id: z.string(), name: z.string(), message: z.string() })
const transcriptEntrySchema = z.object({
  seq: z.number().int(),
  kind: z.enum(['user', 'assistant', 'tool', 'status']),
  text: z.string(),
})
const transcriptWaitingSchema = z.object({
  kind: z.enum(['question', 'tool']),
  tool: z.string(),
  since: z.number().int(),
})
const remoteThreadSchema = z.object({
  runtimeId: idSchema,
  sessionId: sessionIdSchema,
  cwd: z.string(),
  title: z.string(),
  createdAt: z.string().datetime(),
  hostName: z.string(),
  connected: z.boolean(),
})
/** jj-integration methods a manager may call on a remote runtime; the folder and bookmark pickers need these. */
const remotePluginMethodSchema = z.enum(['projects', 'classifyWorkspaces', 'destination', 'provision', 'noFolder'])
export const jjRevisionSchema = z
  .object({
    changeId: z.string(),
    commitId: z.string(),
    description: z.string(),
    conflict: z.boolean(),
  })
  .strip()

export const jjThreadSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    workspaceId: z.string().nullable(),
    workspaceTitle: z.string().optional(),
    sessionIds: z.array(z.string()).max(10_000),
    finished: z.boolean(),
    canRebase: z.boolean().optional(),
    missing: z.boolean(),
    behind: z.boolean(),
    behindCount: z.number().int().nonnegative().optional(),
    rebasedAt: z.number().int().nonnegative().optional(),
    rebasedTipChangeId: z.string().min(1).max(128).optional(),
    integrationQueuedAt: z.number().int().nonnegative().optional(),
    integrationQueueEvents: z
      .array(z.object({ at: z.number().int().nonnegative(), kind: z.enum(['queued', 'unqueued']) }).strict())
      .max(10_000)
      .optional(),
    integrations: z
      .array(z.object({ at: z.number().int().nonnegative(), tipChangeId: z.string().min(1).max(128).optional() }).strict())
      .max(10_000)
      .optional(),
    unlanded: z.array(jjRevisionSchema).max(10_000),
  })
  .strip()

export const jjRepositorySchema = z
  .object({
    repoRoot: z.string().max(4096),
    title: z.string().max(512),
    workspaceId: z.string().nullable(),
    bookmarks: z.array(z.string().max(512)).max(10_000).default([]),
    threads: z.array(jjThreadSchema).max(10_000),
  })
  .strip()

export const jjRepositoriesSchema = z
  .object({
    repositories: z.array(jjRepositorySchema).max(200),
    refreshing: z.boolean().optional(),
    refreshFailed: z.boolean().optional(),
  })
  .strip()
export type JjRevisionView = z.infer<typeof jjRevisionSchema>
export type JjThreadView = z.infer<typeof jjThreadSchema>
export type JjRepositoryView = z.infer<typeof jjRepositorySchema>

export const nativeRpcSchema = nativeRpcRequestSchema

const nativeValueSchema = z.union([
  z
    .object({
      items: z
        .array(
          z
            .object({
              sessionId: sessionIdSchema,
              updatedAt: z.number().finite(),
              running: z.boolean(),
              blank: z.boolean(),
              agentAvailable: z.boolean().optional(),
              cwd: z.string().optional(),
            })
            .passthrough(),
        )
        .max(10_000),
    })
    .passthrough(),
  z.object({ items: z.array(z.object({ sessionId: sessionIdSchema, snippet: z.string() }).passthrough()).max(10_000), hasMore: z.boolean() }).passthrough(),
  z.object({ sessionId: sessionIdSchema, agentPreset: z.string().optional() }).passthrough(),
  z.object({ accepted: z.literal(true) }).passthrough(),
  z.object({ title: z.string(), seq: z.number().finite() }).passthrough(),
  z.object({ records: z.array(jsonValueSchema).max(10_000), hasMore: z.boolean() }).passthrough(),
  z.object({ archivedSessionIds: z.array(sessionIdSchema).max(10_000) }).passthrough(),
])

export const nativeRpcResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: nativeValueSchema }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }).strict(),
])

const remotePathSchema = z
  .string()
  .trim()
  .min(2)
  .max(4096)
  .regex(/^\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/u)
const cloneDestinationSchema = z.union([
  remotePathSchema,
  z
    .string()
    .trim()
    .min(3)
    .max(4096)
    .regex(/^~\/(?!\.\.(?:\/|$))(?!.*\/\.\.(?:\/|$)).+$/u),
])
const localProjectPathSchema = z.string().trim().min(1).max(4096)
const localProjectFilePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(path => !path.includes('\0') && !path.startsWith('/') && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..'))
const repositoryUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .regex(
    /^(?:https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?:\.git)?|git@[A-Za-z0-9.-]+:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?:\.git)?)$/u,
  )
const cloneProjectInputSchema = z
  .object({
    runtimeId: idSchema,
    repositoryUrl: repositoryUrlSchema,
    destinationPath: cloneDestinationSchema,
    copyFromPath: localProjectPathSchema.optional(),
    copyPaths: z.array(localProjectFilePathSchema).max(128).optional(),
    includeIgnored: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.copyFromPath === undefined) !== (input.copyPaths === undefined)) {
      context.addIssue({ code: 'custom', message: 'Local source folder and selected file list must be supplied together.' })
    }
    if (input.includeIgnored === true && input.copyFromPath === undefined) {
      context.addIssue({ code: 'custom', message: 'Scanning ignored files requires an explicit local source folder.' })
    }
  })

const profileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)

const semanticVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)

const repositorySchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^(?:https:\/\/[^\s]+|git@[^\s]+|ssh:\/\/[^\s]+)$/u)

const provisionStepSchema = z.enum(['node', 'checkout', 'install', 'build', 'cli', 'profile', 'runtime'])

const remoteNodeSchema = z.object({
  path: z.string().optional(),
  version: z.string().optional(),
  resolved: z.string().optional(),
  nix: z.boolean(),
})

const remoteFactsSchema = z.object({
  uname: z.string(),
  osVersion: z.string().optional(),
  user: z.string().optional(),
  home: z.string().optional(),
  node: remoteNodeSchema,
  fnm: z.object({ path: z.string().optional(), nodes: z.array(z.object({ version: z.string(), path: z.string() })) }),
  dsh: z.object({ path: z.string().optional(), version: z.string().optional() }),
  jj: z.object({ path: z.string().optional(), version: z.string().optional() }),
  pnpm: z.object({ path: z.string().optional(), version: z.string().optional() }),
  launch: z.object({ files: z.array(z.string()), port: z.number().int().optional(), pid: z.number().int().optional() }),
  profile: z.object({ path: z.string(), exists: z.boolean(), pluginLinks: z.number().int(), coreVersion: z.string().optional() }),
  checkout: z.object({
    path: z.string(),
    exists: z.boolean(),
    installed: z.boolean(),
    built: z.boolean(),
    changeId: z.string().optional(),
    commitId: z.string().optional(),
    description: z.string().optional(),
    conflicts: z.number().int(),
    mainOrigin: z.string().optional(),
  }),
})

const remoteDiagnosticSchema = z.object({ code: z.string().max(128), severity: z.enum(['error', 'warning', 'info']), message: z.string().max(2048) })

const remoteExecOutputSchema = z.object({
  ok: z.literal(true),
  code: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  durationMs: z.number().int().nonnegative(),
})

const provisionPlanStepSchema = z.object({
  id: provisionStepSchema,
  title: z.string(),
  state: z.enum(['done', 'pending', 'blocked']),
  reason: z.string(),
  commands: z.array(z.string()),
})

const provisionStepRunSchema = z.object({
  id: provisionStepSchema,
  ok: z.boolean(),
  state: z.enum(['ran', 'failed', 'skipped', 'blocked']),
  detail: z.string(),
  stdout: z.string(),
  stderr: z.string(),
})

const remoteRuntimeStatusSchema = z.object({
  running: z.boolean(),
  port: z.number().int().optional(),
  pid: z.number().int().optional(),
  command: z.string().optional(),
  listening: z.boolean(),
  launchFiles: z.array(z.string()),
  logFile: z.string(),
  logBytes: z.number().int().optional(),
})

const checkoutSyncPlanSchema = z.object({
  path: z.string(),
  bookmark: z.string(),
  upToDate: z.boolean(),
  reason: z.string(),
  commands: z.array(z.string()),
})

export const multiHostApi = defineApi({
  id: 'multi-host',
  version: 1,
  owner: '@dshfiles/multi-host',
  methods: {
    identity: method({
      input: z.void(),
      output: runtimeIdentitySchema,
      description: 'Identity of this DSH runtime as other hosts see it. Read-only.',
      tool: { name: 'multi_host_identity', readOnly: true, render: compactJson },
    }),
    resourceSnapshot: method({
      input: z.void(),
      output: resourceSnapshotSchema,
      description: 'Read CPU load and memory capacity for this DSH machine. Read-only.',
      tool: { name: 'multi_host_resource_snapshot', readOnly: true, render: compactJson },
    }),
    resourcePool: method({
      input: z.void(),
      output: resourcePoolSchema,
      description: 'Read resource snapshots for registered hosts and the least-pressured eligible remote destination. Read-only.',
      tool: { name: 'multi_host_resource_pool', readOnly: true, render: compactJson },
    }),
    list: method({
      input: z.void(),
      output: z.object({ hosts: z.array(hostSummarySchema), runtimes: z.array(runtimeSummarySchema) }),
      description:
        'List the machines (hosts) this DSH can run threads on and their DSH runtimes: connector, remote home, whether a connection is open, and the last error. Read-only.',
      tool: { name: 'multi_host_list', readOnly: true },
    }),
    hostUpsert: method({
      input: z.object({ id: idSchema, name: z.string().min(1).max(120), connector: hostConnectorSchema }).strict(),
      output: hostSummarySchema,
    }),
    hostRemove: method({
      input: z.object({ id: idSchema, removeDirectory: z.boolean() }).strict(),
      output: z.object({ removed: z.boolean() }),
      description:
        'Remove one host record, optionally deleting its directory on that machine; its threads are kept. Call only when the user asked to remove that host.',
      tool: { name: 'multi_host_remove_host', render: compactJson },
    }),
    hostSetHidden: method({
      input: z.object({ id: idSchema, hidden: z.boolean() }).strict(),
      output: hostSummarySchema,
      description:
        'Hide or show one host in the destination picker without removing it: its runtimes, threads and remote data stay. Call only when the user asked to hide or show that host.',
      tool: { name: 'multi_host_set_host_hidden', render: compactJson },
    }),
    hostReorder: method({
      input: z.object({ ids: z.array(idSchema).min(1).max(64) }).strict(),
      output: z.object({ hosts: z.array(hostSummarySchema) }),
      description:
        'Reorder the hosts: pass every host id exactly once, in the order the picker page should list them. Call only when the user asked to reorder hosts.',
      tool: { name: 'multi_host_reorder_hosts', render: compactJson },
    }),
    sshConfigHosts: method({
      input: z.void(),
      output: z.object({ hosts: z.object({ aliases: z.array(z.string()), knownHosts: z.array(z.string()) }) }),
      description: 'SSH aliases from the local ssh config and known_hosts entries, as suggestions when adding a host. Read-only.',
      tool: { name: 'multi_host_ssh_hosts', readOnly: true, render: compactJson },
    }),
    discoverHomes: method({
      input: z.object({ sshTarget: sshTargetSchema }).strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), homes: z.array(z.object({ path: z.string(), source: z.enum(['multi-host', 'web-url']) })) }),
        failedSchema,
      ]),
      description: 'Look for DSH homes on a host over SSH, the way the add-host dialog does. Call only when the user asked to set that host up.',
      tool: { name: 'multi_host_find_homes', render: compactJson },
    }),
    testConnection: method({
      input: z.object({ name: z.string().trim().min(1).max(120), sshTarget: sshTargetSchema, remoteHome: remoteHomeSchema }).strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), steps: z.array(connectionTestStepSchema), identity: runtimeIdentitySchema }),
        failedSchema,
      ]),
      description:
        'Run the stepwise connection test for one host configuration (ssh, then runtime, then identity). Call only when the user asked to test that host.',
      tool: { name: 'multi_host_test', render: compactJson },
    }),
    saveSshHost: method({
      input: z
        .object({ hostId: idSchema.optional(), name: z.string().trim().min(1).max(120), sshTarget: sshTargetSchema, remoteHome: remoteHomeSchema })
        .strict(),
      output: runtimeRegistrationSchema,
      description:
        'Add or edit an SSH host: its name, ssh target and the remote DSH home to register. Call only when the user asked to add or change that host.',
      tool: { name: 'multi_host_save_ssh_host', render: compactJson },
    }),
    runtimeUpsert: method({
      input: z
        .object({
          hostId: idSchema,
          name: z.string().min(1).max(120),
          locator: runtimeLocatorSchema,
        })
        .strict(),
      output: runtimeRegistrationSchema,
    }),
    runtimeStatus: method({
      input: z.object({ runtimeId: idSchema }).strict(),
      output: runtimeStatusSchema,
      description:
        'Connection state of one remote DSH runtime: whether a connection is open, the last error, and when it was last seen. A cold or stale result returns immediately while one coalesced background refresh runs. Read-only.',
      tool: { name: 'multi_host_status', readOnly: true, render: compactJson },
    }),
    /** Connect if needed and round-trip once; the chip menu shows the latency as the host's status. */
    runtimePing: method({
      input: z.object({ runtimeId: idSchema }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), ms: z.number().int().nonnegative() }), failedSchema]),
    }),
    runtimeReconnect: method({
      input: z.object({ runtimeId: idSchema }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true) }), failedSchema]),
      description: 'Drop and reopen the pooled connection to one remote runtime. Call only when the user asked to reconnect it.',
      tool: { name: 'multi_host_reconnect', render: compactJson },
    }),
    /** This runtime's own folders; a manager calls it on a remote runtime to browse that machine. */
    listDirectory: method({
      input: z.object({ path: z.string().min(1).max(4096).optional() }).strict(),
      output: directoryListingSchema,
    }),
    createDirectory: method({
      input: z.object({ path: z.string().min(1).max(4096), name: z.string().min(1).max(255) }).strict(),
      output: z.object({ path: z.string() }),
    }),
    runtimeCreateDirectory: method({
      input: z.object({ runtimeId: idSchema, path: z.string().min(1).max(4096), name: z.string().min(1).max(255) }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), path: z.string() }), failedSchema]),
      description: 'Create one folder on a remote runtime. Call only when the user asked to create that folder.',
      tool: { name: 'multi_host_mkdir', render: compactJson },
    }),
    /** Register a folder as a workspace on the runtime, so its jj-integration can describe and isolate it. */
    runtimeOpenFolder: method({
      input: z.object({ runtimeId: idSchema, path: z.string().min(1).max(4096) }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), workspaceId: z.string(), path: z.string() }), failedSchema]),
      description:
        'Register a folder on a remote runtime as a workspace, so the remote jj-integration can describe and isolate it. Call only when the user asked to open that folder there.',
      tool: { name: 'multi_host_open_folder', render: compactJson },
    }),
    localProjectFiles: method({
      input: z.object({ path: localProjectPathSchema, includeIgnored: z.boolean().optional() }).strict(),
      output: z.discriminatedUnion('ok', [
        z.object({
          ok: z.literal(true),
          root: z.string(),
          files: z.array(
            z
              .object({
                path: z.string(),
                bytes: z.number().int().nonnegative(),
                ignored: z.boolean(),
                copyable: z.boolean(),
                copyReason: z.enum(['potential-secret', 'too-large']).optional(),
              })
              .strict(),
          ),
          truncated: z.boolean(),
        }),
        failedSchema,
      ]),
      description:
        'List untracked files under one local Git project without reading contents. Ignored files appear only when includeIgnored is explicitly true; credential-like paths are marked non-copyable. Read-only.',

      tool: { name: 'multi_host_local_project_files', readOnly: true, render: compactJson },
    }),
    runtimeCloneProject: method({
      input: cloneProjectInputSchema,
      output: z.discriminatedUnion('ok', [
        z.object({
          ok: z.literal(true),
          workspaceId: z.string(),
          path: z.string(),
          copiedFileCount: z.number().int().nonnegative().optional(),
          copyWarning: z.string().max(2048).optional(),
        }),
        failedSchema,
      ]),
      description:
        'Clone a Git repository to one remote host and register the clone as a project workspace. Optionally copy individually selected local files; ignored files require includeIgnored: true, no file is selected automatically, and credential-like paths are blocked. Call only when the user asked to clone there.',
      tool: { name: 'multi_host_clone_project', render: compactJson },
    }),
    runtimeBrowse: method({
      input: z.object({ runtimeId: idSchema, path: z.string().min(1).max(4096).optional() }).strict(),
      output: z.discriminatedUnion('ok', [directoryListingSchema.extend({ ok: z.literal(true) }), failedSchema]),
      description: 'List folders on a remote runtime at one path (default: the runtime home), for choosing where a remote thread runs. Read-only.',
      tool: { name: 'multi_host_browse', readOnly: true, render: compactJson },
    }),
    runtimePluginCall: method({
      input: z.object({ runtimeId: idSchema, method: remotePluginMethodSchema, input: jsonValueSchema }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), value: z.unknown() }), failedSchema]),
    }),
    runtimeModels: method({
      input: z.object({ runtimeId: idSchema }).strict(),
      output: z.discriminatedUnion('ok', [
        z.object({
          ok: z.literal(true),
          default: modelSelectionSchema.nullable(),
          routableProviders: z.array(z.string()),
          groups: z.array(modelCatalogGroupSchema),
          failures: z.array(modelCatalogFailureSchema),
        }),
        failedSchema,
      ]),
      description:
        "The provider-grouped model catalog of one remote runtime, including adapter reasoning efforts, so remote thread composers can use that Host's model choices. Read-only.",
      tool: { name: 'multi_host_models', readOnly: true, render: compactJson },
    }),
    sessionRuntime: method({
      input: z.object({ sessionId: brandedSessionIdSchema }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), runtimeId: idSchema.nullable() }), failedSchema]),
      description: 'Return the known runtime for a Session already claimed by a source, or null when no runtime is known.',
    }),
    sessionJjRepositories: method({
      input: z.object({ sessionId: brandedSessionIdSchema }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), repositories: jjRepositoriesSchema }), failedSchema]),
      description: 'Read JJ repository and thread-workspace status from the runtime that owns this mirrored Session. Read-only.',
      tool: { name: 'multi_host_session_jj_repositories', readOnly: true, render: compactJson },
    }),
    runtimeFileReferences: method({
      input: z.object({ runtimeId: idSchema, sessionId: brandedSessionIdSchema, query: z.string().max(4096) }).strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), candidates: z.array(fileReferenceCandidateSchema.strict()).max(1000) }),
        failedSchema,
      ]),
      description: 'List file and directory mentions for one remote Session cwd. Read-only.',
      tool: { name: 'multi_host_file_references', readOnly: true, render: compactJson },
    }),
    sessionUploadFile: method({
      input: z
        .object({
          runtimeId: idSchema,
          sessionId: brandedSessionIdSchema,
          data: encodedFileDataSchema,
          name: z.string().max(1024).optional(),
        })
        .strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), value: fileUploadValueSchema }), failedSchema]),
      description: 'Stage one file attachment up to 24 MB for a remote Session. This is a non-replayable mutation.',
    }),
    threadCreate: method({
      input: z.object({ runtimeId: idSchema, cwd: z.string().min(1).max(4096) }).strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), sessionId: sessionIdSchema }),
        failedSchema.extend({ sessionId: sessionIdSchema.optional() }),
      ]),
      description:
        'Create an empty thread on one remote runtime and open it in the native chat composer. Call only when the user asked to start a thread on that machine.',
      tool: { name: 'multi_host_create_thread', render: compactJson },
    }),
    threadStart: method({
      input: z
        .object({
          runtimeId: idSchema,
          cwd: z.string().min(1).max(4096),
          text: z.string().trim().min(1).max(100_000),
          agentPreset: z.string().max(128).optional(),
          model: modelSelectionSchema.optional(),
        })
        .strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), sessionId: sessionIdSchema }),
        failedSchema.extend({ sessionId: sessionIdSchema.optional() }),
      ]),
      description:
        'Start a thread on one remote runtime: its directory, the first message, and optionally an agent preset and model. Call only when the user asked to start a thread on that machine.',
      tool: { name: 'multi_host_start_thread', render: compactJson },
    }),
    /** The latest messages of a remote thread, reduced to text, for the local remote-thread view. */
    threadTranscript: method({
      input: z.object({ runtimeId: idSchema, sessionId: sessionIdSchema, maxMessages: z.number().int().min(1).max(200).optional() }).strict(),
      output: z.discriminatedUnion('ok', [
        z.object({
          ok: z.literal(true),
          cursor: z.number().int(),
          cwd: z.string().optional(),
          title: z.string().optional(),
          running: z.boolean(),
          model: modelSelectionSchema.optional(),
          waiting: transcriptWaitingSchema.optional(),
          entries: z.array(transcriptEntrySchema),
        }),
        failedSchema,
      ]),
      description: 'The latest messages of one remote thread, reduced to text, with its cursor, directory, title, running state and model. Read-only.',
      tool: { name: 'multi_host_thread_transcript', readOnly: true, render: compactJson },
    }),
    threadList: method({
      input: z.void(),
      output: z.object({ threads: z.array(remoteThreadSchema) }),
      description: 'Every thread this DSH started on remote runtimes, with its host, Session, title and state. Read-only.',
      tool: { name: 'multi_host_threads', readOnly: true, render: compactJson },
    }),
    threadForget: method({
      input: z.object({ runtimeId: idSchema, sessionId: sessionIdSchema.optional() }).strict(),
      output: z.object({ removed: z.number().int().nonnegative() }),
      description:
        'Forget the local records of remote threads (one Session, or every thread on a runtime). The remote threads keep running. Call only when the user asked to forget them.',
      tool: { name: 'multi_host_forget_thread', render: compactJson },
    }),
    /** Reply on one remote thread. Steer when it is running, otherwise queue. */
    threadReply: method({
      input: z
        .object({
          runtimeId: idSchema,
          sessionId: sessionIdSchema,
          text: z.string().trim().min(1).max(100_000),
          steer: z.boolean().default(false),
        })
        .strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true) }), failedSchema]),
      description:
        'Send a message to one thread running on another machine: it queues the message, or steers the running turn when steer is true. Call only when the user asked to reply on that thread.',
      tool: {
        name: 'multi_host_thread_reply',
        render: output => (output.ok ? 'Sent to the remote thread.' : `Failed: ${output.message}`),
      },
    }),
    /** Stop one remote thread through the same cancel path the local Stop uses. */
    threadStop: method({
      input: z.object({ runtimeId: idSchema, sessionId: sessionIdSchema }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true) }), failedSchema]),
      description:
        'Stop the running turn of one thread on another machine, through the same cancel path its Stop button uses. Call only when the user asked to stop that thread.',
      tool: {
        name: 'multi_host_thread_stop',
        render: output => (output.ok ? 'Asked the remote thread to stop.' : `Failed: ${output.message}`),
      },
    }),

    remoteExec: method({
      input: z
        .object({
          sshTarget: sshTargetSchema,
          command: z.string().trim().min(1).max(2000),
          cwd: remotePathSchema.optional(),
          timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
        })
        .strict(),
      output: z.discriminatedUnion('ok', [remoteExecOutputSchema, failedSchema]),
      description:
        'Run one bounded command on an SSH host and return its exit code, stdout and stderr (120 s at most). Call only when the user asked to run something on that machine.',
      tool: { name: 'multi_host_exec', render: compactJson },
    }),
    doctor: method({
      input: z
        .object({
          sshTarget: sshTargetSchema,
          profile: profileNameSchema.default('web'),
          checkoutPath: remotePathSchema.optional(),
          dshVersion: semanticVersionSchema.optional(),
        })
        .strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), facts: remoteFactsSchema, diagnostics: z.array(remoteDiagnosticSchema) }),
        failedSchema,
      ]),
      description:
        'Report what one SSH host has for DSH: node (and whether it is the Nix build DSH cannot boot), fnm, jj, pnpm, dsh, profile core version, checkout revision and any running runtime, plus the diagnostics worth acting on. Read-only.',
      tool: { name: 'multi_host_doctor', readOnly: true, render: compactJson },
    }),
    provision: method({
      input: z
        .object({
          sshTarget: sshTargetSchema,
          remoteHome: remoteHomeSchema,
          checkoutPath: remotePathSchema.optional(),
          profile: profileNameSchema.default('web'),
          repository: repositorySchema,
          revision: z.string().trim().min(1).max(128).optional(),
          dshVersion: semanticVersionSchema,
          nodeVersion: z.string().trim().min(1).max(32).default('22.23.3'),
          steps: z.array(provisionStepSchema).min(1).default(['node', 'checkout', 'install', 'build', 'cli', 'profile', 'runtime']),
          confirm: z.enum(['all', 'next']).default('next'),
          dryRun: z.boolean().default(false),
        })
        .strict(),
      output: z.discriminatedUnion('ok', [
        z.object({
          ok: z.literal(true),
          plan: z.array(provisionPlanStepSchema),
          executed: z.array(provisionStepRunSchema),
          remaining: z.array(provisionStepSchema),
        }),
        failedSchema,
      ]),
      description:
        'Install and start DSH on an SSH host: official Node through fnm, the dshfiles checkout, its dependencies and build, the dsh CLI, the web profile and a headless runtime. dryRun only plans. confirm "next" (default) runs one step per call, so each step is its own opt-in; "all" runs every named step. Call only when the user asked to provision that machine.',
      tool: { name: 'multi_host_provision', render: compactJson },
    }),
    remoteRuntimeStatus: method({
      input: z.object({ sshTarget: sshTargetSchema, remoteHome: remoteHomeSchema.optional() }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), status: remoteRuntimeStatusSchema }), failedSchema]),
      description: 'Whether a DSH runtime answers on one SSH host: its launch file, port, pid, process command and log size. Read-only.',
      tool: { name: 'multi_host_runtime_status', readOnly: true, render: compactJson },
    }),
    runtimeControl: method({
      input: z
        .object({
          sshTarget: sshTargetSchema,
          remoteHome: remoteHomeSchema.optional(),
          action: z.enum(['start', 'stop']),
          checkoutPath: remotePathSchema.optional(),
          profile: profileNameSchema.default('web'),
        })
        .strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), action: z.enum(['start', 'stop']), detail: z.string(), status: remoteRuntimeStatusSchema }),
        failedSchema,
      ]),
      description:
        'Start or stop the headless DSH runtime on one SSH host (start uses an official Node build and a free loopback port; stop refuses a process that is not that machine DSH web). Call only when the user asked to start or stop it.',
      tool: { name: 'multi_host_runtime_control', render: compactJson },
    }),
    runtimeLogs: method({
      input: z.object({ sshTarget: sshTargetSchema, remoteHome: remoteHomeSchema.optional(), lines: z.number().int().min(1).max(400).default(200) }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), logFile: z.string(), tail: z.string() }), failedSchema]),
      description: 'Read the tail of the headless DSH runtime log on one SSH host (400 lines at most). Read-only.',
      tool: { name: 'multi_host_runtime_logs', readOnly: true, render: compactJson },
    }),
    checkoutSync: method({
      input: z
        .object({
          sshTarget: sshTargetSchema,
          path: remotePathSchema,
          bookmark: z.string().trim().min(1).max(128).default('main'),
          apply: z.boolean().default(false),
        })
        .strict(),
      output: z.discriminatedUnion('ok', [
        z.object({
          ok: z.literal(true),
          applied: z.boolean(),
          detail: z.string(),
          plan: checkoutSyncPlanSchema,
          stdout: z.string(),
          stderr: z.string(),
        }),
        failedSchema,
      ]),
      description:
        'Fetch and rebase one checkout on an SSH host onto its bookmark origin, keeping that machine edits. Without apply it only reports the commands. Call only when the user asked to update that checkout.',
      tool: { name: 'multi_host_checkout_sync', render: compactJson },
    }),
    runtimeCall: method({
      input: z.object({ runtimeId: idSchema, request: nativeRpcSchema }).strict(),
      output: nativeRpcResultSchema,
    }),
    sessionCursor: method({
      input: z.object({ runtimeId: idSchema, sessionId: z.string().min(1) }).strict(),
      output: z.object({ cursor: z.number().int().safe().min(-1) }),
    }),
    runtimeOpenView: method({
      input: z.object({ runtimeId: idSchema }).strict(),
      output: z.object({ leaseId: z.string().uuid(), launchUrl: z.string().url() }),
    }),
    runtimeCloseView: method({
      input: z.object({ leaseId: z.string().uuid() }).strict(),
      output: z.object({ closed: z.boolean() }),
    }),
    runtimeRemove: method({
      input: z.object({ runtimeId: idSchema }).strict(),
      output: z.object({ removed: z.boolean() }),
      description: 'Remove one runtime registration from a host. Call only when the user asked to remove it.',
      tool: { name: 'multi_host_remove_runtime', render: compactJson },
    }),
  },
})

export type HostSummary = z.infer<typeof hostSummarySchema>
export type ConnectionTestStep = z.infer<typeof connectionTestStepSchema>
export type RemoteThreadSummary = z.infer<typeof remoteThreadSchema>
export type DirectoryListing = z.infer<typeof directoryListingSchema>
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>
export type TranscriptWaiting = z.infer<typeof transcriptWaitingSchema>
export type ModelSelection = z.infer<typeof modelSelectionSchema>
export type RuntimeSummary = z.infer<typeof runtimeSummarySchema>
export type WorkspaceSummary = z.infer<typeof workspaceSchema>
export type SessionSummary = z.infer<typeof sessionSchema>
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>
export type ResourceSnapshot = z.infer<typeof resourceSnapshotSchema>
export type ResourceProbe = z.infer<typeof resourceProbeSchema>
export type ResourcePoolEntry = z.infer<typeof resourcePoolEntrySchema>
export type ResourceSelection = z.infer<typeof resourceSelectionSchema>
export type ResourcePool = z.infer<typeof resourcePoolSchema>
export type NativeRpcRequest = z.infer<typeof nativeRpcSchema>
export type NativeRpcResult = z.infer<typeof nativeRpcResultSchema>
