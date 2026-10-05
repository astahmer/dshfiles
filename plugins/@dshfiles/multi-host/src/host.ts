import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { z } from 'zod'
import { defineHost } from '@dshfiles/dshx/host'
import { multiHostApi, type RuntimeStatus } from './api.js'
import { connectLocal } from './connectors/local.js'
import { connectSsh } from './connectors/ssh.js'
import { GatewayUnavailableError, type Gateway } from './connectors/gateway.js'
import { readOrCreateRuntimeIdentity, RuntimeIdentityError } from './identity.js'
import { callNativeRpc, mayHaveReachedRuntime } from './native-rpc.js'
import {
  hostConnectorSchema,
  runtimeIdentitySchema,
  runtimeLocatorSchema,
  runtimeOriginPort,
  type HostRecord,
  type RuntimeIdentity,
  type RuntimeRecord,
} from './records.js'
import {
  DirectoryStoreError,
  findHost,
  findRuntime,
  listHosts,
  listRuntimes,
  readDirectory,
  removeHost,
  removeRuntime,
  upsertHost,
  upsertRuntime,
} from './store.js'
import { reserveLoopbackEndpoint } from './connectors/loopback.js'

const profileSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const requiredCapabilities: readonly RuntimeIdentity['capabilities'][number][] = ['workspace', 'session', 'agent']
const configSchema = z.object({ profile: profileSchema.optional() }).strict()
const sessionRowSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    cwd: z.string().max(4096).optional(),
    running: z.boolean(),
    blank: z.boolean(),
    updatedAt: z.number().finite(),
  })
  .passthrough()
const sessionListSchema = z.object({ items: z.array(sessionRowSchema).max(10_000) }).passthrough()
const workspaceRowSchema = z
  .object({
    workspaceId: z.string().min(1).max(256),
    path: z.string().min(1).max(4096),
    title: z.string().max(512).optional(),
    sessionIds: z.array(z.string().max(256)).max(10_000).optional(),
  })
  .passthrough()
const workspaceCreatedSchema = z
  .object({
    workspace: z.object({ workspaceId: z.string(), path: z.string(), title: z.string().optional() }).passthrough(),
  })
  .passthrough()
const workspaceContainerSchema = z
  .object({
    items: z.unknown().optional(),
    value: z.unknown().optional(),
    workspace: z.unknown().optional(),
    workspaces: z.unknown().optional(),
    baseline: z.unknown().optional(),
    snapshot: z.unknown().optional(),
  })
  .passthrough()
const sessionCursorFrameSchema = z
  .object({
    type: z.literal('snapshot'),
    cursor: z.number().int().safe().min(-1),
  })
  .passthrough()

interface ViewLease {
  readonly runtimeId: string
  readonly gateway: Gateway
  readonly timer: ReturnType<typeof setTimeout>
}

class IdentityMismatchError extends Error {
  readonly code = 'identity-mismatch'

  constructor(message: string) {
    super(message)
    this.name = 'IdentityMismatchError'
  }
}

let configuredProfile: string | undefined
const viewLeases = new Map<string, ViewLease>()
const viewLeaseTtlMs = 30 * 60_000
const maxViewLeases = 8

const connectRuntime = async ({
  host,
  runtime,
  signal,
  originPort,
}: {
  readonly host: HostRecord
  readonly runtime: RuntimeRecord
  readonly signal?: AbortSignal
  readonly originPort?: number
}): Promise<Gateway> => {
  if (host.connector.kind !== runtime.locator.kind)
    throw new GatewayUnavailableError('connector-kind-mismatch', 'The runtime locator does not match its recorded host.')
  if (runtime.locator.kind === 'local' && host.connector.kind === 'local')
    return connectLocal({ launchUrl: runtime.locator.launchUrl, ...(originPort === undefined ? {} : { originPort }), signal })
  if (runtime.locator.kind === 'ssh' && host.connector.kind === 'ssh')
    return connectSsh({
      sshTarget: host.connector.sshTarget,
      unit: runtime.locator.unit,
      remoteHome: runtime.locator.remoteHome,
      ...(originPort === undefined ? {} : { originPort }),
      signal,
    })
  throw new GatewayUnavailableError('connector-kind-mismatch', 'The runtime locator does not match its recorded host.')
}

