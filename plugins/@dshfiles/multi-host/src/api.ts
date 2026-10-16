import { defineApi, method } from '@dshfiles/dshx/api'
import { nativeRpcRequestSchema } from '@dshfiles/dshx/platform/native-rpc'
import { z } from 'zod'
import { hostConnectorSchema, runtimeIdentitySchema, runtimeLocatorSchema } from './records.js'

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

const idSchema = z.string().min(1).max(64)
const sessionIdSchema = z.string().min(1).max(256)

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
)

const hostSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  connector: hostConnectorSchema,
  runtimeCount: z.number().int().nonnegative(),
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
  }),
  z.object({
    ok: z.literal(false),
    hostId: idSchema,
    runtimeId: idSchema,
    code: z.string(),
    message: z.string(),
    stale: z.literal(true),
    lastSeenAt: z.string().datetime().optional(),
  }),
])

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
const modelSelectionSchema = z.object({ provider: z.string().min(1).max(128), model: z.string().min(1).max(256) })
const transcriptEntrySchema = z.object({
  seq: z.number().int(),
  kind: z.enum(['user', 'assistant', 'tool', 'status']),
  text: z.string(),
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
      description: 'Connection state of one remote DSH runtime: whether a connection is open, the last error, and when it was last seen. Read-only.',
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
          groups: z.array(z.object({ id: z.string(), name: z.string(), models: z.array(z.object({ id: z.string(), name: z.string() })) })),
        }),
        failedSchema,
      ]),
      description:
        'The provider-grouped model catalog of one remote runtime with its default model, so a remote thread can be started on a chosen model. Read-only.',
      tool: { name: 'multi_host_models', readOnly: true, render: compactJson },
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
export type ModelSelection = z.infer<typeof modelSelectionSchema>
export type RuntimeSummary = z.infer<typeof runtimeSummarySchema>
export type WorkspaceSummary = z.infer<typeof workspaceSchema>
export type SessionSummary = z.infer<typeof sessionSchema>
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>
export type NativeRpcRequest = z.infer<typeof nativeRpcSchema>
export type NativeRpcResult = z.infer<typeof nativeRpcResultSchema>
