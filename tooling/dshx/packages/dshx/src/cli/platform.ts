import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import type { Writable } from 'node:stream'
import { promisify } from 'node:util'
import semver from 'semver'
import { z } from 'zod'
import type { CliArgs } from './args.js'
import { DshPlatformError, connectDshPlatformClient } from '../platform/client.js'
import type { BundleSummary, DshPlatformClient, JsonValue, PluginSummary, SessionSummary } from '../platform/client.js'

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
  const dshVersion = await localDshVersion()
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

  const connect = runtime.connect ?? connectDshPlatformClient
  let client: DshPlatformClient
  try {
    client = await connect(args.url === undefined ? {} : { url: args.url })
  } catch (error) {
    return emitError(args, runtime.io, error)
  }

  try {
    if (args.command === 'sessions') {
      if (action === 'list') {
        const items = await client.sessions.list()
        emitResult(args, runtime.io, { items }, sessionRows(items))
        return 0
      }
      if (action === 'search') {
        const query = parameters.join(' ')
        const result = await client.sessions.search(query)
        const message = result.items.length === 0 ? 'No matching Sessions.' : result.items.map(item => `${item.sessionId}\t${item.snippet}`).join('\n')
        emitResult(args, runtime.io, { query, ...result }, `${message}${result.hasMore ? '\nMore results are available.' : ''}`)
        return 0
      }
      if (action === 'show') {
        const sessionId = parameters[0]
        const item = (await client.sessions.list()).find(session => session.sessionId === sessionId)
        if (!item) throw new DshPlatformError('not-found', `No DSH Session named ${JSON.stringify(sessionId)} exists.`)
        emitResult(args, runtime.io, item, JSON.stringify(item, null, 2))
        return 0
      }
      if (action === 'history') {
        const sessionId = parameters[0]
        const page = await client.sessions.history(sessionId ?? '', args.max)
        emitResult(args, runtime.io, { sessionId, ...page }, JSON.stringify(page, null, 2))
        return 0
      }
      if (action === 'create') {
        const result = await client.sessions.create({
          ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          ...(args.agentPreset === undefined ? {} : { agentPreset: args.agentPreset }),
        })
        emitResult(args, runtime.io, result, `Created Session ${result.sessionId}`)
        return 0
      }
      if (action === 'fork') {
        const result = await client.sessions.fork(parameters[0] ?? '', args.atSeq)
        emitResult(args, runtime.io, result, `Forked Session ${parameters[0]} as ${result.sessionId}`)
        return 0
      }
      if (action === 'cancel') {
        const result = await client.sessions.cancel(parameters[0] ?? '')
        emitResult(args, runtime.io, { sessionId: parameters[0], ...result }, `Cancellation accepted for ${parameters[0]}`)
        return 0
      }
      if (action === 'rename') {
        const sessionId = parameters[0] ?? ''
        const title = parameters.slice(1).join(' ')
        const result = await client.sessions.rename(sessionId, title)
        emitResult(args, runtime.io, { sessionId, ...result }, `Renamed Session ${sessionId} to ${result.title}`)
        return 0
      }
      if (action === 'archive' || action === 'unarchive') {
        const sessionId = parameters[0] ?? ''
        const archived = action === 'archive'
        const result = await (archived ? client.sessions.archive(sessionId) : client.sessions.unarchive(sessionId))
        emitResult(
          args,
          runtime.io,
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
        emitResult(args, runtime.io, { sessionId, mode, ...result }, `Prompt accepted for Session ${sessionId} (${mode})`)
        return 0
      }
      if (action === 'export') {
        const sessionId = parameters[0] ?? ''
        const data = {
          schemaVersion: 1,
          source: 'dshx',
          sessionId,
          records: await client.sessions.export(sessionId),
        }
        if (args.output !== undefined) {
          await writeFile(args.output, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
          emitResult(
            args,
            runtime.io,
            {
              sessionId,
              output: args.output,
              recordCount: data.records.length,
            },
            `Exported ${data.records.length} records to ${args.output}`,
          )
        } else {
          emitResult(args, runtime.io, data, JSON.stringify(data, null, 2))
        }
        return 0
      }
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

export function platformHelp(args: CliArgs): string | undefined {
  const group = args.command
  const nested = args.platformArgs?.[0]
  const output = '[--json] [--quiet] [--no-color]'
  const connection = '[--url <launch-url>]'
  if (group === 'status') return `Usage: dshx status ${connection} ${output}\nChecks authenticated Session, plugin, and bundle APIs.\n`
  if (group === 'info') return `Usage: dshx info ${output}\nShows local DSHX and Node versions; it does not require a running DSH Host.\n`
  if (group === 'doctor') return `Usage: dshx doctor ${connection} ${output}\nChecks local runtime facts and the DSH APIs available to this launch URL.\n`
  if (group === 'sessions') {
    if (nested === 'list') return `Usage: dshx sessions list ${connection} ${output}\nLists Sessions visible to the connected DSH Host.\n`
    if (nested === 'search')
      return `Usage: dshx sessions search <query...> ${connection} ${output}\nSearches visible Session content; DSH returns at most 20 snippets.\n`
    if (nested === 'show') return `Usage: dshx sessions show <session-id> ${connection} ${output}\nShows one Session summary.\n`
    if (nested === 'history')
      return `Usage: dshx sessions history <session-id> [--max <count>] ${connection} ${output}\nReads bounded Session history through DSH's paging API.\n`
    if (nested === 'create')
      return `Usage: dshx sessions create [--cwd <path>] [--agent-preset <id>] ${connection} ${output}\nCreates a Session through the DSH Session API.\n`
    if (nested === 'fork')
      return `Usage: dshx sessions fork <session-id> [--at-seq <n>] ${connection} ${output}\nForks a Session, optionally from a sequence number.\n`
    if (nested === 'cancel') return `Usage: dshx sessions cancel <session-id> ${connection} ${output}\nRequests cancellation of the Session's active work.\n`
    if (nested === 'rename')
      return `Usage: dshx sessions rename <session-id> <title...> ${connection} ${output}\nRenames a Session through DSH's durable Session API.\n`
    if (nested === 'archive' || nested === 'unarchive')
      return `Usage: dshx sessions ${nested} <session-id> ${connection} ${output}\n${nested === 'archive' ? 'Archives' : 'Restores'} a Session using DSH's reversible Workspace API. Active work is not stopped.\n`
    if (nested === 'prompt')
      return `Usage: dshx sessions prompt <session-id> <message...> [--mode queue|steer] ${connection} ${output}\nSends text to the Session Agent; defaults to queue. Ctrl-C asks DSH to cancel prompt admission.\n`
    if (nested === 'export')
      return `Usage: dshx sessions export <session-id> [--output <path>] ${connection} ${output}\nExports Session records as versioned DSHX JSON.\n`
    return `Usage: dshx sessions <list|search|show|history|create|fork|cancel|rename|archive|unarchive|prompt|export> [arguments] [options]\nCommon options: ${connection} ${output}\nSession creation: --cwd <path> --agent-preset <id>\nPrompt: --mode queue|steer\nHistory/fork: --max <count> --at-seq <n>\nExport: --output <path>\n`
  }
  if (group === 'plugins') {
    if (nested === 'list') return `Usage: dshx plugins list ${connection} ${output}\nLists runtime plugin entries and their Loader state.\n`
    if (nested === 'info') return `Usage: dshx plugins info <entry-id> ${connection} ${output}\nShows one runtime plugin entry.\n`
    if (nested === 'check')
      return `Usage: dshx plugins check <package-spec> ${connection} ${output}\nChecks what DSH's plugin manager can install without installing it.\n`
    if (nested === 'enable' || nested === 'disable')
      return `Usage: dshx plugins ${nested} <entry-id> ${connection} ${output}\nChanges the Host-owned plugin selection and reports application/restart state.\n`
    return `Usage: dshx plugins <list|info|check|enable|disable> [entry-id|package-spec] ${connection} ${output}\n`
  }
  if (group === 'bundles') {
    if (nested === 'list') return `Usage: dshx bundles list ${connection} ${output}\nLists bundles and their profile-wide selection/install state.\n`
    if (nested === 'info') return `Usage: dshx bundles info <name> ${connection} ${output}\nShows one bundle and its rows.\n`
    if (nested === 'install')
      return `Usage: dshx bundles install <package-spec> ${connection} ${output}\nInstalls through DSH's bundle manager; Ctrl-C asks DSH to cancel and restore profile files.\n`
    if (nested === 'remove') return `Usage: dshx bundles remove <name> ${connection} ${output}\nRemoves a profile-owned bundle through DSH's package manager.\n`
    if (nested === 'enable' || nested === 'disable')
      return `Usage: dshx bundles ${nested} <name> ${connection} ${output}\nChanges the Host-owned bundle selection and reports application/restart state.\n`
    return `Usage: dshx bundles <list|info|install|remove|enable|disable> [name|package-spec] ${connection} ${output}\n`
  }
  if (group === 'presets') {
    if (nested === 'list') return `Usage: dshx presets list ${connection} ${output}\nLists Agent presets declared by the connected DSH Host.\n`
    if (nested === 'show') return `Usage: dshx presets show <id> ${connection} ${output}\nReads one declared Agent preset composition.\n`
    return `Usage: dshx presets <list|show> [id] ${connection} ${output}\n`
  }
  if (group === 'models') {
    if (nested === 'list') return `Usage: dshx models list ${connection} ${output}\nLists DSH's currently routable provider models and any lookup failures.\n`
    if (nested === 'select')
      return `Usage: dshx models select --session <session-id> <provider> <model> [--reasoning-effort <id>] ${connection} ${output}\nSelects a model for one Session; DSH may persist it as the new default.\n`
    return `Usage: dshx models <list|select> [arguments] ${connection} ${output}\n`
  }
  if (group === 'skills')
    return `Usage: dshx skills list --session <session-id> ${connection} ${output}\nLists the user-invocable skills visible in that Session's composition; skill bodies are not returned.\n`
  if (group === 'commands') {
    if (nested === 'list') return `Usage: dshx commands list --session <session-id> ${connection} ${output}\nLists commands available to the Session.\n`
    if (nested === 'info')
      return `Usage: dshx commands info <command-name> --session <session-id> ${connection} ${output}\nShows a command registered for the Session.\n`
    if (nested === 'run')
      return `Usage: dshx commands run <slash-command> --session <session-id> ${connection} ${output}\n       dshx commands run --line <slash-command> --session <session-id> ${connection} ${output}\nExecutes a registered Session command without a model turn; Ctrl-C cancels the request.\n`
    return `Usage: dshx commands <list|info|run> [command-name|/line] --session <session-id> ${connection} ${output}\n`
  }
  if (group === 'config') {
    if (nested === 'list') return `Usage: dshx config list ${connection} ${output}\nLists settings namespaces and their write/revision metadata.\n`
    if (nested === 'get') return `Usage: dshx config get <namespace> [path] ${connection} ${output}\nReads Host-redacted settings values.\n`
    if (nested === 'set')
      return `Usage: dshx config set <namespace> <path> <json-value> ${connection} ${output}\nWrites one schema-validated setting using its current revision. Secret values must be changed in DSH Settings.\n`
    if (nested === 'unset') return `Usage: dshx config unset <namespace> <path> ${connection} ${output}\nRemoves one setting using its current revision.\n`
    return `Usage: dshx config <list|get|set|unset> [arguments] ${connection} ${output}\nValues use JSON syntax. Secret values are redacted and must be changed in DSH Settings.\n`
  }
  return undefined
}

export async function runPlatformCli(args: CliArgs, runtime: PlatformCliRuntime): Promise<number> {
  if (args.help) {
    const help = platformHelp(args)
    if (help) write(runtime.io.stdout, help)
    return 0
  }
  return runPlatformAction(args, runtime)
}