const allocateRuntimeOriginPort = async (runtimeId: string, occupiedPorts: readonly number[]): Promise<number> => {
  const unavailable = new Set(occupiedPorts)
  for (let attempt = 0; attempt < 20_000; attempt += 1) {
    const port = runtimeOriginPort(runtimeId, [...unavailable])
    try {
      const endpoint = await reserveLoopbackEndpoint(port)
      endpoint.release()
      return port
    } catch (error) {
      if (!(error instanceof GatewayUnavailableError) || error.code !== 'loopback-address-unavailable') throw error
      unavailable.add(port)
    }
  }
  throw new DirectoryStoreError('origin-port-exhausted', 'No stable browser origin port is available for this runtime.')
}

const readIdentity = async (gateway: Gateway): Promise<RuntimeIdentity> => {
  let raw: unknown
  try {
    raw = await gateway.api('identity')
  } catch {
    throw new GatewayUnavailableError('identity-unavailable', 'The connected runtime did not provide the multi-host identity API.')
  }
  const parsed = runtimeIdentitySchema.safeParse(raw)
  if (!parsed.success) throw new GatewayUnavailableError('identity-invalid', 'The connected runtime returned an identity outside the supported contract.')
  if (parsed.data.protocolVersion !== 1 || parsed.data.dshVersion === 'unknown' || !parsed.data.dshVersion.startsWith('0.2.')) {
    throw new GatewayUnavailableError('runtime-incompatible', 'The connected runtime does not report a supported DSH 0.2 protocol version.')
  }
  if (!requiredCapabilities.every(capability => parsed.data.capabilities.includes(capability))) {
    throw new GatewayUnavailableError(
      'runtime-capability-missing',
      'The connected runtime does not provide the required workspace, session, and agent capabilities.',
    )
  }
  return parsed.data
}

const verifyPinnedIdentity = async (gateway: Gateway, runtime: RuntimeRecord): Promise<RuntimeIdentity> => {
  const current = await readIdentity(gateway)
  const pinned = runtime.identity
  if (pinned === null) throw new IdentityMismatchError('This runtime has no pinned identity. Re-register it before use.')
  if (
    current.runtimeId !== runtime.id ||
    current.runtimeId !== pinned.runtimeId ||
    current.profile !== pinned.profile ||
    current.homeLeaf !== pinned.homeLeaf ||
    current.protocolVersion !== pinned.protocolVersion
  ) {
    throw new IdentityMismatchError('The connected runtime identity changed. Verify the host and runtime before reconnecting.')
  }
  if (runtime.locator.kind === 'ssh' && current.homeLeaf !== basename(runtime.locator.remoteHome)) {
    throw new IdentityMismatchError('The connected runtime home does not match its registered SSH home.')
  }
  return current
}

const safeFailure = (error: unknown): { readonly code: string; readonly message: string } => {
  if (
    error instanceof DirectoryStoreError ||
    error instanceof RuntimeIdentityError ||
    error instanceof GatewayUnavailableError ||
    error instanceof IdentityMismatchError
  ) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return { code: error.code, message: 'The runtime request failed. Check the runtime status and reconnect if needed.' }
  }
  return { code: 'runtime-unavailable', message: 'The runtime request failed. Check the runtime status and reconnect if needed.' }
}

const hostSummary = async (record: HostRecord) => ({
  id: record.id,
  name: record.name,
  connector: record.connector,
  runtimeCount: (await listRuntimes(record.id)).length,
})

const runtimeSummary = (record: RuntimeRecord) => ({
  id: record.id,
  hostId: record.hostId,
  name: record.name,
  identity: record.identity,
  ...(record.lastSeenAt === undefined ? {} : { lastSeenAt: record.lastSeenAt }),
})

