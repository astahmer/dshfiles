import type { ServerView, StoredServer } from './api.js'
import { formatCommandLine } from './command-line.js'
import type { LocalProcessStatus } from './local-process.js'
import type { ClientLifecycle } from './reconcile.js'

export const saveServer = (current: readonly StoredServer[], candidate: StoredServer, max = 64): StoredServer[] => {
  if (!current.some(server => server.id === candidate.id) && current.length >= max) {
    throw new Error(`At most ${max} servers can be configured.`)
  }
  if (current.some(server => server.id !== candidate.id && server.serverName === candidate.serverName)) {
    throw new Error('Server names must be unique because DSH uses them for MCP tool names.')
  }
  const index = current.findIndex(server => server.id === candidate.id)
  return index < 0 ? [...current, candidate] : current.map((server, row) => (row === index ? candidate : server))
}

export const setServerEnabled = (current: readonly StoredServer[], id: string, enabled: boolean): StoredServer[] => {
  if (!current.some(server => server.id === id)) throw new Error('MCP server was not found.')
  return current.map(server => (server.id === id ? { ...server, enabled } : server))
}

export const removeServer = (current: readonly StoredServer[], id: string): StoredServer[] => {
  if (!current.some(server => server.id === id)) throw new Error('MCP server was not found.')
  return current.filter(server => server.id !== id)
}

/** Explicit allow-list projection: runtime-only values can never reach the UI. */
export const publicServerView = (
  server: StoredServer,
  availability: ReadonlyMap<string, boolean>,
  clientLifecycle: ClientLifecycle = 'inactive',
  registeredToolCount = 0,
  localProcess: LocalProcessStatus = 'not-configured',
  signedIn = false,
): ServerView => {
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
    return { ...common, transport: 'stdio', commandLine: formatCommandLine([server.command, ...server.args]), cwd: server.cwd }
  }
  return {
    ...common,
    transport: 'streamable-http',
    url: server.url,
    ...(server.startCommand === undefined
      ? {}
      : {
          startCommand: { commandLine: formatCommandLine([server.startCommand.command, ...server.startCommand.args]), cwd: server.startCommand.cwd },
        }),
  }
}
