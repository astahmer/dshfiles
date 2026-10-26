import { z } from 'zod'
import { decodeJson, jsonValueSchema } from '../json.js'
import type { JsonValue } from './client.js'
import { DshPlatformError } from './client.js'
import { connectDshxApi } from './dshx-api.js'
import type { NativeRpcRequest } from './native-rpc.js'

const idSchema = z.string().min(1).max(64)
const profileSchema = z.string().min(1).max(64)
const connectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z.object({ kind: z.literal('ssh'), sshTarget: z.string().min(1).max(255) }).strict(),
])
const identitySchema = z
  .object({
    protocolVersion: z.literal(1),
    runtimeId: z.string().uuid(),
    profile: profileSchema,
    homeLeaf: z.string().min(1).max(128),
    dshVersion: z.string().min(1).max(80),
    capabilities: z.array(z.enum(['workspace', 'session', 'agent'])).max(8),
  })
  .strict()
const hostSummarySchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  connector: connectorSchema,
  runtimeCount: z.number().int().nonnegative(),
})
const runtimeSummarySchema = z.object({
  id: idSchema,
  hostId: idSchema,
  name: z.string().min(1).max(120),
  identity: identitySchema.nullable(),
  lastSeenAt: z.string().datetime().optional(),
})
const workspaceSchema = z.object({
  runtimeId: idSchema,
  workspaceId: z.string(),
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(z.string()),
})
const sessionSummarySchema = z.object({
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
    identity: identitySchema,
    workspaces: z.array(workspaceSchema),
    sessions: z.array(sessionSummarySchema),
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
const nativeRpcResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: jsonValueSchema }).strict(),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }).strict(),
])
const runtimeViewSchema = z.object({ leaseId: z.string().uuid(), launchUrl: z.string().url() }).strict()

const toJsonValue = (value: unknown): JsonValue => {
  try {
    return decodeJson(jsonValueSchema, JSON.stringify(value))
  } catch {
    throw new DshPlatformError('invalid-request', 'The multi-host request could not be represented as JSON.')
  }
}

export type HostConnector = z.infer<typeof connectorSchema>
export type RuntimeIdentity = z.infer<typeof identitySchema>
export type HostSummary = z.infer<typeof hostSummarySchema>
export type RuntimeSummary = z.infer<typeof runtimeSummarySchema>
export type WorkspaceSummary = z.infer<typeof workspaceSchema>
export type SessionSummaryRow = z.infer<typeof sessionSummarySchema>
export type RuntimeStatusValue = z.infer<typeof runtimeStatusSchema>
export type RuntimeRegistrationResult = z.infer<typeof runtimeRegistrationSchema>
export type NativeRpcResult = z.infer<typeof nativeRpcResultSchema>

export interface MultiHost {
  list(): Promise<{ readonly hosts: readonly HostSummary[]; readonly runtimes: readonly RuntimeSummary[] }>
  hostUpsert(input: { readonly id: string; readonly name: string; readonly connector: HostConnector }): Promise<HostSummary>
  hostRemove(id: string, removeDirectory?: boolean): Promise<{ readonly removed: boolean }>
  runtimeList(hostId?: string): Promise<{ readonly runtimes: readonly RuntimeSummary[] }>
  runtimeUpsert(input: {
    readonly hostId: string
    readonly name: string
    readonly locator: { readonly kind: 'local'; readonly launchUrl: string } | { readonly kind: 'ssh'; readonly unit: string; readonly remoteHome: string }
  }): Promise<RuntimeRegistrationResult>
  runtimeStatus(runtimeId: string): Promise<RuntimeStatusValue>
  workspaceOpen(runtimeId: string, path: string): Promise<WorkspaceSummary>
  runtimeCall(runtimeId: string, request: NativeRpcRequest, signal?: AbortSignal): Promise<NativeRpcResult>
  sessionCursor(runtimeId: string, sessionId: string): Promise<{ readonly cursor: number }>
  runtimeOpenView(runtimeId: string): Promise<{ readonly leaseId: string; readonly launchUrl: string }>
  runtimeCloseView(leaseId: string): Promise<{ readonly closed: boolean }>
  runtimeRemove(runtimeId: string): Promise<{ readonly removed: boolean }>
}

export const connectMultiHost = async (options: { readonly url?: string }): Promise<MultiHost> => {
  const call = await connectDshxApi({
    packageId: '@dshfiles/multi-host',
    apiId: 'multi-host',
    version: 1,
    ...(options.url !== undefined && { url: options.url }),
  })
  return {
    list: async () => z.object({ hosts: z.array(hostSummarySchema), runtimes: z.array(runtimeSummarySchema) }).parse(await call('list')),
    hostUpsert: async input => hostSummarySchema.parse(await call('hostUpsert', input)),
    hostRemove: async (id, removeDirectory = false) => z.object({ removed: z.boolean() }).parse(await call('hostRemove', { id, removeDirectory })),
    runtimeList: async hostId => z.object({ runtimes: z.array(runtimeSummarySchema) }).parse(await call('runtimeList', hostId === undefined ? {} : { hostId })),
    runtimeUpsert: async input => runtimeRegistrationSchema.parse(await call('runtimeUpsert', input)),
    runtimeStatus: async runtimeId => runtimeStatusSchema.parse(await call('runtimeStatus', { runtimeId })),
    workspaceOpen: async (runtimeId, path) => workspaceSchema.parse(await call('workspaceOpen', { runtimeId, path })),
    runtimeCall: async (runtimeId, request, signal) => nativeRpcResultSchema.parse(await call('runtimeCall', toJsonValue({ runtimeId, request }), signal)),
    sessionCursor: async (runtimeId, sessionId) =>
      z.object({ cursor: z.number().int().safe().min(-1) }).parse(await call('sessionCursor', { runtimeId, sessionId })),
    runtimeOpenView: async runtimeId => runtimeViewSchema.parse(await call('runtimeOpenView', { runtimeId })),
    runtimeCloseView: async leaseId => z.object({ closed: z.boolean() }).parse(await call('runtimeCloseView', { leaseId })),
    runtimeRemove: async runtimeId => z.object({ removed: z.boolean() }).parse(await call('runtimeRemove', { runtimeId })),
  }
}

export const multiHostConnectionError = (error: unknown): DshPlatformError =>
  error instanceof DshPlatformError
    ? error
    : new DshPlatformError('multi-host-unavailable', 'The multi-host API request failed. Check that the local DSH plugin is active and reconnect.')
