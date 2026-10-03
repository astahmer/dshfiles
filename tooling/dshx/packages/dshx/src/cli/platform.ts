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
  return action === undefined ? args.command ?? 'unknown' : `${args.command} ${action}`
}

function safeMessage(error: unknown): { readonly code: string; readonly message: string } {
  const code = error instanceof DshPlatformError ? error.code : 'command-failed'
  const message = error instanceof Error ? error.message : 'The DSH operation failed.'
  return { code, message: message.replace(/token=[^&\s]*/g, 'token=[redacted]') }
}

function emitResult(args: CliArgs, io: PlatformCliIO, data: JsonValue | object, message: string): void {
  if (args.quiet) return
  if (args.json) {
    write(io.stdout, `${JSON.stringify({ schemaVersion: 1, command: commandName(args), ok: true, data }, null, 2)}\n`)
    return
  }
  write(io.stdout, `${message}\n`)
}

function emitError(args: CliArgs, io: PlatformCliIO, error: unknown): number {
  const problem = safeMessage(error)
  if (args.json) {
    write(io.stdout, `${JSON.stringify({ schemaVersion: 1, command: commandName(args), ok: false, error: problem }, null, 2)}\n`)
  } else {
    write(io.stderr, `error [${problem.code}]: ${problem.message}\n`)
  }
  return problem.code === 'not-found' ? 4 : 1
}

function rows<T>(items: readonly T[], columns: readonly { readonly heading: string; readonly render: (item: T) => string }[]): string {
  const values = items.map(item => columns.map(column => column.render(item).replace(/[\t\r\n]/g, ' ')))
  const widths = columns.map((column, index) => Math.max(column.heading.length, ...values.map(row => row[index]?.length ?? 0)))
  const format = (row: readonly string[]): string => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ').trimEnd()
  return [format(columns.map(column => column.heading)), ...values.map(format)].join('\n')
}

function sessionRows(items: readonly SessionSummary[]): string {
  return rows(items, [
    { heading: 'SESSION', render: item => item.sessionId },
    { heading: 'STATE', render: item => item.running ? 'running' : 'idle' },
    { heading: 'BLANK', render: item => item.blank ? 'yes' : 'no' },
    { heading: 'UPDATED', render: item => new Date(item.updatedAt).toISOString() },
    { heading: 'CWD', render: item => item.cwd ?? '' },
  ])
}

function pluginRows(items: readonly PluginSummary[]): string {
  return rows(items, [
    { heading: 'ID', render: item => item.id },
    { heading: 'PLUGIN', render: item => item.displayName ?? item.moduleName },
    { heading: 'ENABLED', render: item => item.enabled ? 'yes' : 'no' },
    { heading: 'PHASE', render: item => item.phase ?? 'unknown' },
  ])
}

function bundleRows(items: readonly BundleSummary[]): string {
  return rows(items, [
    { heading: 'BUNDLE', render: item => item.name },
    { heading: 'SELECTED', render: item => item.selected === undefined ? 'unknown' : item.selected ? 'yes' : 'no' },
    { heading: 'ENABLED', render: item => item.enabled === undefined ? 'unknown' : item.enabled ? 'yes' : 'no' },
    { heading: 'INSTALLED', render: item => item.installed === undefined ? 'unknown' : item.installed ? 'yes' : 'no' },
    { heading: 'ROWS', render: item => String(item.rowCount ?? 0) },
  ])
}

function commandRows(items: readonly { readonly name: string; readonly description?: string }[]): string {
  return rows(items, [
    { heading: 'COMMAND', render: item => `/${item.name}` },
    { heading: 'DESCRIPTION', render: item => item.description ?? '' },
  ])
}

function findPath(root: JsonValue, path: string | undefined): JsonValue | undefined {
  if (path === undefined || path.length === 0) return root
  let current: JsonValue | undefined = root
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index < 0) return undefined
      current = current[index]
      continue
    }
    if (current === null || typeof current !== 'object') return undefined
    current = current[segment]
  }
  return current
}

