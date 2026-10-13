import { defineApi, method } from '@dshfiles/dshx/api'
import { nativeRpcRequestSchema } from '@dshfiles/dshx/platform/native-rpc'
import { z } from 'zod'
import { hostConnectorSchema, runtimeIdentitySchema, runtimeLocatorSchema } from './records.js'

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
const remotePluginMethodSchema = z.enum(['projects', 'destination', 'provision', 'noFolder'])

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
    identity: method({ input: z.void(), output: runtimeIdentitySchema }),
    list: method({
      input: z.void(),
      output: z.object({ hosts: z.array(hostSummarySchema), runtimes: z.array(runtimeSummarySchema) }),
    }),
    hostUpsert: method({
      input: z.object({ id: idSchema, name: z.string().min(1).max(120), connector: hostConnectorSchema }).strict(),
      output: hostSummarySchema,
    }),
    hostRemove: method({
      input: z.object({ id: idSchema, removeDirectory: z.boolean() }).strict(),
      output: z.object({ removed: z.boolean() }),
    }),
    sshConfigHosts: method({ input: z.void(), output: z.object({ hosts: z.object({ aliases: z.array(z.string()), knownHosts: z.array(z.string()) }) }) }),
    discoverHomes: method({
      input: z.object({ sshTarget: sshTargetSchema }).strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), homes: z.array(z.object({ path: z.string(), source: z.enum(['multi-host', 'web-url']) })) }),
        failedSchema,
      ]),
    }),
    testConnection: method({
      input: z.object({ name: z.string().trim().min(1).max(120), sshTarget: sshTargetSchema, remoteHome: remoteHomeSchema }).strict(),
      output: z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), steps: z.array(connectionTestStepSchema), identity: runtimeIdentitySchema }),
        failedSchema,
      ]),
    }),
    saveSshHost: method({
      input: z
        .object({ hostId: idSchema.optional(), name: z.string().trim().min(1).max(120), sshTarget: sshTargetSchema, remoteHome: remoteHomeSchema })
        .strict(),
      output: runtimeRegistrationSchema,
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
    }),
    runtimeReconnect: method({
      input: z.object({ runtimeId: idSchema }).strict(),
      output: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true) }), failedSchema]),
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
    }),
    runtimeBrowse: method({
      input: z.object({ runtimeId: idSchema, path: z.string().min(1).max(4096).optional() }).strict(),
      output: z.discriminatedUnion('ok', [directoryListingSchema.extend({ ok: z.literal(true) }), failedSchema]),
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
    }),
    threadList: method({ input: z.void(), output: z.object({ threads: z.array(remoteThreadSchema) }) }),
    threadForget: method({
      input: z.object({ runtimeId: idSchema, sessionId: sessionIdSchema.optional() }).strict(),
      output: z.object({ removed: z.number().int().nonnegative() }),
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
