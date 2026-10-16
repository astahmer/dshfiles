import type { ServerView, StoredServer } from './api.js'
import { McpCommandLineModel } from './command-line.js'
import type { LocalProcessStatus } from './local-process.js'
import type { ClientLifecycle } from './reconcile.js'

type SaveServerInput = { readonly current: readonly StoredServer[]; readonly candidate: StoredServer; readonly max?: number }
type SetServerEnabledInput = { readonly current: readonly StoredServer[]; readonly id: string; readonly enabled: boolean }
type RemoveServerInput = { readonly current: readonly StoredServer[]; readonly id: string }
type PublicServerViewInput = {
  readonly server: StoredServer
  readonly availability: ReadonlyMap<string, boolean>
  readonly clientLifecycle?: ClientLifecycle
  readonly registeredToolCount?: number
  readonly localProcess?: LocalProcessStatus
  readonly signedIn?: boolean
}

export class McpServerStateModel {
  static readonly saveServer = ({ current, candidate, max = 64 }: SaveServerInput): StoredServer[] => {
    if (!current.some(server => server.id === candidate.id) && current.length >= max) {
      throw new Error(`At most ${max} servers can be configured.`)
    }
    if (current.some(server => server.id !== candidate.id && server.serverName === candidate.serverName)) {
      throw new Error('Server names must be unique because DSH uses them for MCP tool names.')
    }
    const index = current.findIndex(server => server.id === candidate.id)
    return index < 0 ? [...current, candidate] : current.map((server, row) => (row === index ? candidate : server))
  }

  static readonly setServerEnabled = ({ current, id, enabled }: SetServerEnabledInput): StoredServer[] => {
    if (!current.some(server => server.id === id)) throw new Error('MCP server was not found.')
    return current.map(server => (server.id === id ? { ...server, enabled } : server))
  }

  static readonly removeServer = ({ current, id }: RemoveServerInput): StoredServer[] => {
    if (!current.some(server => server.id === id)) throw new Error('MCP server was not found.')
    return current.filter(server => server.id !== id)
  }

  /** Explicit allow-list projection: runtime-only values can never reach the UI. */
  static readonly publicServerView = ({
    server,
    availability,
    clientLifecycle = 'inactive',
    registeredToolCount = 0,
    localProcess = 'not-configured',
    signedIn = false,
  }: PublicServerViewInput): ServerView => {
    const bindings =
      server.transport === 'stdio'
        ? Object.entries(server.envRefs).map(([key, reference]) => [`environment:${key}`, reference] as const)
        : [
            ...Object.entries(server.headerRefs).map(([key, reference]) => [`header:${key}`, reference] as const),
            ...Object.entries(server.startCommand?.envRefs ?? {}).map(([key, reference]) => [`local-environment:${key}`, reference] as const),
          ]
    const credentialReferences = bindings.map(([target, reference]) => ({
      target,
      reference,
      configured: availability.get(reference) ?? false,
    }))
    const usesOAuth = server.transport === 'streamable-http' && server.auth === 'oauth'
    const ready = credentialReferences.every(item => item.configured) && (!usesOAuth || signedIn)
    const common = {
      id: server.id,
      name: server.name,
      serverName: server.serverName,
      enabled: server.enabled,
      credentialReferences,
      configuration: ready ? ('ready' as const) : ('needs-credentials' as const),
      clientLifecycle,
      localProcess,
      connectionHealth: 'not-reported' as const,
      registeredToolCount,
      oauth: usesOAuth ? (signedIn ? ('signed-in' as const) : ('needs-sign-in' as const)) : ('not-used' as const),
    }
    if (server.transport === 'stdio') {
      return { ...common, transport: 'stdio', commandLine: McpCommandLineModel.formatCommandLine([server.command, ...server.args]), cwd: server.cwd }
    }
    if (server.startCommand === undefined) return { ...common, transport: 'streamable-http', url: server.url }
    return {
      ...common,
      transport: 'streamable-http',
      url: server.url,
      startCommand: {
        commandLine: McpCommandLineModel.formatCommandLine([server.startCommand.command, ...server.startCommand.args]),
        cwd: server.startCommand.cwd,
      },
    }
  }
}
