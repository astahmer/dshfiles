import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import type { Writable } from 'node:stream'
import { promisify } from 'node:util'
import semver from 'semver'
import { z } from 'zod'
import type { CliArgs } from './args.js'
import { renderCliUsage } from './usage.js'
import { createDshPlatformClientFromTransport, DshPlatformError, connectDshPlatformClient } from '../platform/client.js'
import type { BundleSummary, DshPlatformClient, DshPlatformTransport, JsonValue, PluginSummary, SessionSummary } from '../platform/client.js'
import type { CommunicationClient, ConnectCommunicationClientOptions } from '../communication/bridge.js'
import { runCommunicationCommand } from '../communication/cli.js'
import { connectMultiHost, nativeRpcRequestSchema, type MultiHost, type RuntimeStatusValue } from '../platform/dshx-channel.js'
import {
  createSessionEventDescriber,
  digestSession,
  formatEventClock,
  isNoiseSessionEvent,
  renderSessionDigest,
  sessionEventFilter,
} from '../platform/session-digest.js'

const runFile = promisify(execFile)
const engineRange = '^22.19.0 || >=24.0.0'

export interface PlatformCliIO {
  readonly stdout: Writable
  readonly stderr: Writable
}

export interface PlatformCliRuntime {
  readonly io: PlatformCliIO
  readonly dshxVersion: string
  readonly connect?: typeof connectDshPlatformClient
  readonly connectCommunication?: (options?: ConnectCommunicationClientOptions) => Promise<CommunicationClient>
  readonly readDshVersion?: () => Promise<string | undefined>
  readonly connectMultiHost?: (options: { readonly url?: string }) => Promise<MultiHost>
}

interface DoctorCheck {
  readonly id: string
  readonly status: 'pass' | 'fail' | 'unknown'
  readonly detail: string
}

function write(stream: Writable, value: string): void {
  stream.write(value)
}

function commandName(args: CliArgs): string {
  const action = args.platformArgs?.[0]
  return action === undefined ? (args.command ?? 'unknown') : `${args.command} ${action}`
}

function safeMessage(error: unknown): {
  readonly code: string
  readonly message: string
} {
  if (error instanceof z.ZodError) {
    return { code: 'invalid-response', message: `DSH returned data outside its API contract:\n${z.prettifyError(error)}` }
  }
  const code = error instanceof DshPlatformError ? error.code : 'command-failed'
  const message = error instanceof Error ? error.message : 'The DSH operation failed.'
  return {
    code,
    message: message.replace(/token=[^&\s]*/g, 'token=[redacted]'),
  }
}

function emitResult(args: CliArgs, io: PlatformCliIO, data: JsonValue | object, message: string): void {
  if (args.json) {
    write(io.stdout, `${JSON.stringify({ schemaVersion: 1, command: commandName(args), ok: true, data }, null, 2)}\n`)
    return
  }
  if (args.quiet) return
  write(io.stdout, `${message}\n`)
}

function emitError(args: CliArgs, io: PlatformCliIO, error: unknown): number {
  const problem = safeMessage(error)
  if (args.json) {
    write(io.stdout, `${JSON.stringify({ schemaVersion: 1, command: commandName(args), ok: false, error: problem }, null, 2)}\n`)
  } else {
    write(io.stderr, `error [${problem.code}]: ${problem.message}\n`)
  }
  if (problem.code === 'cancelled') return 130
  return problem.code === 'not-found' ? 4 : 1
}

async function executeCommandWithInterrupt(client: DshPlatformClient, sessionId: string, line: string): Promise<JsonValue | null> {
  const controller = new AbortController()
  const onInterrupt = (): void => controller.abort()
  process.once('SIGINT', onInterrupt)
  try {
    return await client.commands.execute(sessionId, line, controller.signal)
  } finally {
    process.off('SIGINT', onInterrupt)
  }
}

async function promptSessionWithInterrupt(
  client: DshPlatformClient,
  sessionId: string,
  text: string,
  mode: 'queue' | 'steer',
): Promise<{ readonly accepted: true }> {
  const controller = new AbortController()
  const onInterrupt = (): void => controller.abort()
  process.once('SIGINT', onInterrupt)
  try {
    return await client.sessions.prompt(sessionId, text, mode, controller.signal)
  } finally {
    process.off('SIGINT', onInterrupt)
  }
}

async function installBundleWithInterrupt(client: DshPlatformClient, spec: string): Promise<import('../platform/client.js').ChangeResult> {
  const controller = new AbortController()
  const onInterrupt = (): void => controller.abort()
  process.once('SIGINT', onInterrupt)
  try {
    return await client.bundles.install(spec, controller.signal)
  } finally {
    process.off('SIGINT', onInterrupt)
  }
}

function rows<T>(
  items: readonly T[],
  columns: readonly {
    readonly heading: string
    readonly render: (item: T) => string
  }[],
): string {
  const values = items.map(item => columns.map(column => column.render(item).replace(/[\t\r\n]/g, ' ')))
  const widths = columns.map((column, index) => Math.max(column.heading.length, ...values.map(row => row[index]?.length ?? 0)))
  const format = (row: readonly string[]): string =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd()
  return [format(columns.map(column => column.heading)), ...values.map(format)].join('\n')
}

function sessionRows(items: readonly SessionSummary[]): string {
  return rows(items, [
    { heading: 'SESSION', render: item => item.sessionId },
    { heading: 'STATE', render: item => (item.running ? 'running' : 'idle') },
    { heading: 'BLANK', render: item => (item.blank ? 'yes' : 'no') },
    {
      heading: 'UPDATED',
      render: item => new Date(item.updatedAt).toISOString(),
    },
    { heading: 'CWD', render: item => item.cwd ?? '' },
  ])
}