function asJsonValue(value: unknown): JsonValue {
  const result = z.json().safeParse(value)
  if (!result.success) throw new DshPlatformError('invalid-json-value', 'config set requires a valid JSON value.')
  return result.data
}

function requireNamespace(client: DshPlatformClient, name: string): Promise<import('../platform/client.js').SettingsNamespace> {
  return client.config.describe().then(description => {
    const namespace = description.namespaces.find(item => item.ns === name)
    if (!namespace) throw new DshPlatformError('not-found', `No DSH settings namespace named ${JSON.stringify(name)} exists.`)
    return namespace
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
    const data = { dshxVersion: runtime.dshxVersion, nodeVersion: process.version, dshCliVersion: dshVersion ?? null, checks }
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
  checks.push(doctorCheck('host-rpc', rpcFailures.length === 0 ? 'pass' : 'fail', rpcFailures.length === 0 ? 'Session, plugin, bundle, and settings RPCs responded.' : `${rpcFailures.length} DSH API probes failed.`))
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
    const broken = pluginResult.value.filter(plugin => plugin.phase === 'failed' || plugin.error !== undefined)
    const detail = [
      `${pluginResult.value.length} plugin entries`,
      broken.length === 0 ? 'no failed Loader entries' : `${broken.length} failed or broken entries: ${broken.map(plugin => plugin.id).join(', ')}`,
      duplicateNames.size === 0 ? 'no duplicate module names' : `duplicate module names: ${[...duplicateNames].join(', ')}`,
    ].join('; ')
    checks.push(doctorCheck('plugins', broken.length === 0 && duplicateNames.size === 0 ? 'pass' : 'fail', detail))
  }
  if (bundleResult.status === 'fulfilled') {
    const broken = bundleResult.value.filter(bundle => bundle.error !== undefined || (bundle.selected === true && bundle.installed === false))
    checks.push(doctorCheck('bundles', broken.length === 0 ? 'pass' : 'fail', broken.length === 0 ? `${bundleResult.value.length} bundle records; no reported install errors.` : `${broken.length} bundle records report errors or missing selected installs: ${broken.map(bundle => bundle.name).join(', ')}`))
  }
  if (settingsResult.status === 'fulfilled') {
    const description = settingsResult.value
    checks.push(doctorCheck('settings', 'pass', `${description.namespaces.length} redacted settings namespaces; writes ${description.writable ? 'available' : 'unavailable'}.`))
  }
  checks.push(doctorCheck('configuration', 'unknown', 'DSH exposes scoped settings schemas; profile patch composition and credential values stay Host-owned.'))

  const data = { dshxVersion: runtime.dshxVersion, nodeVersion: process.version, dshCliVersion: dshVersion ?? null, checks }
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
    emitResult(args, runtime.io, data, `DSH Host connected\nSessions: ${sessions.length}\nPlugins: ${plugins.length}\nBundles: ${bundles.length}\nHost version: not exposed by DSH API`)
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
    emitResult(args, runtime.io, data, `DSHX ${runtime.dshxVersion}\nNode ${process.version} (${compatible ? 'supported' : `requires ${engineRange}`})\nHost version and active profile: unavailable until queried through DSH APIs`)
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
      if (action === 'export') {
        const sessionId = parameters[0] ?? ''
        const data = { schemaVersion: 1, source: 'dshx', sessionId, records: await client.sessions.export(sessionId) }
        if (args.output !== undefined) {
          await writeFile(args.output, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
          emitResult(args, runtime.io, { sessionId, output: args.output, recordCount: data.records.length }, `Exported ${data.records.length} records to ${args.output}`)
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
      if (action === 'enable' || action === 'disable') {
        const enabled = action === 'enable'
        const result = await client.plugins.setEnabled(parameters[0] ?? '', enabled)
        emitResult(args, runtime.io, result, `${action} ${parameters[0]}: ${result.application}${result.application === 'restart-required' ? ' (DSH restart required)' : ''}`)
        return result.application === 'failed' || result.application === 'cancelled' || result.application === 'overridden' ? 5 : 0
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
      if (action === 'enable' || action === 'disable') {
        const result = await client.bundles.setEnabled(parameters[0] ?? '', action === 'enable')
        emitResult(args, runtime.io, result, `${action} bundle ${parameters[0]}: ${result.application}${result.application === 'restart-required' ? ' (DSH restart required)' : ''}`)
        return result.application === 'failed' || result.application === 'cancelled' || result.application === 'overridden' ? 5 : 0
      }
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
        const result = await client.commands.execute(sessionId, line)
        emitResult(args, runtime.io, { sessionId, line, result }, result === null ? 'Command completed.' : JSON.stringify(result, null, 2))
        return 0
      }
    }

    if (args.command === 'config') {
      if (action === 'list') {
        const description = await client.config.describe()
        const items = description.namespaces.map(item => ({ ns: item.ns, revision: item.revision, applies: item.applies ?? null }))
        emitResult(args, runtime.io, { writable: description.writable, hasDocument: description.hasDocument, namespaces: items }, items.map(item => `${item.ns}\trevision ${item.revision}\t${item.applies ?? 'apply mode unknown'}`).join('\n'))
        return 0
      }
      const namespace = args.namespace ?? parameters[0]
      if (namespace === undefined) throw new DshPlatformError('invalid-command', 'A settings namespace is required.')
      const namespaceView = await requireNamespace(client, namespace)
      if (action === 'get') {
        const path = args.namespace === undefined ? parameters[1] : parameters[0]
        const value = findPath(namespaceView.value, path)
        if (value === undefined) throw new DshPlatformError('not-found', `No value exists at ${namespace}${path ? `.${path}` : ''}.`)
        const data = { namespace, path: path ?? '', revision: namespaceView.revision, value }
        emitResult(args, runtime.io, data, JSON.stringify(value, null, 2))
        return 0
      }
      if (action === 'set' || action === 'unset') {
        const path = args.namespace === undefined ? parameters[1] : parameters[0]
        if (path === undefined) throw new DshPlatformError('invalid-command', `config ${action} requires a path.`)
        const rawValue = args.namespace === undefined ? parameters.slice(2).join(' ') : parameters.slice(1).join(' ')
        const value = action === 'set' ? asJsonValue(JSON.parse(rawValue)) : undefined
        if (!namespaceView.schema) throw new DshPlatformError('read-only', 'The DSH settings namespace has no writable schema.')
        const updated = await client.config.mutate(namespace, path, value, namespaceView.revision)
        const changed = updated.namespaces.find(item => item.ns === namespace)
        const data = { namespace, path, revision: changed?.revision ?? null, value: changed ? findPath(changed.value, path) ?? null : null, applied: true }
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
  if (group === 'status') return 'Usage: dshx status [--url <launch-url>] [--json]\nChecks authenticated Session, plugin, and bundle APIs.\n'
  if (group === 'info') return 'Usage: dshx info [--json]\nShows local DSHX and Node versions; it does not require a running DSH Host.\n'
  if (group === 'doctor') return 'Usage: dshx doctor [--url <launch-url>] [--json]\nChecks local runtime facts and the DSH APIs available to this launch URL.\n'
  if (group === 'sessions') {
    if (nested === 'history') return 'Usage: dshx sessions history <session-id> [--max <count>] [--json]\n'
    return 'Usage: dshx sessions <list|show|history|create|fork|cancel|export> [session-id] [options]\nOptions: --cwd <path> --agent-preset <id> --at-seq <n> --max <count> --output <path> --url <launch-url> --json\n'
  }
  if (group === 'plugins') return 'Usage: dshx plugins <list|info|enable|disable> [plugin-entry-id] [--json] [--url <launch-url>]\n'
  if (group === 'bundles') return 'Usage: dshx bundles <list|info|enable|disable> [bundle-name] [--json] [--url <launch-url>]\n'
  if (group === 'commands') return 'Usage: dshx commands <list|info|run> [command-name|/line] --session <session-id> [--json]\nRun accepts --line <slash-command> as an alternative.\n'
  if (group === 'config') return 'Usage: dshx config <list|get|set|unset> [namespace] [path] [json-value] [--json]\nUse --namespace <id> to select a namespace. Values passed to set must be JSON.\n'
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
