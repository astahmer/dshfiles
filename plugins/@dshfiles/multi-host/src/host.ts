import { randomUUID } from 'node:crypto'
import type { SessionSourceRegistry } from '@dshfiles/session-source-port'
import { homedir } from 'node:os'
import { basename, join, posix } from 'node:path'
import { z } from 'zod'
import { defineHost } from '@dshfiles/dshx/host'
import { fileUploadValueSchema, multiHostApi, type ConnectionTestStep, type RuntimeStatus, type SessionSummary } from './api.js'
import { connectLocal } from './connectors/local.js'
import { SshConnector } from './connectors/ssh.js'
import { GatewayRequestError, GatewayUnavailableError, type Gateway } from './connectors/gateway.js'
import { createGatewayPool, type PooledGateway } from './gateway-pool.js'
import { createRemoteSessionSource } from './remote-session-source.js'
import { authorizeRemoteSessionRuntime } from './session-runtime-authorization.js'
import { knownSessionRuntime } from './session-runtime.js'
import { createRuntimeStatusCache } from './runtime-status-snapshot-cache.js'
import type {} from '@dshfiles/session-source-port'
import { readOrCreateRuntimeIdentity, RuntimeIdentityError } from './identity.js'
import { RuntimeLaunchFile } from './launch-file.js'
import { NativeRpcModel } from './native-rpc.js'
import {
  hostConnectorSchema,
  runtimeIdentitySchema,
  runtimeLocatorSchema,
  runtimeOriginPort,
  type HostRecord,
  type RuntimeIdentity,
  type RuntimeRecord,
} from './records.js'
import { createChildDirectory, listDirectory } from './directory-listing.js'
import { RemoteDoctor, type RemoteFacts } from './remote-doctor.js'
import { RemoteExec } from './remote-exec.js'
import { RemoteProvision } from './remote-provision.js'
import { RemoteRuntime } from './remote-runtime.js'
import { RemoteCheckout } from './remote-checkout.js'
import { listSshConfigHosts } from './ssh-config.js'
import { DirectoryStoreError, HostDirectoryStore } from './store.js'
import { reduceTranscript } from './transcript.js'
import { RemoteThreadStore } from './thread-store.js'
import { reserveLoopbackEndpoint } from './connectors/loopback.js'
import { callNativeRpc } from './native-rpc.js'

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
    title: z.string().max(512).nullable().optional(),
    // The remote list names a thread through its title projection; an untitled thread reports null there.
    projections: z
      .object({
        values: z
          .object({ title: z.string().max(512).nullable().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
const sessionListSchema = z.object({ items: z.array(sessionRowSchema).max(10_000) }).passthrough()
const sessionCreatedSchema = z.object({ sessionId: z.string().min(1).max(256) }).passthrough()
const directoryListingSchema = z
  .object({
    path: z.string(),
    home: z.string(),
    crumbs: z.array(z.object({ name: z.string(), path: z.string(), hidden: z.boolean() })),
    entries: z.array(z.object({ name: z.string(), path: z.string(), hidden: z.boolean() })).max(5_000),
    truncated: z.boolean(),
  })
  .passthrough()
const workspaceRowSchema = z
  .object({
    workspaceId: z.string().min(1).max(256),
    path: z.string().min(1).max(4096),
    title: z.string().max(512).optional(),
    sessionIds: z.array(z.string().max(256)).max(10_000).optional(),
  })
  .passthrough()
const workspaceCreatedSchema = z.object({ workspace: z.object({ workspaceId: z.string().min(1), path: z.string().min(1) }).passthrough() }).passthrough()
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
const fileReferenceCandidatesSchema = z.array(z.object({ path: z.string().max(4096), kind: z.enum(['file', 'directory']) }).strip()).max(1000)
const modelCatalogSchema = z
  .object({
    default: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }).passthrough().optional(),
    routableProviders: z.array(z.string()).optional(),
    groups: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          models: z.array(
            z
              .object({
                id: z.string(),
                name: z.string(),
                description: z.string().optional(),
                reasoning: z
                  .object({
                    efforts: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() }).passthrough()),
                    defaultEffort: z.string().optional(),
                  })
                  .passthrough()
                  .optional(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
    failures: z.array(z.object({ id: z.string(), name: z.string(), message: z.string() }).passthrough()).optional(),
  })
  .passthrough()
const sessionSnapshotSchema = z
  .object({
    type: z.literal('snapshot'),
    cursor: z.number().int(),
    header: z.object({ cwd: z.string().optional() }).passthrough().optional(),
    records: z.array(z.unknown()).max(10_000),
  })
  .passthrough()
const sessionCursorFrameSchema = z.object({ type: z.literal('snapshot'), cursor: z.number().int().safe().min(-1) }).passthrough()
const webServerSchema = z.object({ port: z.number().int().min(1).max(65_535) }).passthrough()

/** Failures that mean the pooled connection itself is gone, so the next call should open a fresh one. */
const transportFailures = new Set([
  'gateway-unreachable',
  'authentication-expired',
  'stream-unreachable',
  'stream-closed',
  'api-unreachable',
  'gateway-request-failed',
])

class IdentityMismatchError extends Error {
  readonly code = 'identity-mismatch'

  constructor(message: string) {
    super(message)
    this.name = 'IdentityMismatchError'
  }
}

interface ViewLease {
  readonly runtimeId: string
  readonly pooled: PooledGateway
  readonly timer: ReturnType<typeof setTimeout>
}

let configuredProfile: string | undefined
const activeSessionSources = new Set<SessionSourceRegistry>()
const viewLeases = new Map<string, ViewLease>()
const viewLeaseTtlMs = 30 * 60_000
const maxViewLeases = 8
const connectionErrors = new Map<string, { readonly code: string; readonly message: string; readonly at: string }>()
const runtimeStatusCache = createRuntimeStatusCache<RuntimeStatus>({ successTtlMs: 30_000, failureTtlMs: 45_000 })

const connectRuntime = async ({
  host,
  runtime,
  signal,
  originPort,
}: {
  readonly host: HostRecord
  readonly runtime: RuntimeRecord
  readonly signal?: AbortSignal | undefined
  readonly originPort?: number
}): Promise<Gateway> => {
  if (runtime.locator.kind === 'local' && host.connector.kind === 'local')
    return connectLocal({ launchUrl: runtime.locator.launchUrl, ...(originPort === undefined ? {} : { originPort }), signal })
  if (runtime.locator.kind === 'ssh' && host.connector.kind === 'ssh')
    return SshConnector.connect({
      sshTarget: host.connector.sshTarget,
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
    throw new GatewayUnavailableError(
      'identity-unavailable',
      'The connected runtime did not provide the multi-host identity API. Install @dshfiles/multi-host there.',
    )
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
    error instanceof GatewayRequestError ||
    error instanceof IdentityMismatchError
  ) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return { code: error.code, message: 'The runtime request failed. Check the host status and reconnect if needed.' }
  }
  return { code: 'runtime-unavailable', message: 'The runtime request failed. Check the host status and reconnect if needed.' }
}

const failureCode = (error: unknown): string => safeFailure(error).code

const pool = createGatewayPool({
  isTransportFailure: error => transportFailures.has(failureCode(error)),
  connect: async runtimeId => {
    const runtime = await HostDirectoryStore.findRuntime(runtimeId)
    if (runtime === undefined) throw new DirectoryStoreError('runtime-not-found', 'No recorded runtime has this id.')
    const host = await HostDirectoryStore.findHost(runtime.hostId)
    if (host === undefined) throw new DirectoryStoreError('host-not-found', 'The runtime has no recorded host.')
    // A stable origin port keeps the browser cookie of an opened remote view valid across reconnects.
    const gateway = await connectRuntime({ host, runtime, ...(runtime.originPort === undefined ? {} : { originPort: runtime.originPort }) })
    try {
      const identity = await verifyPinnedIdentity(gateway, runtime)
      await HostDirectoryStore.upsertRuntime({ ...runtime, identity, lastSeenAt: new Date().toISOString() })
      connectionErrors.delete(runtimeId)
      const cachedStatus = runtimeStatusCache.read(runtimeId)
      if (cachedStatus.status?.ok === false && !cachedStatus.refreshing) runtimeStatusCache.invalidate(runtimeId)
      return gateway
    } catch (error) {
      await gateway.dispose()
      throw error
    }
  },
})

const withRuntime = async <Result>(
  runtimeId: string,
  request: (gateway: Gateway) => Promise<Result>,
  options: { readonly mutation: boolean; readonly broken?: (result: Result) => boolean },
): Promise<Result> => {
  try {
    return await pool.run(runtimeId, request, options)
  } catch (error) {
    connectionErrors.set(runtimeId, { ...safeFailure(error), at: new Date().toISOString() })
    throw error
  }
}

/** A native RPC result that says the connection, not the request, failed. */
const brokenRpc = (result: { readonly ok: boolean; readonly code?: string }): boolean =>
  !result.ok && (result.code === 'unknown-mutation-outcome' || (result.code !== undefined && transportFailures.has(result.code)))

const runtimeSummary = (record: RuntimeRecord) => ({
  id: record.id,
  hostId: record.hostId,
  name: record.name,
  identity: record.identity,
  ...(record.locator.kind === 'ssh' ? { remoteHome: record.locator.remoteHome } : {}),
  ...(record.lastSeenAt === undefined ? {} : { lastSeenAt: record.lastSeenAt }),
  connected: pool.status(record.id) !== undefined,
  ...(connectionErrors.has(record.id) ? { lastError: connectionErrors.get(record.id) } : {}),
})

const hostSummary = (record: HostRecord, runtimes: readonly RuntimeRecord[]) => ({
  id: record.id,
  name: record.name,
  connector: record.connector,
  runtimeCount: runtimes.filter(runtime => runtime.hostId === record.id).length,
  hidden: record.hidden,
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
  lease.pooled.release()
  return true
}

const closeRuntimeLeases = async (runtimeId: string): Promise<void> => {
  const leases = [...viewLeases.entries()].filter(([, lease]) => lease.runtimeId === runtimeId).map(([leaseId]) => leaseId)
  await Promise.all(leases.map(closeLease))
}

/** Probe one SSH target + DSH home and pin its identity; shared by the add-host test and the save. */
const qualifyRuntime = async ({
  host,
  locator,
  name,
  signal,
}: {
  readonly host: HostRecord
  readonly locator: RuntimeRecord['locator']
  readonly name: string
  readonly signal?: AbortSignal | undefined
}): Promise<{ readonly identity: RuntimeIdentity; readonly steps: ConnectionTestStep[] }> => {
  const steps: ConnectionTestStep[] = []
  const timed = async <T>(step: ConnectionTestStep['step'], run: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now()
    try {
      const value = await run()
      steps.push({ step, ok: true, ms: Date.now() - startedAt })
      return value
    } catch (error) {
      steps.push({ step, ok: false, ms: Date.now() - startedAt, ...safeFailure(error) })
      throw error
    }
  }
  if (host.connector.kind === 'ssh') {
    const sshTarget = host.connector.sshTarget
    await timed('ssh', () => SshConnector.probe({ sshTarget, signal }))
  }
  const provisional: RuntimeRecord = {
    schemaVersion: 2,
    id: randomUUID(),
    hostId: host.id,
    name,
    locator,
    identity: null,
    createdAt: new Date().toISOString(),
  }
  const gateway = await timed('runtime', () => connectRuntime({ host, runtime: provisional, signal }))
  try {
    const identity = await timed('identity', () => readIdentity(gateway))
    if (locator.kind === 'ssh' && identity.homeLeaf !== basename(locator.remoteHome)) {
      throw new IdentityMismatchError('The connected runtime home does not match the SSH home you selected.')
    }
    return { identity, steps }
  } finally {
    await gateway.dispose()
  }
}

const register = async ({ host, locator, name, signal }: Parameters<typeof qualifyRuntime>[0]): Promise<RuntimeRecord> => {
  const { identity } = await qualifyRuntime({ host, locator, name, signal })
  const directory = await HostDirectoryStore.readDirectory()
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
  await pool.close(identity.runtimeId)
  return HostDirectoryStore.upsertRuntime({
    schemaVersion: 2,
    id: identity.runtimeId,
    hostId: host.id,
    name,
    locator,
    identity,
    originPort,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  })
}

const sshHostId = (sshTarget: string): string =>
  sshTarget
    .replace(/^[^@]*@/, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 64) || 'host'

const remoteHomeOf = ({ facts, requested }: { readonly facts: RemoteFacts; readonly requested: string | undefined }): string => {
  if (requested !== undefined) return requested
  if (facts.home === undefined) throw new GatewayUnavailableError('remote-home-unknown', 'The remote home could not be read; pass remoteHome.')
  return `${facts.home}/.dsh`
}

const startPathDirectories = ({ facts, nodePath }: { readonly facts: RemoteFacts; readonly nodePath: string }): string[] =>
  [
    posix.dirname(nodePath),
    facts.dsh.path === undefined ? undefined : posix.dirname(facts.dsh.path),
    facts.pnpm.path === undefined ? undefined : posix.dirname(facts.pnpm.path),
    facts.home === undefined ? undefined : `${facts.home}/.local/share/pnpm/bin`,
  ].filter((directory): directory is string => directory !== undefined && directory !== '.')

const officialNodeOf = ({ facts, minimum = '22.19.0' }: { readonly facts: RemoteFacts; readonly minimum?: string }): string | undefined => {
  const official = RemoteDoctor.officialNodePath({ nodes: facts.fnm.nodes, minimum })
  return facts.node.nix ? official : (facts.node.path ?? official)
}

const multiHostHandlers = multiHostApi.host({
  identity: async () => readOrCreateRuntimeIdentity(configuredProfile),
  list: async () => {
    const [hosts, runtimes] = await Promise.all([HostDirectoryStore.listHosts(), HostDirectoryStore.listRuntimes()])
    return { hosts: hosts.map(record => hostSummary(record, runtimes)), runtimes: runtimes.map(runtimeSummary) }
  },
  remoteExec: async ({ input, signal }) => {
    try {
      const result = await RemoteExec.run({ sshTarget: input.sshTarget, command: input.command, cwd: input.cwd, timeoutMs: input.timeoutMs, signal })
      return { ok: true as const, code: result.code, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut, durationMs: result.durationMs }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  doctor: async ({ input, signal }) => {
    try {
      const facts = await RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: input.profile, checkoutPath: input.checkoutPath, signal })
      return { ok: true as const, facts, diagnostics: RemoteDoctor.diagnose({ facts, expected: { profile: input.profile, dshVersion: input.dshVersion } }) }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  provision: async ({ input, signal }) => {
    try {
      const facts = await RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: input.profile, checkoutPath: input.checkoutPath, signal })
      const options = {
        remoteHome: input.remoteHome,
        checkoutPath: input.checkoutPath ?? facts.checkout.path,
        profile: input.profile,
        dshVersion: input.dshVersion,
        nodeVersion: input.nodeVersion,
        repository: input.repository,
        revision: input.revision,
      }
      const run = await RemoteProvision.run({
        sshTarget: input.sshTarget,
        facts,
        options,
        steps: input.steps,
        confirm: input.confirm,
        dryRun: input.dryRun,
        signal,
      })
      return { ok: true as const, plan: RemoteProvision.plan({ facts, options }), executed: run.executed, remaining: run.remaining }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  remoteRuntimeStatus: async ({ input, signal }) => {
    try {
      const facts = await RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: 'web', signal })
      const status = await RemoteRuntime.readStatus({ sshTarget: input.sshTarget, remoteHome: remoteHomeOf({ facts, requested: input.remoteHome }), signal })
      return { ok: true as const, status }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  runtimeControl: async ({ input, signal }) => {
    try {
      const facts = await RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: input.profile, checkoutPath: input.checkoutPath, signal })
      const remoteHome = remoteHomeOf({ facts, requested: input.remoteHome })
      const before = await RemoteRuntime.readStatus({ sshTarget: input.sshTarget, remoteHome, signal })
      if (input.action === 'stop') {
        if (!before.running || before.pid === undefined)
          return { ok: true as const, action: 'stop' as const, detail: 'no running remote runtime', status: before }
        const stopped = await RemoteExec.run({ sshTarget: input.sshTarget, command: RemoteRuntime.stopCommand({ pid: before.pid }), timeoutMs: 30_000, signal })
        const status = await RemoteRuntime.readStatus({ sshTarget: input.sshTarget, remoteHome, signal })
        return { ok: true as const, action: 'stop' as const, detail: stopped.stdout.trim() || stopped.stderr.trim() || 'stop requested', status }
      }
      if (before.running && before.listening) {
        return { ok: true as const, action: 'start' as const, detail: `already running on port ${before.port ?? 'unknown'}`, status: before }
      }
      const nodePath = officialNodeOf({ facts })
      if (nodePath === undefined) throw new GatewayUnavailableError('no-official-node', 'No official Node build on that machine; provision it first.')
      if (facts.dsh.path === undefined) throw new GatewayUnavailableError('dsh-missing', 'No dsh CLI on that machine; provision it first.')
      const command = RemoteRuntime.startCommand({
        remoteHome,
        checkoutPath: input.checkoutPath ?? facts.checkout.path,
        profile: input.profile,
        dshPath: facts.dsh.path,
        platform: facts.uname.startsWith('Darwin') ? 'Darwin' : undefined,
        pathDirectories: startPathDirectories({ facts, nodePath }),
      })
      await RemoteExec.run({
        sshTarget: input.sshTarget,
        command: `${command}\n${RemoteRuntime.waitForLaunchCommand({ remoteHome })}`,
        timeoutMs: 120_000,
        signal,
      })
      const status = await RemoteRuntime.readStatus({ sshTarget: input.sshTarget, remoteHome, signal })
      return {
        ok: true as const,
        action: 'start' as const,
        detail: status.running ? `running on port ${status.port ?? 'unknown'}` : 'started but no launch file yet',
        status,
      }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  runtimeLogs: async ({ input, signal }) => {
    try {
      const facts = await RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: 'web', signal })
      const logFile = RemoteRuntime.logPath({ remoteHome: remoteHomeOf({ facts, requested: input.remoteHome }) })
      const result = await RemoteExec.run({
        sshTarget: input.sshTarget,
        command: RemoteRuntime.logsCommand({ logFile, lines: input.lines }),
        timeoutMs: 20_000,
        signal,
      })
      return { ok: true as const, logFile, tail: result.stdout }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  checkoutSync: async ({ input, signal }) => {
    try {
      const facts = await RemoteDoctor.readFacts({ sshTarget: input.sshTarget, profile: 'web', checkoutPath: input.path, signal })
      const run = await RemoteCheckout.run({ sshTarget: input.sshTarget, facts, bookmark: input.bookmark, apply: input.apply, signal })
      return { ok: true as const, applied: run.applied, detail: run.detail, plan: run.plan, stdout: run.stdout, stderr: run.stderr }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  sshConfigHosts: async () => ({ hosts: await listSshConfigHosts(join(homedir(), '.ssh')) }),
  discoverHomes: async ({ input, signal }) => {
    try {
      return { ok: true as const, homes: await SshConnector.discoverHomes({ sshTarget: input.sshTarget, signal }) }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  testConnection: async ({ input, signal }) => {
    const connector = hostConnectorSchema.parse({ kind: 'ssh', sshTarget: input.sshTarget })
    const host: HostRecord = {
      schemaVersion: 2,
      id: sshHostId(input.sshTarget),
      name: input.name,
      connector,
      hidden: false,
      createdAt: new Date().toISOString(),
    }
    const locator = runtimeLocatorSchema.parse({ kind: 'ssh', remoteHome: input.remoteHome })
    try {
      const { identity, steps } = await qualifyRuntime({ host, locator, name: input.name, signal })
      return { ok: true as const, steps, identity }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  saveSshHost: async ({ input, signal }) => {
    try {
      const connector = hostConnectorSchema.parse({ kind: 'ssh', sshTarget: input.sshTarget })
      const previous = input.hostId === undefined ? undefined : await HostDirectoryStore.findHost(input.hostId)
      const host: HostRecord = {
        schemaVersion: 2,
        id: previous?.id ?? sshHostId(input.sshTarget),
        name: input.name.trim(),
        connector,
        hidden: previous?.hidden ?? false,
        ...(previous?.position === undefined ? {} : { position: previous.position }),
        createdAt: previous?.createdAt ?? new Date().toISOString(),
      }
      const locator = runtimeLocatorSchema.parse({ kind: 'ssh', remoteHome: input.remoteHome })
      await HostDirectoryStore.upsertHost(host)
      const runtime = await register({ host, locator, name: input.name.trim(), signal })
      // An edit that moved the host to another DSH home leaves the old runtime record behind.
      for (const stale of (await HostDirectoryStore.listRuntimes(host.id)).filter(item => item.id !== runtime.id)) {
        await HostDirectoryStore.removeRuntime(stale.id)
        await pool.close(stale.id)
      }
      return { ok: true as const, runtime: runtimeSummary(runtime) }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  hostUpsert: async ({ input }) => {
    const connector = hostConnectorSchema.parse(input.connector)
    const previous = await HostDirectoryStore.findHost(input.id)
    const record: HostRecord = {
      schemaVersion: 2,
      id: input.id.trim(),
      name: input.name.trim(),
      connector,
      hidden: previous?.hidden ?? false,
      ...(previous?.position === undefined ? {} : { position: previous.position }),
      createdAt: previous?.createdAt ?? new Date().toISOString(),
    }
    await HostDirectoryStore.upsertHost(record)
    return hostSummary(record, await HostDirectoryStore.listRuntimes())
  },
  hostSetHidden: async ({ input }) => hostSummary(await HostDirectoryStore.setHostHidden(input), await HostDirectoryStore.listRuntimes()),
  hostReorder: async ({ input }) => {
    const runtimes = await HostDirectoryStore.listRuntimes()
    const hosts = await HostDirectoryStore.reorderHosts(input.ids)
    return { hosts: hosts.map(record => hostSummary(record, runtimes)) }
  },
  hostRemove: async ({ input }) => {
    const runtimes = input.removeDirectory ? await HostDirectoryStore.listRuntimes(input.id) : []
    const removed = await HostDirectoryStore.removeHost(input.id, input.removeDirectory)
    if (removed) {
      for (const runtime of runtimes) {
        await closeRuntimeLeases(runtime.id)
        await pool.close(runtime.id)
      }
    }
    return { removed }
  },
  runtimeUpsert: async ({ input, signal }) => {
    try {
      const host = await HostDirectoryStore.findHost(input.hostId)
      if (host === undefined) throw new DirectoryStoreError('host-not-found', 'Choose a recorded host before adding a runtime.')
      const locator = runtimeLocatorSchema.parse(input.locator)
      if (locator.kind !== host.connector.kind)
        throw new DirectoryStoreError('connector-kind-mismatch', 'The runtime locator does not match its recorded host.')
      return { ok: true as const, runtime: runtimeSummary(await register({ host, locator, name: input.name.trim(), signal })) }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  runtimeStatus: async ({ input }): Promise<RuntimeStatus> => {
    const runtime = await HostDirectoryStore.findRuntime(input.runtimeId)
    if (runtime === undefined)
      return { ok: false, hostId: 'unknown', runtimeId: input.runtimeId, code: 'runtime-not-found', message: 'No recorded runtime has this id.', stale: true }
    const cached = runtimeStatusCache.read(runtime.id)
    if (cached.status !== undefined && !cached.stale) return cached.status

    void runtimeStatusCache
      .refresh(runtime.id, async () => {
        try {
          return await withRuntime(
            runtime.id,
            async gateway => {
              const [frames, sessionValue] = await Promise.all([
                gateway.follow('workspace/follow', {}, 10_000),
                gateway.run('session', 'list', { _request: {} }),
              ])
              const sessions = sessionListSchema
                .parse(sessionValue)
                .items.slice(0, 500)
                .map(item => {
                  const title = item.title ?? item.projections?.values?.title ?? undefined
                  const summary: SessionSummary = {
                    runtimeId: runtime.id,
                    sessionId: item.sessionId,
                    running: item.running,
                    blank: item.blank,
                    updatedAt: item.updatedAt,
                  }
                  if (item.cwd !== undefined) summary.cwd = item.cwd
                  if (title !== undefined && title !== '') summary.title = title
                  return summary
                })
              const workspaces = collectWorkspaces(frames).map(item => ({
                runtimeId: runtime.id,
                workspaceId: item.workspaceId,
                path: item.path,
                title: item.title ?? item.path,
                sessionIds: item.sessionIds ?? [],
              }))
              const refreshed = (await HostDirectoryStore.findRuntime(runtime.id)) ?? runtime
              return { ok: true as const, runtime: runtimeSummary(refreshed), workspaces, sessions }
            },
            { mutation: false },
          )
        } catch (error) {
          const failure = safeFailure(error)
          return {
            ok: false,
            hostId: runtime.hostId,
            runtimeId: runtime.id,
            code: failure.code,
            message: failure.message,
            stale: true,
            lastSeenAt: runtime.lastSeenAt,
          }
        }
      })
      .catch(error => {
        connectionErrors.set(runtime.id, { ...safeFailure(error), at: new Date().toISOString() })
      })

    if (cached.status !== undefined) return { ...cached.status, stale: true, refreshing: true }
    return {
      ok: false,
      hostId: runtime.hostId,
      runtimeId: runtime.id,
      code: 'runtime-status-refreshing',
      message: 'A remote status refresh is running.',
      stale: true,
      refreshing: true,
      lastSeenAt: runtime.lastSeenAt,
    }
  },
  runtimePing: async ({ input, signal }) => {
    const startedAt = Date.now()
    try {
      await withRuntime(input.runtimeId, gateway => gateway.api('identity', undefined, signal), { mutation: false })
      return { ok: true as const, ms: Date.now() - startedAt }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  runtimeReconnect: async ({ input }) => {
    runtimeStatusCache.invalidate(input.runtimeId)
    await pool.close(input.runtimeId)
    connectionErrors.delete(input.runtimeId)
    try {
      await withRuntime(input.runtimeId, async () => undefined, { mutation: false })
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  listDirectory: async ({ input }) => listDirectory(input.path),
  createDirectory: async ({ input }) => ({ path: await createChildDirectory(input) }),
  runtimeBrowse: async ({ input, signal }) => {
    try {
      const listing = await withRuntime(
        input.runtimeId,
        async gateway => directoryListingSchema.parse(await gateway.api('listDirectory', input.path === undefined ? {} : { path: input.path }, signal)),
        { mutation: false },
      )
      return {
        ok: true as const,
        path: listing.path,
        home: listing.home,
        crumbs: listing.crumbs,
        entries: listing.entries.slice(0, 2_000),
        truncated: listing.truncated || listing.entries.length > 2_000,
      }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  runtimeOpenFolder: async ({ input }) => {
    try {
      const created = await withRuntime(
        input.runtimeId,
        async gateway => workspaceCreatedSchema.parse(await gateway.run('workspace', 'create', { request: { path: input.path } })),
        {
          mutation: true,
        },
      )
      return { ok: true as const, workspaceId: created.workspace.workspaceId, path: created.workspace.path }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  runtimeCreateDirectory: async ({ input }) => {
    try {
      const created = await withRuntime(input.runtimeId, async gateway => gateway.api('createDirectory', { path: input.path, name: input.name }), {
        mutation: true,
      })
      return { ok: true as const, path: z.object({ path: z.string() }).parse(created).path }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  runtimePluginCall: async ({ input, signal }) => {
    const mutation = input.method === 'provision' || input.method === 'noFolder'
    try {
      const value = await withRuntime(
        input.runtimeId,
        async gateway => gateway.pluginApi({ packageId: '@dshfiles/jj-integration', apiId: 'jj-threads', version: 1 })(input.method, input.input, signal),
        { mutation },
      )
      return { ok: true as const, value }
    } catch (error) {
      const failure = safeFailure(error)
      if (mutation && NativeRpcModel.mayHaveReachedRuntime(failure.code)) {
        return {
          ok: false as const,
          code: 'unknown-mutation-outcome',
          message: 'The connection dropped after the request was sent; check the host before retrying.',
        }
      }
      return { ok: false as const, ...failure }
    }
  },
  threadCreate: async ({ input }) => {
    const runtime = await HostDirectoryStore.findRuntime(input.runtimeId)
    if (runtime === undefined) return { ok: false as const, code: 'runtime-not-found', message: 'This host is no longer recorded.' }
    let sessionId: string | undefined
    try {
      return await withRuntime(
        runtime.id,
        async gateway => {
          const created = await NativeRpcModel.call(gateway, {
            namespace: 'session',
            method: 'create',
            args: { request: { cwd: input.cwd } },
          })
          if (!created.ok) return { ok: false as const, code: created.code, message: created.message }
          sessionId = sessionCreatedSchema.parse(created.value).sessionId
          await RemoteThreadStore.record({ runtimeId: runtime.id, sessionId, cwd: input.cwd, title: '', createdAt: new Date().toISOString() })
          return { ok: true as const, sessionId }
        },
        { mutation: true, broken: brokenRpc },
      )
    } catch (error) {
      return { ok: false as const, ...safeFailure(error), ...(sessionId === undefined ? {} : { sessionId }) }
    }
  },
  threadStart: async ({ input }) => {
    const runtime = await HostDirectoryStore.findRuntime(input.runtimeId)
    if (runtime === undefined) return { ok: false as const, code: 'runtime-not-found', message: 'This host is no longer recorded.' }
    let sessionId: string | undefined
    try {
      return await withRuntime(
        runtime.id,
        async gateway => {
          const created = await NativeRpcModel.call(gateway, {
            namespace: 'session',
            method: 'create',
            args: { request: { cwd: input.cwd, ...(input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset }) } },
          })
          if (!created.ok) return { ok: false as const, code: created.code, message: created.message }
          sessionId = sessionCreatedSchema.parse(created.value).sessionId
          if (input.model !== undefined) {
            const selected = await gateway.runSafe('session', 'selectModel', {
              request: {
                sessionId,
                provider: input.model.provider,
                model: input.model.model,
                ...(input.model.reasoningEffort === undefined ? {} : { reasoningEffort: input.model.reasoningEffort }),
              },
            })
            if (!selected.ok)
              return { ok: false as const, code: selected.code, message: `The thread was created but its model was refused: ${selected.message}`, sessionId }
          }
          await RemoteThreadStore.record({
            runtimeId: runtime.id,
            sessionId,
            cwd: input.cwd,
            title: input.text.slice(0, 80),
            createdAt: new Date().toISOString(),
          })
          const prompted = await NativeRpcModel.call(gateway, {
            namespace: 'session',
            method: 'prompt',
            args: { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: input.text }] } },
          })
          if (!prompted.ok) return { ok: false as const, code: prompted.code, message: prompted.message, sessionId }
          return { ok: true as const, sessionId }
        },
        { mutation: true, broken: brokenRpc },
      )
    } catch (error) {
      const failure = safeFailure(error)
      return { ok: false as const, ...failure, ...(sessionId === undefined ? {} : { sessionId }) }
    }
  },
  runtimeModels: async ({ input, signal }) => {
    try {
      const catalog = await withRuntime(input.runtimeId, async gateway => modelCatalogSchema.parse(await gateway.run('session', 'modelCatalog', {}, signal)), {
        mutation: false,
      })
      return {
        ok: true as const,
        default: catalog.default ?? null,
        routableProviders: catalog.routableProviders ?? catalog.groups.map(group => group.id),
        groups: catalog.groups.map(group => ({
          id: group.id,
          name: group.name,
          models: group.models.map(model => ({
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
            ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
          })),
        })),
        failures: catalog.failures ?? [],
      }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  sessionRuntime: async ({ input }) => {
    try {
      const recorded = (await RemoteThreadStore.list()).find(thread => thread.sessionId === input.sessionId)
      if (recorded !== undefined && (await HostDirectoryStore.findRuntime(recorded.runtimeId)) !== undefined) {
        return { ok: true as const, runtimeId: recorded.runtimeId }
      }
      const runtimeId = await knownSessionRuntime({ sessionId: input.sessionId, sessionSources: [...activeSessionSources] })
      return { ok: true as const, runtimeId }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  runtimeFileReferences: async ({ input, signal }) => {
    try {
      const recordedSessions = await RemoteThreadStore.list()
      const authorization = await authorizeRemoteSessionRuntime({
        sessionId: input.sessionId,
        runtimeId: input.runtimeId,
        recordedSessions,
        sessionSources: [...activeSessionSources],
      })
      if (!authorization.ok) return authorization
      const outcome = await withRuntime(
        input.runtimeId,
        gateway => gateway.runSafe('fileReferences', 'list', { agentId: input.sessionId, query: input.query }, signal),
        { mutation: false, broken: result => !result.ok && transportFailures.has(result.code) },
      )
      if (!outcome.ok) return { ok: false as const, code: outcome.code, message: outcome.message }
      const candidates = fileReferenceCandidatesSchema.parse(outcome.value).map(candidate => ({ path: candidate.path, kind: candidate.kind }))
      return { ok: true as const, candidates }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  sessionUploadFile: async ({ input, signal }) => {
    try {
      const runtime = await HostDirectoryStore.findRuntime(input.runtimeId)
      if (runtime === undefined) return { ok: false as const, code: 'runtime-not-found', message: 'This host is no longer recorded.' }
      const authorization = await authorizeRemoteSessionRuntime({
        sessionId: input.sessionId,
        runtimeId: runtime.id,
        recordedSessions: await RemoteThreadStore.list(),
        sessionSources: [...activeSessionSources],
      })
      if (!authorization.ok) return authorization
      const value = await withRuntime(
        runtime.id,
        async gateway =>
          fileUploadValueSchema.parse(
            await gateway.run(
              'fileUploads',
              'upload',
              {
                agentId: input.sessionId,
                request: { data: input.data, ...(input.name === undefined ? {} : { name: input.name }) },
              },
              signal,
            ),
          ),
        { mutation: true },
      )
      return { ok: true as const, value }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  threadTranscript: async ({ input, signal }) => {
    try {
      return await withRuntime(
        input.runtimeId,
        async gateway => {
          const frames = await gateway.follow(
            'session/follow',
            { request: { address: { kind: 'session', sessionId: input.sessionId }, maxMessages: input.maxMessages ?? 60 } },
            15_000,
            signal,
          )
          const snapshot = frames.map(frame => sessionSnapshotSchema.safeParse(frame)).find(result => result.success)?.data
          if (snapshot === undefined)
            throw new GatewayUnavailableError('session-unavailable', 'The host did not return this thread. It may have been deleted there.')
          const reduced = reduceTranscript(snapshot.records)
          return {
            ok: true as const,
            cursor: snapshot.cursor,
            ...(snapshot.header?.cwd === undefined ? {} : { cwd: snapshot.header.cwd }),
            ...(reduced.title === undefined ? {} : { title: reduced.title }),
            ...(reduced.model === undefined ? {} : { model: reduced.model }),
            ...(reduced.waiting === undefined ? {} : { waiting: reduced.waiting }),
            running: reduced.running,
            entries: reduced.entries,
          }
        },
        { mutation: false },
      )
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  threadList: async () => {
    const [threads, runtimes, hosts] = await Promise.all([RemoteThreadStore.list(), HostDirectoryStore.listRuntimes(), HostDirectoryStore.listHosts()])
    return {
      threads: threads.flatMap(thread => {
        const runtime = runtimes.find(item => item.id === thread.runtimeId)
        const host = hosts.find(item => item.id === runtime?.hostId)
        return runtime === undefined ? [] : [{ ...thread, hostName: host?.name ?? runtime.name, connected: pool.status(runtime.id) !== undefined }]
      }),
    }
  },
  threadForget: async ({ input }) => ({ removed: await RemoteThreadStore.forget(input) }),
  threadReply: async ({ input, signal }) => {
    try {
      await withRuntime(
        input.runtimeId,
        gateway =>
          callNativeRpc(
            gateway,
            {
              namespace: 'session',
              method: 'prompt',
              args: {
                request: {
                  requestId: randomUUID(),
                  sessionId: input.sessionId,
                  mode: input.steer ? 'steer' : 'queue',
                  content: [{ type: 'text', text: input.text }],
                },
              },
            },
            signal,
          ),
        { mutation: true, broken: brokenRpc },
      )
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  threadStop: async ({ input, signal }) => {
    try {
      await withRuntime(
        input.runtimeId,
        gateway => callNativeRpc(gateway, { namespace: 'session', method: 'cancel', args: { request: { sessionId: input.sessionId } } }, signal),
        { mutation: true, broken: brokenRpc },
      )
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  runtimeCall: async ({ input, signal }) => {
    const mutation = input.request.namespace !== 'session' || ['create', 'fork', 'cancel', 'rename', 'prompt'].includes(input.request.method)
    try {
      return await withRuntime(input.runtimeId, gateway => NativeRpcModel.call(gateway, input.request, signal), { mutation, broken: brokenRpc })
    } catch (error) {
      return { ok: false as const, ...safeFailure(error) }
    }
  },
  sessionCursor: async ({ input, signal }) =>
    withRuntime(
      input.runtimeId,
      async gateway => {
        const frames = await gateway.follow(
          'session/follow',
          { request: { address: { kind: 'session', sessionId: input.sessionId }, maxMessages: 1 } },
          10_000,
          signal,
        )
        const snapshot = frames.map(frame => sessionCursorFrameSchema.safeParse(frame)).find(result => result.success)
        if (snapshot === undefined) throw new GatewayUnavailableError('session-cursor-unavailable', 'The runtime did not return a session history cursor.')
        return { cursor: snapshot.data.cursor }
      },
      { mutation: false },
    ),
  runtimeOpenView: async ({ input }) => {
    const runtime = await HostDirectoryStore.findRuntime(input.runtimeId)
    if (runtime === undefined) throw new DirectoryStoreError('runtime-not-found', 'Choose a recorded runtime before opening its native view.')
    if (runtime.originPort === undefined)
      throw new GatewayUnavailableError('runtime-origin-unavailable', 'This runtime has no stable browser origin. Re-register it before opening its view.')
    const existing = [...viewLeases.entries()].find(([, lease]) => lease.runtimeId === runtime.id)
    if (existing !== undefined && pool.status(runtime.id)?.generation === existing[1].pooled.generation) {
      return { leaseId: existing[0], launchUrl: existing[1].pooled.gateway.launchUrl }
    }
    if (existing !== undefined) await closeLease(existing[0])
    const pooled = await pool.acquire(runtime.id)
    while (viewLeases.size >= maxViewLeases) {
      const oldest = viewLeases.keys().next().value
      if (oldest === undefined) break
      await closeLease(oldest)
    }
    const leaseId = randomUUID()
    const timer = setTimeout(() => void closeLease(leaseId), viewLeaseTtlMs)
    viewLeases.set(leaseId, { runtimeId: runtime.id, pooled, timer })
    return { leaseId, launchUrl: pooled.gateway.launchUrl }
  },
  runtimeCloseView: async ({ input }) => ({ closed: await closeLease(input.leaseId) }),
  runtimeRemove: async ({ input }) => {
    const removed = await HostDirectoryStore.removeRuntime(input.runtimeId)
    if (removed) {
      await closeRuntimeLeases(input.runtimeId)
      await pool.close(input.runtimeId)
    }
    return { removed }
  },
})

// The members of the Host Loader and Connection services this plugin calls; a Host without them publishes no launch URL.
interface LoaderSurface {
  readonly await?: () => Promise<void>
}

interface ConnectionSurface {
  readonly authenticatedUrl?: (url: string) => string
}

export default defineHost({
  name: '@dshfiles/multi-host',
  Config: configSchema,
  apis: [multiHostHandlers],
  setup(ctx, config) {
    configuredProfile = configSchema.parse(config ?? {}).profile
    // Publish this runtime's launch URL so a manager on another machine can find it over SSH.
    ctx.inject(['connection', 'webServer'], scoped => {
      let launchPath: string | undefined
      let disposed = false
      scoped.effect(() => {
        void (async () => {
          const loader: LoaderSurface | undefined = scoped.get('loader')
          await loader?.await?.()
          const webServer = webServerSchema.safeParse(scoped.get('webServer'))
          const connection: ConnectionSurface | undefined = scoped.get('connection')
          const launchUrl = connection?.authenticatedUrl?.(`http://127.0.0.1:${webServer.success ? webServer.data.port : 0}`)
          if (disposed || !webServer.success || typeof launchUrl !== 'string') return
          const written = await RuntimeLaunchFile.writeLaunchFile({ dshHome: process.env.DSH_HOME ?? join(homedir(), '.dsh'), launchUrl })
          launchPath = written
          // DSH can exit on a signal without disposing plugins; a stale launch file would point managers at a dead port.
          process.once('exit', () => RuntimeLaunchFile.removeLaunchFileSync(written))
        })().catch(() => undefined)
        return () => {
          disposed = true
          if (launchPath !== undefined) void RuntimeLaunchFile.removeLaunchFile(launchPath)
        }
      }, 'multi-host: launch file')
    })
    // A Session of another runtime opens in this Host's own chat and composer: the controller asks this source for any
    // Session it does not hold, and every endpoint forwards to the runtime that owns it.
    ctx.inject(['sessionSources'], scoped => {
      activeSessionSources.add(scoped.sessionSources)
      const unregister = scoped.sessionSources.register(
        createRemoteSessionSource({
          runtimes: {
            list: async () => (await HostDirectoryStore.listRuntimes()).map(runtime => ({ id: runtime.id, label: runtime.name })),
            recordedSessions: async () =>
              (await RemoteThreadStore.list()).map(thread => ({ sessionId: thread.sessionId, runtimeId: thread.runtimeId, cwd: thread.cwd })),
            acquire: runtimeId => pool.acquire(runtimeId),
            run: (runtimeId, request, options) => withRuntime(runtimeId, request, options),
          },
        }),
      )
      scoped.effect(() => () => {
        unregister()
        activeSessionSources.delete(scoped.sessionSources)
      })
    })
    ctx.effect(() => async () => {
      for (const leaseId of [...viewLeases.keys()]) await closeLease(leaseId)
      await pool.close()
    })
  },
})