function pluginRows(items: readonly PluginSummary[]): string {
  return rows(items, [
    { heading: 'ID', render: item => item.id },
    { heading: 'PLUGIN', render: item => item.moduleName },
    { heading: 'ENABLED', render: item => (item.enabled ? 'yes' : 'no') },
    { heading: 'PHASE', render: item => item.phase ?? 'unknown' },
  ])
}

function bundleRows(items: readonly BundleSummary[]): string {
  return rows(items, [
    { heading: 'BUNDLE', render: item => item.name },
    { heading: 'ENABLED', render: item => (item.enabled ? 'yes' : 'no') },
    { heading: 'INSTALLED', render: item => (item.installed ? 'yes' : 'no') },
    { heading: 'OPTIONAL', render: item => (item.optional ? 'yes' : 'no') },
    { heading: 'REMOVABLE', render: item => (item.removable ? 'yes' : 'no') },
    { heading: 'ROWS', render: item => String(item.rowCount ?? 0) },
  ])
}

function commandRows(items: readonly { readonly name: string; readonly description?: string }[]): string {
  return rows(items, [
    { heading: 'COMMAND', render: item => `/${item.name}` },
    { heading: 'DESCRIPTION', render: item => item.description ?? '' },
  ])
}

function changeData(result: import('../platform/client.js').ChangeResult): JsonValue {
  return {
    scope: 'connected-host-profile',
    application: result.application,
    changed: result.changed,
    restartRequired: result.application === 'restart-required',
    ...(result.stage === undefined ? {} : { stage: result.stage }),
    ...(result.target === undefined ? {} : { target: result.target }),
    ...(result.enabled === undefined ? {} : { enabled: result.enabled }),
    ...(result.error === undefined ? {} : { error: result.error }),
    warnings: result.warnings,
  }
}

function changeMessage(action: string, target: string, result: import('../platform/client.js').ChangeResult): string {
  const restart = result.application === 'restart-required' ? '; DSH restart required' : ''
  const details = [
    `${action} ${target} in the connected Host profile: ${result.application}${restart}`,
    ...(result.target === undefined ? [] : [`Target: ${result.target}`]),
    ...(result.error === undefined ? [] : [`Error: ${result.error.diagnostic ?? result.error.code}`]),
    ...result.warnings.map(value => `Warning: ${value}`),
  ]
  return details.join('\n')
}