const collectWorkspaces = (frames: readonly unknown[]): ReturnType<typeof workspaceRowSchema.parse>[] => {
  const results = new Map<string, ReturnType<typeof workspaceRowSchema.parse>>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 16 || results.size >= 256) return
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 512)) visit(item, depth + 1)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const workspace = workspaceRowSchema.safeParse(value)
    if (workspace.success) results.set(workspace.data.workspaceId, workspace.data)
    const record = workspaceContainerSchema.parse(value)
    for (const key of ['items', 'value', 'workspace', 'workspaces', 'baseline', 'snapshot'] as const) {
      const child = record[key]
      if (child !== undefined) visit(child, depth + 1)
    }
  }
  for (const frame of frames) visit(frame, 0)
  return [...results.values()]
}

const closeLease = async (leaseId: string): Promise<boolean> => {
  const lease = viewLeases.get(leaseId)
  if (lease === undefined) return false
  viewLeases.delete(leaseId)
  clearTimeout(lease.timer)
  await lease.gateway.dispose()
  return true
}

const closeAllLeases = async (): Promise<void> => {
  await Promise.all([...viewLeases.keys()].map(closeLease))
}

const closeRuntimeLeases = async (runtimeId: string): Promise<void> => {
  const leases = [...viewLeases.entries()].filter(([, lease]) => lease.runtimeId === runtimeId).map(([leaseId]) => leaseId)
  await Promise.all(leases.map(closeLease))
}

