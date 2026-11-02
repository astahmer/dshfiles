import * as Schema from 'effect/Schema'
import { decodeJson, jsonValueSchema } from '../json.js'
import type { JsonValue } from './client.js'
import { DshPlatformError } from './client.js'
import { connectDshxApi } from './dshx-api.js'
import type { NativeRpcRequest } from './native-rpc.js'

const strictStruct = <const Fields extends Schema.Struct.Fields>(fields: Fields) => {
  const struct = Schema.Struct(fields)
  return Schema.decodeTo(struct)(
    Schema.StructWithRest(struct, [
      Schema.Record(Schema.String.check(Schema.makeFilter(key => !Object.prototype.hasOwnProperty.call(fields, key))), Schema.Never),
    ]),
  )
}
const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] => Schema.decodeUnknownSync(schema)(value)

const idSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
const profileSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
const connectorSchema = Schema.Union([
  strictStruct({ kind: Schema.Literal('local') }),
  strictStruct({ kind: Schema.Literal('ssh'), sshTarget: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)) }),
])
const identitySchema = strictStruct({
  protocolVersion: Schema.Literal(1),
  runtimeId: Schema.String.check(Schema.isUUID()),
  profile: profileSchema,
  homeLeaf: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  dshVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  capabilities: Schema.Array(Schema.Literals(['workspace', 'session', 'agent'])).check(Schema.isMaxLength(8)),
})
const hostSummarySchema = Schema.Struct({
  id: idSchema,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  connector: connectorSchema,
  runtimeCount: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
const isUtcDateTime = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19)
}
const runtimeSummarySchema = Schema.Struct({
  id: idSchema,
  hostId: idSchema,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  identity: Schema.NullOr(identitySchema),
  lastSeenAt: Schema.optional(Schema.String.check(Schema.makeFilter(isUtcDateTime))),
})
const workspaceSchema = Schema.Struct({
  runtimeId: idSchema,
  workspaceId: Schema.String,
  path: Schema.String,
  title: Schema.String,
  sessionIds: Schema.Array(Schema.String),
})
const sessionSummarySchema = Schema.Struct({
  runtimeId: idSchema,
  sessionId: Schema.String,
  cwd: Schema.optional(Schema.String),
  running: Schema.Boolean,
  blank: Schema.Boolean,
  updatedAt: Schema.Number.check(Schema.isFinite()),
})
const runtimeStatusSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    host: hostSummarySchema,
    runtime: runtimeSummarySchema,
    identity: identitySchema,
    workspaces: Schema.Array(workspaceSchema),
    sessions: Schema.Array(sessionSummarySchema),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    hostId: idSchema,
    runtimeId: idSchema,
    code: Schema.String,
    message: Schema.String,
    stale: Schema.Literal(true),
    lastSeenAt: Schema.optional(Schema.String.check(Schema.makeFilter(isUtcDateTime))),
  }),
])
const runtimeRegistrationSchema = Schema.Union([
  strictStruct({ ok: Schema.Literal(true), runtime: runtimeSummarySchema }),
  strictStruct({
    ok: Schema.Literal(false),
    code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
    message: Schema.String.check(Schema.isMaxLength(2048)),
  }),
])
const nativeRpcResultSchema = Schema.Union([
  strictStruct({ ok: Schema.Literal(true), value: jsonValueSchema }),
  strictStruct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])
const runtimeViewSchema = strictStruct({
  leaseId: Schema.String.check(Schema.isUUID()),
  launchUrl: Schema.String.check(Schema.makeFilter(value => URL.canParse(value))),
})

const toJsonValue = (value: unknown): JsonValue => {
  try {
    return decodeJson(jsonValueSchema, JSON.stringify(value))
  } catch {
    throw new DshPlatformError('invalid-request', 'The multi-host request could not be represented as JSON.')
  }
}

export type HostConnector = Schema.Schema.Type<typeof connectorSchema>
export type RuntimeIdentity = Schema.Schema.Type<typeof identitySchema>
export type HostSummary = Schema.Schema.Type<typeof hostSummarySchema>
export type RuntimeSummary = Schema.Schema.Type<typeof runtimeSummarySchema>
export type WorkspaceSummary = Schema.Schema.Type<typeof workspaceSchema>
export type SessionSummaryRow = Schema.Schema.Type<typeof sessionSummarySchema>
export type RuntimeStatusValue = Schema.Schema.Type<typeof runtimeStatusSchema>
export type RuntimeRegistrationResult = Schema.Schema.Type<typeof runtimeRegistrationSchema>
export type NativeRpcResult = Schema.Schema.Type<typeof nativeRpcResultSchema>

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
    list: async () => decode(Schema.Struct({ hosts: Schema.Array(hostSummarySchema), runtimes: Schema.Array(runtimeSummarySchema) }), await call('list')),
    hostUpsert: async input => decode(hostSummarySchema, await call('hostUpsert', input)),
    hostRemove: async (id, removeDirectory = false) => decode(Schema.Struct({ removed: Schema.Boolean }), await call('hostRemove', { id, removeDirectory })),
    runtimeList: async hostId =>
      decode(Schema.Struct({ runtimes: Schema.Array(runtimeSummarySchema) }), await call('runtimeList', hostId === undefined ? {} : { hostId })),
    runtimeUpsert: async input => decode(runtimeRegistrationSchema, await call('runtimeUpsert', input)),
    runtimeStatus: async runtimeId => decode(runtimeStatusSchema, await call('runtimeStatus', { runtimeId })),
    workspaceOpen: async (runtimeId, path) => decode(workspaceSchema, await call('workspaceOpen', { runtimeId, path })),
    runtimeCall: async (runtimeId, request, signal) => decode(nativeRpcResultSchema, await call('runtimeCall', toJsonValue({ runtimeId, request }), signal)),
    sessionCursor: async (runtimeId, sessionId) =>
      decode(
        Schema.Struct({
          cursor: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(-1)),
        }),
        await call('sessionCursor', { runtimeId, sessionId }),
      ),
    runtimeOpenView: async runtimeId => decode(runtimeViewSchema, await call('runtimeOpenView', { runtimeId })),
    runtimeCloseView: async leaseId => decode(Schema.Struct({ closed: Schema.Boolean }), await call('runtimeCloseView', { leaseId })),
    runtimeRemove: async runtimeId => decode(Schema.Struct({ removed: Schema.Boolean }), await call('runtimeRemove', { runtimeId })),
  }
}

export const multiHostConnectionError = (error: unknown): DshPlatformError =>
  error instanceof DshPlatformError
    ? error
    : new DshPlatformError('multi-host-unavailable', 'The multi-host API request failed. Check that the local DSH plugin is active and reconnect.')