function emitRejectedChange(args: CliArgs, io: PlatformCliIO, action: string, target: string, result: import('../platform/client.js').ChangeResult): number {
  const message = changeMessage(action, target, result)
  if (args.json) {
    write(
      io.stdout,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          command: commandName(args),
          ok: false,
          error: {
            code: `change-${result.application}`,
            message,
            details: changeData(result),
          },
        },
        null,
        2,
      )}\n`,
    )
  } else {
    write(io.stderr, `error [change-${result.application}]: ${message}\n`)
  }
  return 5
}

function findPath(root: JsonValue, path: string | undefined): JsonValue | undefined {
  if (path === undefined || path.length === 0) return root
  let current: JsonValue | undefined = root
  for (const segment of settingsPath(path)) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index < 0) return undefined
      current = current[index]
      continue
    }
    if (current === undefined || !isJsonObject(current)) return undefined
    current = current[segment]
  }
  return current
}

function settingsPath(path: string): string[] {
  const segments = path.split('.')
  if (segments.some(segment => segment.length === 0)) {
    throw new DshPlatformError('invalid-path', 'Settings paths use non-empty dot-separated segments.')
  }
  return segments
}

function overlapsSecretPath(path: readonly string[], secretPath: readonly string[]): boolean {
  const commonLength = Math.min(path.length, secretPath.length)
  return path.slice(0, commonLength).every((segment, index) => segment === secretPath[index])
}

function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asJsonValue(value: unknown): JsonValue {
  const result = z.json().safeParse(value)
  if (!result.success) throw new DshPlatformError('invalid-json-value', 'config set requires a valid JSON value.')
  return result.data
}

function parseJsonInput(value: string): JsonValue {
  try {
    return asJsonValue(JSON.parse(value))
  } catch (error) {
    if (error instanceof DshPlatformError) throw error
    throw new DshPlatformError('invalid-json-value', 'config set requires a valid JSON value.')
  }
}

interface SettingsScope {
  readonly writable: boolean
  readonly namespace: import('../platform/client.js').SettingsNamespace
}

function requireNamespace(client: DshPlatformClient, name: string): Promise<SettingsScope> {
  return client.config.describe().then(description => {
    const namespace = description.namespaces.find(item => item.ns === name)
    if (!namespace) throw new DshPlatformError('not-found', `No DSH settings namespace named ${JSON.stringify(name)} exists.`)
    return { writable: description.writable, namespace }
  })
}

async function localDshVersion(): Promise<string | undefined> {
  try {
    const result = await runFile('dsh', ['--version'], { timeout: 2_000 })
    return result.stdout.trim() || result.stderr.trim() || undefined
  } catch {
    return undefined
  }
}

function doctorCheck(id: string, status: DoctorCheck['status'], detail: string): DoctorCheck {
  return { id, status, detail }
}

async function runDoctor(args: CliArgs, runtime: PlatformCliRuntime): Promise<number> {
  const checks: DoctorCheck[] = []
  const nodeCompatible = semver.satisfies(process.version, engineRange)
  checks.push(doctorCheck('node', nodeCompatible ? 'pass' : 'fail', `${process.version}; required ${engineRange}`))
  checks.push(doctorCheck('dshx', 'pass', `Dshx ${runtime.dshxVersion}`))
  const dshVersion = await (runtime.readDshVersion ?? localDshVersion)()
  checks.push(doctorCheck('dsh-cli', dshVersion === undefined ? 'unknown' : 'pass', dshVersion ?? 'Could not read the local dsh launcher version.'))

  const connect = runtime.connect ?? connectDshPlatformClient
  let client: DshPlatformClient
  try {
    client = await connect(args.url === undefined ? {} : { url: args.url })
  } catch (error) {
    const problem = safeMessage(error)
    checks.push(doctorCheck('host-rpc', 'fail', problem.message))
    checks.push(doctorCheck('profile', 'unknown', 'The active profile identity is not exposed by DSH Remote APIs.'))
    checks.push(doctorCheck('client-build', 'unknown', 'DSH does not expose Client build state through a Remote API.'))
    checks.push(doctorCheck('plugin-compatibility', 'unknown', 'DSH does not expose a runtime compatibility inventory.'))
    const data = {
      dshxVersion: runtime.dshxVersion,
      nodeVersion: process.version,
      dshCliVersion: dshVersion ?? null,
      checks,
    }
    emitResult(args, runtime.io, data, checks.map(item => `${item.status.toUpperCase()} ${item.id}: ${item.detail}`).join('\n'))
    return 1
  }

  const [sessionResult, pluginResult, bundleResult, settingsResult] = await Promise.allSettled([
    client.sessions.list(),
    client.plugins.list(),
    client.bundles.list(),
    client.config.describe(),
  ])
  const rpcFailures = [sessionResult, pluginResult, bundleResult, settingsResult].filter(result => result.status === 'rejected')
  checks.push(
    doctorCheck(
      'host-rpc',
      rpcFailures.length === 0 ? 'pass' : 'fail',
      rpcFailures.length === 0 ? 'Session, plugin, bundle, and settings RPCs responded.' : `${rpcFailures.length} DSH API probes failed.`,
    ),
  )
  checks.push(doctorCheck('profile', 'unknown', 'The active profile identity is not exposed by DSH Remote APIs.'))
  checks.push(doctorCheck('client-build', 'unknown', 'DSH does not expose Client build state through a Remote API.'))
  checks.push(doctorCheck('plugin-compatibility', 'unknown', 'DSH does not expose declared plugin peer ranges through a Remote API.'))

  if (pluginResult.status === 'fulfilled') {
    const duplicateNames = new Set<string>()
    const seenNames = new Set<string>()
    for (const plugin of pluginResult.value) {
      if (seenNames.has(plugin.moduleName)) duplicateNames.add(plugin.moduleName)
      seenNames.add(plugin.moduleName)
    }
    const broken = pluginResult.value.filter(plugin => plugin.phase === 'failed')
    const detail = [
      `${pluginResult.value.length} plugin entries`,
      broken.length === 0 ? 'no failed Loader entries' : `${broken.length} failed or broken entries: ${broken.map(plugin => plugin.id).join(', ')}`,
      duplicateNames.size === 0 ? 'no duplicate module names' : `duplicate module names: ${[...duplicateNames].join(', ')}`,
    ].join('; ')
    checks.push(doctorCheck('plugins', broken.length === 0 && duplicateNames.size === 0 ? 'pass' : 'fail', detail))
  }
  if (bundleResult.status === 'fulfilled') {
    const broken = bundleResult.value.filter(bundle => bundle.error !== undefined || (bundle.enabled && !bundle.installed))
    checks.push(
      doctorCheck(
        'bundles',
        broken.length === 0 ? 'pass' : 'fail',
        broken.length === 0
          ? `${bundleResult.value.length} bundle records; no reported install errors.`
          : `${broken.length} bundle records report errors or missing selected installs: ${broken.map(bundle => bundle.name).join(', ')}`,
      ),
    )
  }
  if (settingsResult.status === 'fulfilled') {
    const description = settingsResult.value
    checks.push(
      doctorCheck(
        'settings',
        'pass',
        `${description.namespaces.length} redacted settings namespaces; writes ${description.writable ? 'available' : 'unavailable'}.`,
      ),
    )
  }
  checks.push(doctorCheck('configuration', 'unknown', 'DSH exposes scoped settings schemas; profile patch composition and credential values stay Host-owned.'))

  const data = {
    dshxVersion: runtime.dshxVersion,
    nodeVersion: process.version,
    dshCliVersion: dshVersion ?? null,
    checks,
  }
  const message = checks.map(item => `${item.status.toUpperCase()} ${item.id}: ${item.detail}`).join('\n')
  emitResult(args, runtime.io, data, message)
  return checks.some(item => item.status === 'fail') ? 1 : 0
}

async function runStatus(args: CliArgs, runtime: PlatformCliRuntime): Promise<number> {
  const connect = runtime.connect ?? connectDshPlatformClient
  try {
    const client = await connect(args.url === undefined ? {} : { url: args.url })
    const [sessions, plugins, bundles] = await Promise.all([client.sessions.list(), client.plugins.list(), client.bundles.list()])
    const data = {
      connected: true,
      dshxVersion: runtime.dshxVersion,
      hostVersion: null,
      hostVersionStatus: 'unavailable',
      sessions: sessions.length,
      plugins: plugins.length,
      bundles: bundles.length,
    }
    emitResult(
      args,
      runtime.io,
      data,
      `DSH Host connected\nSessions: ${sessions.length}\nPlugins: ${plugins.length}\nBundles: ${bundles.length}\nHost version: not exposed by DSH API`,
    )
    return 0
  } catch (error) {
    return emitError(args, runtime.io, error)
  }
}

interface SelectedRemoteRuntime {
  readonly hostId: string
  readonly hostName: string
  readonly runtimeId: string
  readonly runtimeName: string
}

const selectRemoteRuntime = async (multiHost: MultiHost, selector: string): Promise<SelectedRemoteRuntime> => {
  const directory = await multiHost.list()
  const candidates = directory.runtimes.filter(item => item.id === selector || item.hostId === selector)
  if (candidates.length === 0) throw new DshPlatformError('runtime-not-found', `No registered runtime matches ${JSON.stringify(selector)}.`)
  if (candidates.length > 1) {
    const runtimeIds = candidates.map(item => item.id).join(', ')
    throw new DshPlatformError('runtime-ambiguous', `Host ${JSON.stringify(selector)} has multiple runtimes. Select one runtime id: ${runtimeIds}.`)
  }
  const runtime = candidates[0]
  if (runtime === undefined) throw new DshPlatformError('runtime-not-found', `No registered runtime matches ${JSON.stringify(selector)}.`)
  const host = directory.hosts.find(item => item.id === runtime.hostId)
  if (host === undefined) throw new DshPlatformError('host-not-found', 'The selected runtime has no recorded host.')
  return { hostId: host.id, hostName: host.name, runtimeId: runtime.id, runtimeName: runtime.name }
}

const remoteSessionClient = (multiHost: MultiHost, runtimeId: string): DshPlatformClient =>
  createDshPlatformClientFromTransport({
    rpc: async (namespace, method, args, signal) => {
      const request = nativeRpcRequestSchema.parse({ namespace, method, args })
      const response = await multiHost.runtimeCall(runtimeId, request, signal)
      if (!response.ok) throw new DshPlatformError(response.code, response.message)
      return response.value
    },
    sessionCursor: async sessionId => (await multiHost.sessionCursor(runtimeId, sessionId)).cursor,
  } satisfies DshPlatformTransport)

const requireOnlineRuntime = (status: RuntimeStatusValue) => {
  if (!status.ok) throw new DshPlatformError(status.code, status.message)
  return status
}

const runtimeStatusText = (status: RuntimeStatusValue): string => {
  if (!status.ok) return `OFFLINE ${status.runtimeId}: ${status.code} — ${status.message}`
  const workspaces = status.workspaces.map(item => `${item.workspaceId}\t${item.path}\t${item.title}`).join('\n') || '(none)'
  const sessions =
    status.sessions.map(item => `${item.sessionId}\t${item.cwd ?? ''}\t${item.running ? 'running' : item.blank ? 'blank' : 'idle'}`).join('\n') || '(none)'
  return `ONLINE ${status.runtime.id} (${status.runtime.name}) on ${status.host.name}\nProfile: ${status.identity.profile} · DSH ${status.identity.dshVersion}\nWorkspaces:\n${workspaces}\nSessions:\n${sessions}`
}

async function runPlatformAction(args: CliArgs, runtime: PlatformCliRuntime): Promise<number> {
  const action = args.platformArgs?.[0]
  const parameters = args.platformArgs?.slice(1) ?? []
  if (args.command === 'info') {
    const compatible = semver.satisfies(process.version, engineRange)
    const data = {
      dshxVersion: runtime.dshxVersion,
      nodeVersion: process.version,
      nodeCompatible: compatible,
      requiredNode: engineRange,
      hostVersion: null,
      activeProfile: null,
    }
    emitResult(
      args,
      runtime.io,
      data,
      `DSHX ${runtime.dshxVersion}\nNode ${process.version} (${compatible ? 'supported' : `requires ${engineRange}`})\nHost version and active profile: unavailable until queried through DSH APIs`,
    )
    return compatible ? 0 : 1
  }
  if (args.command === 'doctor') return runDoctor(args, runtime)
  if (args.command === 'status') return runStatus(args, runtime)
  if (args.command === 'host' || args.command === 'runtime' || args.command === 'workspace') {
    const connect = connectMultiHostRuntime(runtime)
    let multiHost: MultiHost
    try {
      multiHost = await connect({ ...(args.url === undefined ? {} : { url: args.url }) })
    } catch (error) {
      return emitError(args, runtime.io, error)
    }
    try {
      if (args.command === 'host') {
        if (action === 'list') {
          const directory = await multiHost.list()
          const rows = directory.hosts
          emitResult(
            args,
            runtime.io,
            { items: rows },
            rows.length === 0
              ? 'No recorded hosts. Add one with `dshx host add`.'
              : rows.map(host => `${host.id}\t${host.name}\t${host.connector.kind}\t${host.runtimeCount} runtime(s)`).join('\n'),
          )
          return 0
        }
        if (action === 'status') {
          const hostId = parameters[0] ?? ''
          const directory = await multiHost.list()
          const host = directory.hosts.find(item => item.id === hostId)
          if (host === undefined) throw new DshPlatformError('host-not-found', `No recorded host ${JSON.stringify(hostId)}.`)
          const runtimes = directory.runtimes.filter(item => item.hostId === host.id)
          if (runtimes.length === 0) throw new DshPlatformError('host-has-no-runtimes', `Host ${host.id} has no registered runtimes.`)
          const statuses = await Promise.all(runtimes.map(item => multiHost.runtimeStatus(item.id)))
          const online = statuses.filter(status => status.ok).length
          emitResult(
            args,
            runtime.io,
            { host, runtimes: statuses },
            `Host ${host.id} (${host.name}) · ${online}/${statuses.length} runtime(s) online\n${statuses.map(runtimeStatusText).join('\n\n')}`,
          )
          return online === statuses.length ? 0 : 1
        }
        if (action === 'remove') {
          const hostId = parameters[0] ?? ''
          const { removed } = await multiHost.hostRemove(hostId, args.directoryOnly)
          emitResult(args, runtime.io, { removed }, removed ? `Removed host ${hostId}. Remote data remains intact.` : `No recorded host ${hostId}.`)
          return removed ? 0 : 4
        }
        if (action === 'add') {
          const id = parameters[0] ?? ''
          const name = parameters.slice(1).join(' ').trim()
          const connector = args.local ? { kind: 'local' as const } : { kind: 'ssh' as const, sshTarget: args.sshTarget ?? '' }
          const host = await multiHost.hostUpsert({ id, name, connector })
          emitResult(args, runtime.io, host, `Recorded ${host.name} (${host.id}) as a ${host.connector.kind} host.`)
          return 0
        }
      }
      if (args.command === 'runtime') {
        if (action === 'list') {
          const rows = (await multiHost.runtimeList(parameters[0])).runtimes
          emitResult(
            args,
            runtime.io,
            { items: rows },
            rows.length === 0
              ? 'No registered runtimes.'
              : rows.map(item => `${item.id}\t${item.name}\t${item.identity?.profile ?? 'identity unavailable'}\t${item.hostId}`).join('\n'),
          )
          return 0
        }
        if (action === 'status') {
          const status = await multiHost.runtimeStatus(parameters[0] ?? '')
          emitResult(args, runtime.io, status, runtimeStatusText(status))
          return status.ok ? 0 : 1
        }
        if (action === 'add') {
          const hostId = parameters[0] ?? ''
          const name = parameters.slice(1).join(' ').trim()
          const directory = await multiHost.list()
          const host = directory.hosts.find(item => item.id === hostId)
          if (host === undefined) throw new DshPlatformError('host-not-found', `No recorded host ${JSON.stringify(hostId)}.`)
          const locator =
            host.connector.kind === 'local'
              ? (() => {
                  const environmentName = args.launchUrlEnv
                  if (environmentName === undefined) throw new DshPlatformError('usage', 'Local runtime add requires --launch-url-env <name>.')
                  const launchUrl = process.env[environmentName]
                  if (launchUrl === undefined || launchUrl.length === 0)
                    throw new DshPlatformError('missing-launch-url', `Environment variable ${environmentName} is not set.`)
                  return { kind: 'local' as const, launchUrl }
                })()
              : (() => {
                  if (args.unit === undefined || args.remoteHome === undefined)
                    throw new DshPlatformError('usage', 'SSH runtime add requires --unit and --remote-home.')
                  return { kind: 'ssh' as const, unit: args.unit, remoteHome: args.remoteHome }
                })()
          const registration = await multiHost.runtimeUpsert({ hostId, name, locator })
          if (!registration.ok) throw new DshPlatformError(registration.code, registration.message)
          const added = registration.runtime
          emitResult(args, runtime.io, added, `Registered runtime ${added.id} (${added.name}) on host ${added.hostId}.`)
          return 0
        }
        if (action === 'remove') {
          const runtimeId = parameters[0] ?? ''
          const { removed } = await multiHost.runtimeRemove(runtimeId)
          emitResult(args, runtime.io, { removed }, removed ? `Removed runtime ${runtimeId}. Remote data remains intact.` : `No recorded runtime ${runtimeId}.`)
          return removed ? 0 : 4
        }
      }
      if (args.command === 'workspace') {
        if (action === 'list') {
          const selection = await selectRemoteRuntime(multiHost, parameters[0] ?? '')
          const status = requireOnlineRuntime(await multiHost.runtimeStatus(selection.runtimeId))
          const workspaces = status.workspaces
          emitResult(
            args,
            runtime.io,
            { placement: selection, items: workspaces },
            workspaces.length === 0
              ? `No workspaces on ${selection.runtimeName}.`
              : workspaces.map(item => `${item.workspaceId}\t${item.path}\t${item.title}`).join('\n'),
          )
          return 0
        }
        if (action === 'open') {
          const [selector, ...pathParts] = parameters
          const path = pathParts.join(' ')
          if (selector === undefined || !path.startsWith('/'))
            throw new DshPlatformError('usage', 'Workspace paths must be absolute paths on the selected runtime.')
          const selection = await selectRemoteRuntime(multiHost, selector)
          const created = await multiHost.workspaceOpen(selection.runtimeId, path)
          emitResult(
            args,
            runtime.io,
            { placement: selection, workspace: created },
            `Workspace ${created.workspaceId} at ${created.path} on runtime ${selection.runtimeId}`,
          )
          return 0
        }
      }
    } catch (error) {
      return emitError(args, runtime.io, error)
    }
  }

  if (args.command === 'comm') {
    return runCommunicationCommand(args, {
      io: runtime.io,
      ...(runtime.connectCommunication === undefined ? {} : { connect: runtime.connectCommunication }),
    })
  }

  let selectedPlacement: SelectedRemoteRuntime | undefined
  let client: DshPlatformClient
  if (args.command === 'sessions' && args.hostSelector !== undefined) {
    try {
      const multiHost = await connectMultiHostRuntime(runtime)({ ...(args.url === undefined ? {} : { url: args.url }) })
      selectedPlacement = await selectRemoteRuntime(multiHost, args.hostSelector)
      client = remoteSessionClient(multiHost, selectedPlacement.runtimeId)
    } catch (error) {
      return emitError(args, runtime.io, error)
    }
  } else {
    const connect = runtime.connect ?? connectDshPlatformClient
    try {
      client = await connect(args.url === undefined ? {} : { url: args.url })
    } catch (error) {
      return emitError(args, runtime.io, error)
    }
  }

  const emitSessionResult = (data: JsonValue | object, message: string): void => {
    if (selectedPlacement === undefined) {
      emitResult(args, runtime.io, data, message)
      return
    }
    emitResult(args, runtime.io, { placement: selectedPlacement, result: data }, `${message} [${selectedPlacement.runtimeId} on ${selectedPlacement.hostName}]`)
  }

  try {
    if (args.command === 'sessions') {
      if (action === 'list') {
        const items = await client.sessions.list()
        emitSessionResult({ items }, sessionRows(items))
        return 0
      }
      if (action === 'search') {
        const query = parameters.join(' ')
        const result = await client.sessions.search(query)
        const message = result.items.length === 0 ? 'No matching Sessions.' : result.items.map(item => `${item.sessionId}\t${item.snippet}`).join('\n')
        emitSessionResult({ query, ...result }, `${message}${result.hasMore ? '\nMore results are available.' : ''}`)
        return 0
      }
      if (action === 'show') {
        const sessionId = parameters[0]
        const item = (await client.sessions.list()).find(session => session.sessionId === sessionId)
        if (!item) throw new DshPlatformError('not-found', `No DSH Session named ${JSON.stringify(sessionId)} exists.`)
        emitSessionResult(item, JSON.stringify(item, null, 2))
        return 0
      }
      if (action === 'history') {
        const sessionId = parameters[0]
        const page = await client.sessions.history(sessionId ?? '', args.max)
        emitSessionResult({ sessionId, ...page }, JSON.stringify(page, null, 2))
        return 0
      }
      if (action === 'create') {
        const result = await client.sessions.create({
          ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          ...(args.agentPreset === undefined ? {} : { agentPreset: args.agentPreset }),
        })
        emitSessionResult(result, `Created Session ${result.sessionId}`)
        return 0
      }
      if (action === 'fork') {
        const result = await client.sessions.fork(parameters[0] ?? '', args.atSeq)
        emitSessionResult(result, `Forked Session ${parameters[0]} as ${result.sessionId}`)
        return 0
      }
      if (action === 'cancel') {
        const result = await client.sessions.cancel(parameters[0] ?? '')
        emitSessionResult({ sessionId: parameters[0], ...result }, `Cancellation accepted for ${parameters[0]}`)
        return 0
      }
      if (action === 'rename') {
        const sessionId = parameters[0] ?? ''
        const title = parameters.slice(1).join(' ')
        const result = await client.sessions.rename(sessionId, title)
        emitSessionResult({ sessionId, ...result }, `Renamed Session ${sessionId} to ${result.title}`)
        return 0
      }
      if (action === 'archive' || action === 'unarchive') {
        const sessionId = parameters[0] ?? ''
        const archived = action === 'archive'
        const result = await (archived ? client.sessions.archive(sessionId) : client.sessions.unarchive(sessionId))
        emitSessionResult(
          {
            sessionId,
            archived,
            archivedSessionIds: result.archivedSessionIds,
          },
          `${archived ? 'Archived' : 'Restored'} Session ${sessionId}`,
        )
        return 0
      }
      if (action === 'prompt') {
        const sessionId = parameters[0] ?? ''
        const mode = args.mode ?? 'queue'
        const result = await promptSessionWithInterrupt(client, sessionId, parameters.slice(1).join(' '), mode)
        emitSessionResult({ sessionId, mode, ...result }, `Prompt accepted for Session ${sessionId} (${mode})`)
        return 0
      }
      if (action === 'export') {
        const sessionId = parameters[0] ?? ''
        const data = {
          schemaVersion: 1,
          source: 'dshx',
          sessionId,
          ...(selectedPlacement === undefined ? {} : { placement: selectedPlacement }),
          records: await client.sessions.export(sessionId, {
            ...(args.sinceSeq === undefined ? {} : { afterSeq: args.sinceSeq }),
            ...(args.tail === undefined ? {} : { newest: args.tail }),
            ...(args.types === undefined ? {} : { keep: sessionEventFilter(args.types) }),
          }),
        }
        if (args.output !== undefined) {
          await writeFile(args.output, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
          emitSessionResult(
            {
              sessionId,
              output: args.output,
              recordCount: data.records.length,
            },
            `Exported ${data.records.length} records to ${args.output}`,
          )
        } else {
          emitSessionResult(data, JSON.stringify(data, null, 2))
        }
        return 0
      }
    }

    if (args.command === 'sessions' && action === 'digest') {
      const sessionId = parameters[0] ?? ''
      const summary = (await client.sessions.list()).find(session => session.sessionId === sessionId)
      if (!summary) throw new DshPlatformError('not-found', `No DSH Session named ${JSON.stringify(sessionId)} exists.`)
      const records = await client.sessions.export(sessionId)
      const now = Date.now()
      const digest = digestSession({ summary, records, now, ...(args.limit === undefined ? {} : { actionLimit: args.limit }) })
      emitSessionResult(digest, renderSessionDigest(digest, now))
      return 0
    }

    if (args.command === 'sessions' && action === 'tail') {
      const sessionId = parameters[0] ?? ''
      const keep = args.types === undefined ? (record: JsonValue) => !isNoiseSessionEvent(record) : sessionEventFilter(args.types)
      const describe = createSessionEventDescriber()
      const describeAll = (records: readonly JsonValue[]) => records.flatMap(record => describe(record) ?? [])
      const line = (item: NonNullable<ReturnType<typeof describe>>): string =>
        `#${item.seq} ${formatEventClock(item.time)} ${item.type.padEnd(17)} ${item.summary}`
      const throughSeq = await client.sessions.cursor(sessionId)
      const initialRange = {
        throughSeq,
        keep,
        ...(args.sinceSeq === undefined ? { newest: args.tail ?? 40 } : { afterSeq: args.sinceSeq }),
        ...(args.sinceSeq !== undefined && args.tail !== undefined ? { newest: args.tail } : {}),
      }
      const initial = describeAll(await client.sessions.export(sessionId, initialRange))
      if (!args.follow) {
        emitSessionResult({ sessionId, throughSeq, items: initial }, initial.map(line).join('\n') || '(no matching events)')
        return 0
      }
      const print = (items: readonly NonNullable<ReturnType<typeof describe>>[]): void => {
        for (const item of items) write(runtime.io.stdout, `${args.json ? JSON.stringify(item) : line(item)}\n`)
      }
      print(initial)
      const controller = new AbortController()
      const onInterrupt = (): void => controller.abort()
      process.once('SIGINT', onInterrupt)
      try {
        let lastSeq = throughSeq
        while (!controller.signal.aborted) {
          await new Promise(resolve => {
            const timer = setTimeout(resolve, 2_000)
            controller.signal.addEventListener('abort', () => {
              clearTimeout(timer)
              resolve(undefined)
            })
          })
          if (controller.signal.aborted) break
          const cursor = await client.sessions.cursor(sessionId)
          if (cursor <= lastSeq) continue
          print(describeAll(await client.sessions.export(sessionId, { afterSeq: lastSeq, throughSeq: cursor, keep })))
          lastSeq = cursor
        }
      } finally {
        process.off('SIGINT', onInterrupt)
      }
      return 0
    }

    if (args.command === 'plugins') {
      if (action === 'list') {
        const items = await client.plugins.list()
        emitResult(args, runtime.io, { items }, pluginRows(items))
        return 0
      }
      if (action === 'info') {
        const item = (await client.plugins.list()).find(plugin => plugin.id === parameters[0])
        if (!item) throw new DshPlatformError('not-found', `No DSH plugin entry named ${JSON.stringify(parameters[0])} exists.`)
        emitResult(args, runtime.io, item, JSON.stringify(item, null, 2))
        return 0
      }
      if (action === 'check') {
        const spec = parameters[0] ?? ''
        const result = await client.plugins.check(spec)
        if (result.status === 'refused') {
          const message = `DSH cannot install ${JSON.stringify(spec)}: ${result.reason}`
          if (args.json) {
            write(
              runtime.io.stdout,
              `${JSON.stringify({ schemaVersion: 1, command: commandName(args), ok: false, error: { code: `plugin-${result.problem}`, message, details: result } }, null, 2)}\n`,
            )
          } else {
            write(runtime.io.stderr, `error [plugin-${result.problem}]: ${message}\n`)
          }
          return 1
        }
        emitResult(
          args,
          runtime.io,
          result,
          `${result.name ?? spec}${result.version === undefined ? '' : `@${result.version}`}: accepted ${result.kind} spec${result.bundle === true ? ' (DSH bundle)' : ''}`,
        )
        return 0
      }
      if (action === 'enable' || action === 'disable') {
        const enabled = action === 'enable'
        const target = parameters[0] ?? ''
        const result = await client.plugins.setEnabled(target, enabled)
        if (result.application === 'failed' || result.application === 'cancelled' || result.application === 'overridden')
          return emitRejectedChange(args, runtime.io, action, target, result)
        emitResult(args, runtime.io, changeData(result), changeMessage(action, target, result))
        return 0
      }
    }

    if (args.command === 'bundles') {
      if (action === 'list') {
        const items = await client.bundles.list()
        emitResult(args, runtime.io, { items }, bundleRows(items))
        return 0
      }
      if (action === 'info') {
        const item = (await client.bundles.list()).find(bundle => bundle.name === parameters[0])
        if (!item) throw new DshPlatformError('not-found', `No DSH bundle named ${JSON.stringify(parameters[0])} exists.`)
        emitResult(args, runtime.io, item, JSON.stringify(item, null, 2))
        return 0
      }
      if (action === 'install') {
        const spec = parameters[0] ?? ''
        const result = await installBundleWithInterrupt(client, spec)
        if (result.application === 'failed' || result.application === 'cancelled' || result.application === 'overridden')
          return emitRejectedChange(args, runtime.io, 'install bundle', spec, result)
        emitResult(args, runtime.io, changeData(result), changeMessage('install bundle', spec, result))
        return 0
      }
      if (action === 'remove') {
        const name = parameters[0] ?? ''
        const result = await client.bundles.remove(name)
        if (result.application === 'failed' || result.application === 'cancelled' || result.application === 'overridden')
          return emitRejectedChange(args, runtime.io, 'remove bundle', name, result)
        emitResult(args, runtime.io, changeData(result), changeMessage('remove bundle', name, result))
        return 0
      }
      if (action === 'enable' || action === 'disable') {
        const target = parameters[0] ?? ''
        const result = await client.bundles.setEnabled(target, action === 'enable')
        if (result.application === 'failed' || result.application === 'cancelled' || result.application === 'overridden')
          return emitRejectedChange(args, runtime.io, action, target, result)
        emitResult(args, runtime.io, changeData(result), changeMessage(`${action} bundle`, target, result))
        return 0
      }
    }

    if (args.command === 'presets') {
      if (action === 'list') {
        const items = await client.presets.list()
        emitResult(
          args,
          runtime.io,
          { items },
          rows(items, [
            { heading: 'PRESET', render: item => item.id },
            {
              heading: 'DEFAULT',
              render: item => (item.isDefault ? 'yes' : 'no'),
            },
            {
              heading: 'STATUS',
              render: item => (item.broken === undefined ? 'available' : `broken: ${item.broken}`),
            },
            {
              heading: 'DESCRIPTION',
              render: item => item.description ?? item.name ?? '',
            },
          ]),
        )
        return 0
      }
      if (action === 'show') {
        const preset = await client.presets.show(parameters[0] ?? '')
        emitResult(args, runtime.io, preset, JSON.stringify(preset, null, 2))
        return 0
      }
    }

    if (args.command === 'models') {
      if (action === 'list') {
        const catalog = await client.models.list()
        const items = catalog.groups.flatMap(group =>
          group.models.map(model => ({
            provider: group.id,
            providerName: group.name,
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
            ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
          })),
        )
        const table = rows(items, [
          { heading: 'PROVIDER', render: item => item.provider },
          { heading: 'MODEL', render: item => item.id },
          { heading: 'NAME', render: item => item.name },
          {
            heading: 'REASONING',
            render: item => item.reasoning?.efforts.map(effort => effort.id).join(', ') ?? '',
          },
        ])
        const failureText = catalog.failures.map(item => `Unavailable ${item.id}: ${item.message}`).join('\n')
        emitResult(
          args,
          runtime.io,
          {
            default: catalog.default,
            routableProviders: catalog.routableProviders,
            items,
            failures: catalog.failures,
          },
          [`Default: ${catalog.default.provider}/${catalog.default.model}`, table, failureText].filter(Boolean).join('\n'),
        )
        return 0
      }
      if (action === 'select') {
        const sessionId = args.session ?? ''
        const selection = await client.models.select(sessionId, {
          provider: parameters[0] ?? '',
          model: parameters[1] ?? '',
          ...(args.reasoningEffort === undefined ? {} : { reasoningEffort: args.reasoningEffort }),
        })
        emitResult(
          args,
          runtime.io,
          { sessionId, selected: selection },
          `Selected ${selection.provider}/${selection.model} for Session ${sessionId}; DSH may also persist it as the new default model.`,
        )
        return 0
      }
    }

    if (args.command === 'skills' && action === 'list') {
      const sessionId = args.session ?? ''
      const items = await client.skills.list(sessionId)
      emitResult(
        args,
        runtime.io,
        { sessionId, items },
        rows(items, [
          { heading: 'SKILL', render: item => `/${item.name}` },
          {
            heading: 'MODEL',
            render: item => (item.modelInvocable ? 'yes' : 'no'),
          },
          { heading: 'DESCRIPTION', render: item => item.description },
        ]),
      )
      return 0
    }

    if (args.command === 'commands') {
      const sessionId = args.session ?? ''
      if (action === 'list') {
        const items = await client.commands.list(sessionId)
        emitResult(args, runtime.io, { sessionId, items }, commandRows(items))
        return 0
      }
      if (action === 'info') {
        const item = (await client.commands.list(sessionId)).find(command => command.name === parameters[0])
        if (!item) throw new DshPlatformError('not-found', `No DSH command named ${JSON.stringify(parameters[0])} is registered for Session ${sessionId}.`)
        emitResult(args, runtime.io, { sessionId, ...item }, JSON.stringify(item, null, 2))
        return 0
      }
      if (action === 'run') {
        const line = args.line ?? parameters.join(' ')
        const result = await executeCommandWithInterrupt(client, sessionId, line)
        emitResult(args, runtime.io, { sessionId, line, result }, result === null ? 'Command completed.' : JSON.stringify(result, null, 2))
        return 0
      }
    }

    if (args.command === 'config') {
      if (action === 'list') {
        const description = await client.config.describe()
        const items = description.namespaces.map(item => ({
          ns: item.ns,
          revision: item.revision,
          applies: item.applies ?? null,
        }))
        emitResult(
          args,
          runtime.io,
          {
            writable: description.writable,
            hasDocument: description.hasDocument,
            namespaces: items,
          },
          items.map(item => `${item.ns}\trevision ${item.revision}\t${item.applies ?? 'apply mode unknown'}`).join('\n'),
        )
        return 0
      }
      const namespace = parameters[0]
      if (namespace === undefined) throw new DshPlatformError('invalid-command', 'A settings namespace is required.')
      const settingsScope = await requireNamespace(client, namespace)
      const namespaceView = settingsScope.namespace
      if (action === 'get') {
        const path = parameters[1]
        const pathSegments = path === undefined ? [] : settingsPath(path)
        const secret = namespaceView.secrets.find(
          item => item.path.length === pathSegments.length && item.path.every((segment, index) => segment === pathSegments[index]),
        )
        if (secret !== undefined) {
          const data = {
            namespace,
            path: path ?? '',
            revision: namespaceView.revision,
            value: null,
            redacted: true,
            configured: secret.set,
          }
          emitResult(args, runtime.io, data, `Secret value at ${namespace}.${path} is redacted (${secret.set ? 'configured' : 'not configured'}).`)
          return 0
        }
        const value = findPath(namespaceView.value, path)
        if (value === undefined) throw new DshPlatformError('not-found', `No value exists at ${namespace}${path ? `.${path}` : ''}.`)
        const data = {
          namespace,
          path: path ?? '',
          revision: namespaceView.revision,
          value,
        }
        emitResult(args, runtime.io, data, JSON.stringify(value, null, 2))
        return 0
      }
      if (action === 'set' || action === 'unset') {
        const path = parameters[1]
        if (path === undefined) throw new DshPlatformError('invalid-command', `config ${action} requires a path.`)
        const rawValue = parameters.slice(2).join(' ')
        const value = action === 'set' ? parseJsonInput(rawValue) : undefined
        const pathSegments = settingsPath(path)
        if (action === 'set' && namespaceView.secrets.some(secret => overlapsSecretPath(pathSegments, secret.path))) {
          throw new DshPlatformError('secret-input-unsupported', 'DSH redacts secret values from its API; set secret fields in the DSH Settings UI.')
        }
        if (!settingsScope.writable) throw new DshPlatformError('read-only', 'DSH reports that this settings configuration is read-only.')
        const updated = await client.config.mutate(namespace, pathSegments, value, namespaceView.revision)
        const changed = updated.namespaces.find(item => item.ns === namespace)
        const data = {
          namespace,
          path,
          revision: changed?.revision ?? null,
          value: changed ? (findPath(changed.value, path) ?? null) : null,
          applied: true,
        }
        emitResult(args, runtime.io, data, `${action === 'set' ? 'Set' : 'Unset'} ${namespace}.${path}`)
        return 0
      }
    }

    throw new DshPlatformError('invalid-command', `Unsupported DSH platform command ${commandName(args)}.`)
  } catch (error) {
    return emitError(args, runtime.io, error)
  }
}

const connectMultiHostRuntime = (runtime: PlatformCliRuntime): ((options: { readonly url?: string }) => Promise<MultiHost>) =>
  runtime.connectMultiHost ?? (options => connectMultiHost(options))

export async function runPlatformCli(args: CliArgs, runtime: PlatformCliRuntime): Promise<number> {
  if (args.help) {
    write(runtime.io.stdout, await renderCliUsage(args))
    return 0
  }
  return runPlatformAction(args, runtime)
}