const multiHostHandlers = multiHostApi.host({
  identity: async () => readOrCreateRuntimeIdentity(configuredProfile),
  list: async () => {
    const [hosts, runtimes] = await Promise.all([listHosts(), listRuntimes()])
    return {
      hosts: hosts.map(record => ({
        id: record.id,
        name: record.name,
        connector: record.connector,
        runtimeCount: runtimes.filter(runtime => runtime.hostId === record.id).length,
      })),
      runtimes: runtimes.map(runtimeSummary),
    }
  },
  hostUpsert: async ({ input }) => {
    const connector = hostConnectorSchema.parse(input.connector)
    const previous = await findHost(input.id)
    const record: HostRecord = {
      schemaVersion: 2,
      id: input.id.trim(),
      name: input.name.trim(),
      connector,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
    }
    await upsertHost(record)
    return hostSummary(record)
  },
  hostRemove: async ({ input }) => {
    const runtimes = input.removeDirectory ? await listRuntimes(input.id) : []
    const removed = await removeHost(input.id, input.removeDirectory)
    if (removed) await Promise.all(runtimes.map(runtime => closeRuntimeLeases(runtime.id)))
    return { removed }
  },
  runtimeList: async ({ input }) => ({ runtimes: (await listRuntimes(input.hostId)).map(runtimeSummary) }),
  runtimeUpsert: async ({ input, signal }) => {
    let gateway: Gateway | undefined
    try {
      const host = await findHost(input.hostId)
      if (host === undefined) throw new DirectoryStoreError('host-not-found', 'Choose a recorded host before adding a runtime.')
      const locator = runtimeLocatorSchema.parse(input.locator)
      if (locator.kind !== host.connector.kind)
        throw new DirectoryStoreError('connector-kind-mismatch', 'The runtime locator does not match its recorded host.')
      const provisional: RuntimeRecord = {
        schemaVersion: 2,
        id: randomUUID(),
        hostId: host.id,
        name: input.name.trim(),
        locator,
        identity: null,
        createdAt: new Date().toISOString(),
      }
      gateway = await connectRuntime({ host, runtime: provisional, signal })
      const identity = await readIdentity(gateway)
      if (locator.kind === 'ssh' && identity.homeLeaf !== basename(locator.remoteHome)) {
        throw new IdentityMismatchError('The connected runtime home does not match the SSH home you selected.')
      }
      const directory = await readDirectory()
      const existing = directory.runtimes.find(runtime => runtime.id === identity.runtimeId)
      if (existing !== undefined && existing.hostId !== host.id) {
        throw new IdentityMismatchError('This runtime identity is already registered under a different host.')
      }
      const originPort =
        existing?.originPort ??
        (await allocateRuntimeOriginPort(identity.runtimeId, [
          ...directory.retiredPorts,
          ...directory.runtimes.flatMap(runtime => (runtime.originPort === undefined ? [] : [runtime.originPort])),
        ]))
      const record = await upsertRuntime({
        schemaVersion: 2,
        id: identity.runtimeId,
        hostId: host.id,
        name: input.name.trim(),
        locator,
        identity,
        originPort,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      })
      return { ok: true as const, runtime: runtimeSummary(record) }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    } finally {
      await gateway?.dispose()
    }
  },
  runtimeStatus: async ({ input, signal }): Promise<RuntimeStatus> => {
    const runtime = await findRuntime(input.runtimeId)
    if (runtime === undefined)
      return { ok: false, hostId: 'unknown', runtimeId: input.runtimeId, code: 'runtime-not-found', message: 'No recorded runtime has this id.', stale: true }
    const host = await findHost(runtime.hostId)
    if (host === undefined)
      return {
        ok: false,
        hostId: runtime.hostId,
        runtimeId: runtime.id,
        code: 'host-not-found',
        message: 'The runtime has no recorded host.',
        stale: true,
        ...(runtime.lastSeenAt === undefined ? {} : { lastSeenAt: runtime.lastSeenAt }),
      }
    let gateway: Gateway | undefined
    try {
      gateway = await connectRuntime({ host, runtime, signal })
      const identity = await verifyPinnedIdentity(gateway, runtime)
      const [frames, sessionValue] = await Promise.all([gateway.follow('workspace/follow', {}, 10_000), gateway.run('session', 'list', { _request: {} })])
      const sessions = sessionListSchema
        .parse(sessionValue)
        .items.slice(0, 500)
        .map(item => ({
          runtimeId: runtime.id,
          sessionId: item.sessionId,
          ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
          running: item.running,
          blank: item.blank,
          updatedAt: item.updatedAt,
        }))
      const workspaces = collectWorkspaces(frames).map(item => ({
        runtimeId: runtime.id,
        workspaceId: item.workspaceId,
        path: item.path,
        title: item.title ?? item.path,
        sessionIds: item.sessionIds ?? [],
      }))
      const lastSeenAt = new Date().toISOString()
      const refreshed = await upsertRuntime({ ...runtime, identity, lastSeenAt })
      return {
        ok: true,
        host: await hostSummary(host),
        runtime: runtimeSummary(refreshed),
        identity,
        workspaces,
        sessions,
      }
    } catch (error) {
      const failure = safeFailure(error)
      return {
        ok: false,
        hostId: host.id,
        runtimeId: runtime.id,
        code: failure.code,
        message: failure.message,
        stale: true,
        ...(runtime.lastSeenAt === undefined ? {} : { lastSeenAt: runtime.lastSeenAt }),
      }
    } finally {
      await gateway?.dispose()
    }
  },
  workspaceOpen: async ({ input, signal }) => {
    const runtime = await findRuntime(input.runtimeId)
    if (runtime === undefined) throw new DirectoryStoreError('runtime-not-found', 'Choose a recorded runtime before opening a workspace.')
    const host = await findHost(runtime.hostId)
    if (host === undefined) throw new DirectoryStoreError('host-not-found', 'The runtime host is no longer recorded.')
    const gateway = await connectRuntime({ host, runtime, signal })
    try {
      await verifyPinnedIdentity(gateway, runtime)
      let raw: unknown
      try {
        raw = await gateway.run('workspace', 'create', { request: { path: input.path } })
      } catch (error) {
        if (error instanceof GatewayUnavailableError && mayHaveReachedRuntime(error.code)) {
          throw new GatewayUnavailableError(
            'unknown-mutation-outcome',
            'The connection failed after workspace creation was sent. Inspect runtime workspaces before retrying.',
          )
        }
        throw error
      }
      const result = workspaceCreatedSchema.safeParse(raw)
      if (!result.success)
        throw new GatewayUnavailableError(
          'unknown-mutation-outcome',
          'The runtime reply was unusable after workspace creation. Inspect runtime workspaces before retrying.',
        )
      return {
        runtimeId: runtime.id,
        workspaceId: result.data.workspace.workspaceId,
        path: result.data.workspace.path,
        title: result.data.workspace.title ?? result.data.workspace.path,
        sessionIds: [],
      }
    } finally {
      await gateway.dispose()
    }
  },
  runtimeCall: async ({ input, signal }) => {
    const runtime = await findRuntime(input.runtimeId)
    if (runtime === undefined) return { ok: false, code: 'runtime-not-found', message: 'Choose a recorded runtime before sending a request.' }
    const host = await findHost(runtime.hostId)
    if (host === undefined) return { ok: false, code: 'host-not-found', message: 'The runtime host is no longer recorded.' }
    let gateway: Gateway | undefined
    try {
      gateway = await connectRuntime({ host, runtime, signal })
      await verifyPinnedIdentity(gateway, runtime)
      return await callNativeRpc(gateway, input.request)
    } catch (error) {
      const failure = safeFailure(error)
      return {
        ok: false,
        code: failure.code,
        message: failure.message,
      }
    } finally {
      await gateway?.dispose()
    }
  },
  sessionCursor: async ({ input, signal }) => {
    const runtime = await findRuntime(input.runtimeId)
    if (runtime === undefined) throw new DirectoryStoreError('runtime-not-found', 'Choose a recorded runtime before reading its session cursor.')
    const host = await findHost(runtime.hostId)
    if (host === undefined) throw new DirectoryStoreError('host-not-found', 'The runtime host is no longer recorded.')
    const gateway = await connectRuntime({ host, runtime, signal })
    try {
      await verifyPinnedIdentity(gateway, runtime)
      const frames = await gateway.follow(
        'session/follow',
        {
          request: { address: { kind: 'session', sessionId: input.sessionId }, maxMessages: 1 },
        },
        10_000,
      )
      const snapshot = frames.map(frame => sessionCursorFrameSchema.safeParse(frame)).find(result => result.success)
      if (snapshot === undefined) throw new GatewayUnavailableError('session-cursor-unavailable', 'The runtime did not return a session history cursor.')
      return { cursor: snapshot.data.cursor }
    } finally {
      await gateway.dispose()
    }
  },
  runtimeOpenView: async ({ input, signal }) => {
    const runtime = await findRuntime(input.runtimeId)
    if (runtime === undefined) throw new DirectoryStoreError('runtime-not-found', 'Choose a recorded runtime before opening its native view.')
    const host = await findHost(runtime.hostId)
    if (host === undefined) throw new DirectoryStoreError('host-not-found', 'The runtime host is no longer recorded.')
    if ([...viewLeases.values()].some(lease => lease.runtimeId === runtime.id)) {
      throw new GatewayUnavailableError('runtime-view-open', 'This runtime already has an open native view. Close it before opening another.')
    }
    if (runtime.originPort === undefined)
      throw new GatewayUnavailableError(
        'runtime-origin-unavailable',
        'This runtime has no stable browser origin. Re-register it before opening the native view.',
      )
    const gateway = await connectRuntime({ host, runtime, signal, originPort: runtime.originPort })
    try {
      await verifyPinnedIdentity(gateway, runtime)
    } catch (error) {
      await gateway.dispose()
      throw error
    }
    while (viewLeases.size >= maxViewLeases) {
      const oldest = viewLeases.keys().next().value
      if (oldest === undefined) break
      await closeLease(oldest)
    }
    const leaseId = randomUUID()
    const timer = setTimeout(() => {
      void closeLease(leaseId)
    }, viewLeaseTtlMs)
    viewLeases.set(leaseId, { runtimeId: runtime.id, gateway, timer })
    return { leaseId, launchUrl: gateway.launchUrl }
  },
  runtimeCloseView: async ({ input }) => ({ closed: await closeLease(input.leaseId) }),
  runtimeRemove: async ({ input }) => {
    const removed = await removeRuntime(input.runtimeId)
    if (removed) await closeRuntimeLeases(input.runtimeId)
    return { removed }
  },
})

export default defineHost({
  name: '@dshfiles/multi-host',
  Config: configSchema,
  apis: [multiHostHandlers],
  setup(ctx, config) {
    configuredProfile = configSchema.parse(config ?? {}).profile
    ctx.effect(() => async () => {
      await closeAllLeases()
    })
  },
})
