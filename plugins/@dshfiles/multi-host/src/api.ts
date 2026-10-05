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

const runtimeSummarySchema = z.object({
  id: idSchema,
  hostId: idSchema,
  name: z.string(),
  identity: runtimeIdentitySchema.nullable(),
  lastSeenAt: z.string().datetime().optional(),
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
    host: hostSummarySchema,
    runtime: runtimeSummarySchema,
    identity: runtimeIdentitySchema,
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

const runtimeRegistrationSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), runtime: runtimeSummarySchema }).strict(),
  z.object({ ok: z.literal(false), code: z.string().min(1).max(128), message: z.string().max(2048) }).strict(),
])

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
    runtimeList: method({
      input: z.object({ hostId: idSchema.optional() }).strict(),
      output: z.object({ runtimes: z.array(runtimeSummarySchema) }),
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
    workspaceOpen: method({
      input: z
        .object({
          runtimeId: idSchema,
          path: z
            .string()
            .min(1)
            .max(1024)
            .refine(path => path.startsWith('/')),
        })
        .strict(),
      output: workspaceSchema,
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
export type RuntimeSummary = z.infer<typeof runtimeSummarySchema>
export type WorkspaceSummary = z.infer<typeof workspaceSchema>
export type SessionSummary = z.infer<typeof sessionSchema>
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>
export type NativeRpcRequest = z.infer<typeof nativeRpcSchema>
export type NativeRpcResult = z.infer<typeof nativeRpcResultSchema>
