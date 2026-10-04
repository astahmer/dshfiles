import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { apply as nativeMcpClient, type Config as NativeMcpConfig } from '@deepseek-ai/dsh-mcp-client'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { definePlugin } from '@dshfiles/dshx/host'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { mcpServersApi, referenceNameSchema, serverDraftSchema, storedServerSchema, type ManagerSnapshot, type ServerDraft, type ServerView, type StoredServer } from './api.js'
import { PROVIDERS, searchOfficialRegistry } from './catalog.js'
import { hasInlineCredential, parseCommandLine } from './command-line.js'
import { ManagedLocalCommand, type LocalProcessStatus } from './local-process.js'
import { redactingLogger } from './redaction.js'
import { ClientReconciler, type ClientTarget } from './reconcile.js'
import { publicServerView, removeServer, saveServer, setServerEnabled } from './server-state.js'

const ENTRY_ID = 'mcp-servers'
const PACKAGE_NAME = '@dshfiles/mcp-servers'
const MAX_SERVERS = 64

export const Config = z.object({ servers: z.array(storedServerSchema).max(MAX_SERVERS).default([]) }).superRefine((value, context) => {
  value.servers.forEach((server, index) => {
    if (server.transport === 'stdio' && hasInlineCredential([server.command, ...server.args])) {
      context.addIssue({ code: 'custom', path: ['servers', index], message: 'Use credential references instead of inline command credentials.' })
    }
    if (server.transport === 'streamable-http' && server.startCommand !== undefined && hasInlineCredential([server.startCommand.command, ...server.startCommand.args])) {
      context.addIssue({ code: 'custom', path: ['servers', index, 'startCommand'], message: 'Use credential references instead of inline command credentials.' })
    }
  })
})

type NativeTarget = ClientTarget & {
  readonly config: NativeMcpConfig
  readonly redactions: readonly string[]
  readonly localCommand?: { readonly command: string; readonly args: readonly string[]; readonly cwd: string; readonly env: Readonly<Record<string, string>> }
}

function entryFor(ctx: Context) {
  const matches = ctx.configEditor.entries().filter(entry =>
    entry.options.id === ENTRY_ID && entry.options.name === PACKAGE_NAME,
  )
  if (matches.length !== 1 || matches[0]?.fiber === undefined) {
    throw new Error('MCP manager profile row is unavailable.')
  }
  return matches[0]
}

function currentContext(ctx: Context): Context {
  return entryFor(ctx).fiber?.ctx ?? ctx
}

function parseStoredConfig(value: unknown): StoredServer[] {
  const result = Config.safeParse(value ?? {})
  if (!result.success) throw new Error('MCP manager configuration is invalid.')
  return result.data.servers
}

function serversFor(ctx: Context): StoredServer[] {
  return parseStoredConfig(entryFor(ctx).options.config)
}

function referenceBindings(server: StoredServer): Array<[string, string]> {
  return server.transport === 'stdio'
    ? Object.entries(server.envRefs)
    : [
      ...Object.entries(server.headerRefs),
      ...Object.entries(server.startCommand?.envRefs ?? {}),
    ]
}

async function projectServer(ctx: Context, server: StoredServer, localProcess: LocalProcessStatus): Promise<ServerView> {
  const refs = [...new Set(referenceBindings(server).map(([, reference]) => reference))]
  const availability = new Map(await Promise.all(refs.map(async name => {
    try {
      const info = await ctx.credentials.describe(credentialRef(name))
      return [name, info.configured] as const
    } catch {
      return [name, false] as const
    }
  })))
  return publicServerView(server, availability, 'inactive', 0, localProcess)
}

async function snapshot(ctx: Context, servers = serversFor(ctx), runtime?: ManagerRuntime): Promise<ManagerSnapshot> {
  const tools = ctx.tools.schemas()
  const rows = await Promise.all(servers.map(async server => {
    const localProcess = runtime?.localProcess(server) ?? (server.transport === 'streamable-http' && server.startCommand !== undefined ? 'stopped' : 'not-configured')
    const projected = await projectServer(ctx, server, localProcess)
    const prefix = `mcp__${server.serverName}__`
    const registeredToolCount = tools.reduce((count, tool) => count + Number(tool.name.startsWith(prefix)), 0)
    const clientLifecycle = runtime?.reconciler.state(server.id) ?? (server.enabled ? 'starting' : 'inactive')
    return { ...projected, clientLifecycle, registeredToolCount }
  }))
  return { servers: rows, providers: [...PROVIDERS], connectionHealth: 'not-reported' }
}

async function resolveReferences(ctx: Context, refs: Record<string, string>): Promise<Record<string, string> | undefined> {
  const resolved: Record<string, string> = {}
  for (const [key, name] of Object.entries(refs)) {
    try {
      const result = await ctx.credentials.resolve(credentialRef(name))
      if (result === undefined || result.value.length === 0) return undefined
      resolved[key] = result.value
    } catch {
      return undefined
    }
  }
  return resolved
}

async function nativeTarget(ctx: Context, server: StoredServer, suspended: boolean): Promise<NativeTarget> {
  let config: NativeMcpConfig
  let ready: boolean
  let redactions: readonly string[]
  if (server.transport === 'stdio') {
    const env = await resolveReferences(ctx, server.envRefs)
    config = {
      transport: 'stdio',
      serverName: server.serverName,
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: env ?? {},
      toolCallTimeoutMs: 30_000,
      failOnStartupError: false,
    }
    ready = env !== undefined
    redactions = Object.values(env ?? {})
  } else {
    const headers = await resolveReferences(ctx, server.headerRefs)
    const localEnv = server.startCommand === undefined ? undefined : await resolveReferences(ctx, server.startCommand.envRefs)
    config = {
      transport: 'streamable-http',
      serverName: server.serverName,
      url: server.url,
      headers: headers ?? {},
      toolCallTimeoutMs: 30_000,
      failOnStartupError: false,
    }
    ready = headers !== undefined && (server.startCommand === undefined || localEnv !== undefined)
    redactions = [...Object.values(headers ?? {}), ...Object.values(localEnv ?? {})]
    if (server.startCommand !== undefined && localEnv !== undefined) {
      return {
        id: server.id,
        enabled: server.enabled,
        ready,
        suspended,
        fingerprint: JSON.stringify(server),
        config,
        redactions,
        localCommand: { ...server.startCommand, env: localEnv },
      }
    }
  }
  return {
    id: server.id,
    enabled: server.enabled,
    ready,
    suspended,
    // Hash only the persisted, reference-only row. Secret values never enter
    // fingerprints, errors, snapshots, or manager-owned logs.
    fingerprint: JSON.stringify(server),
    config,
    redactions,
  }
}

async function desiredTargets(
  ctx: Context,
  servers: readonly StoredServer[],
  manuallyDisconnected: ReadonlySet<string>,
): Promise<NativeTarget[]> {
  return Promise.all(servers.map(server => nativeTarget(ctx, server, manuallyDisconnected.has(server.id))))
}

function storedDraft(draft: ServerDraft): StoredServer {
  const id = draft.id || randomUUID()
  if (draft.transport === 'streamable-http') {
    const localStart = draft.startCommand
    if (localStart == null) {
      return { id, name: draft.name, serverName: draft.serverName, enabled: draft.enabled, transport: 'streamable-http', url: draft.url, headerRefs: draft.headerRefs }
    }
    const [command, ...args] = parseCommandLine(localStart.commandLine)
    if (command === undefined) throw new TypeError('Enter a local start command.')
    if (hasInlineCredential([command, ...args])) throw new TypeError('Use credential references instead of inline command credentials.')
    return {
      id, name: draft.name, serverName: draft.serverName, enabled: draft.enabled, transport: 'streamable-http',
      url: draft.url, headerRefs: draft.headerRefs,
      startCommand: { command, args, cwd: localStart.cwd, envRefs: localStart.envRefs },
    }
  }
  const [command, ...args] = parseCommandLine(draft.commandLine)
  if (command === undefined) throw new TypeError('Enter a command.')
  if (hasInlineCredential([command, ...args])) throw new TypeError('Use credential references instead of inline command credentials.')
  return {
    id,
    name: draft.name,
    serverName: draft.serverName,
    enabled: draft.enabled,
    transport: 'stdio',
    command,
    args,
    cwd: draft.cwd,
    envRefs: draft.envRefs,
  }
}

const runtimes = new WeakMap<Context, ManagerRuntime>()
const disconnectionsByRoot = new WeakMap<object, Set<string>>()

class ManagerRuntime {
  readonly reconciler: ClientReconciler
  private readonly localProcesses = new Map<string, ManagedLocalCommand>()

  constructor(private readonly ctx: Context, readonly manuallyDisconnected: Set<string>) {
    this.reconciler = new ClientReconciler(async target => {
      const native = target as NativeTarget
      let localProcess: ManagedLocalCommand | undefined
      if (native.localCommand !== undefined) {
        try {
          const previous = this.localProcesses.get(native.id)
          if (previous !== undefined) {
            await previous.stop()
            if (previous.status !== 'stopped') throw new Error('Previous local process range is still owned.')
            if (this.localProcesses.get(native.id) === previous) this.localProcesses.delete(native.id)
          }
          localProcess = await ManagedLocalCommand.start(this.ctx.subprocess, native.localCommand, native.localCommand.env)
          this.localProcesses.set(native.id, localProcess)
        } catch {
          throw new Error('The local MCP start command could not be launched.')
        }
      }
      try {
        const scoped = this.ctx.extend({ logger: redactingLogger(this.ctx.logger, native.redactions) })
        const fiber = await scoped.plugin(nativeMcpClient, native.config)
        localProcess?.markRunning()
        return async () => {
          try {
            await fiber.dispose()
          } finally {
            if (localProcess !== undefined) {
              try {
                await localProcess.stop()
              } finally {
                if (localProcess.status === 'stopped' && this.localProcesses.get(native.id) === localProcess) {
                  this.localProcesses.delete(native.id)
                }
              }
            }
          }
        }
      } catch {
        if (localProcess !== undefined) {
          await localProcess.stop()
          if (localProcess.status === 'stopped' && this.localProcesses.get(native.id) === localProcess) {
            this.localProcesses.delete(native.id)
          }
        }
        throw new Error('The native MCP client could not be started.')
      }
    })
  }

  localProcess(server: StoredServer): LocalProcessStatus {
    if (server.transport !== 'streamable-http' || server.startCommand === undefined) return 'not-configured'
    return this.localProcesses.get(server.id)?.status ?? (this.reconciler.state(server.id) === 'starting' ? 'starting' : 'stopped')
  }

  async reconcile(servers: readonly StoredServer[] = serversFor(this.ctx), restartIds: readonly string[] = []): Promise<void> {
    const currentIds = new Set(servers.map(server => server.id))
    for (const id of this.manuallyDisconnected) {
      if (!currentIds.has(id)) this.manuallyDisconnected.delete(id)
    }
    const targets = await desiredTargets(this.ctx, servers, this.manuallyDisconnected)
    const restart = new Set(restartIds)
    for (const target of targets) {
      if (target.enabled && target.ready && target.suspended !== true && target.localCommand !== undefined && this.localProcesses.get(target.id)?.status === 'exited') {
        restart.add(target.id)
      }
    }
    if (restart.size === 0) {
      await this.reconciler.update(targets)
      return
    }
    for (const id of restart) await this.reconciler.restart(id, targets)
  }

  async setConnection(id: string, connected: boolean, servers: readonly StoredServer[]): Promise<void> {
    if (!servers.some(server => server.id === id)) throw new Error('MCP server was not found.')
    if (connected) this.manuallyDisconnected.delete(id)
    else this.manuallyDisconnected.add(id)
    await this.reconcile(servers, connected ? [id] : [])
  }

  async dispose(): Promise<void> {
    await this.reconciler.dispose()
  }
}

function runtimeFor(ctx: Context): ManagerRuntime | undefined {
  return runtimes.get(currentContext(ctx))
}

async function currentSnapshot(ctx: Context, servers?: StoredServer[]): Promise<ManagerSnapshot> {
  const live = currentContext(ctx)
  const runtime = runtimes.get(live)
  const currentServers = servers ?? serversFor(live)
  return snapshot(live, currentServers, runtime)
}

async function persist(ctx: Context, servers: StoredServer[]): Promise<ManagerSnapshot> {
  if (servers.length > MAX_SERVERS) throw new Error(`At most ${MAX_SERVERS} servers can be configured.`)
  const entry = entryFor(ctx)
  await ctx.configEditor.edit(entry, () => ({ servers }))
  const live = currentContext(ctx)
  const runtime = runtimes.get(live)
  if (runtime !== undefined) await runtime.reconcile(servers)
  return currentSnapshot(ctx, servers)
}

const hostApi = mcpServersApi.host({
  list: async ({ ctx }) => currentSnapshot(ctx),
  refresh: async ({ ctx }) => {
    const live = currentContext(ctx)
    await runtimes.get(live)?.reconcile()
    return currentSnapshot(ctx)
  },
  save: async ({ ctx, input }) => {
    const draft = serverDraftSchema.parse(input.server)
    const candidate = storedDraft(draft)
    const servers = serversFor(ctx)
    return persist(ctx, saveServer(servers, candidate, MAX_SERVERS))
  },
  setEnabled: async ({ ctx, input }) => {
    const servers = serversFor(ctx)
    return persist(ctx, setServerEnabled(servers, input.id, input.enabled))
  },
  setConnection: async ({ ctx, input }) => {
    const live = currentContext(ctx)
    const servers = serversFor(live)
    const runtime = runtimeFor(live)
    if (runtime === undefined) throw new Error('MCP client lifecycle is unavailable.')
    await runtime.setConnection(input.id, input.connected, servers)
    return currentSnapshot(ctx, servers)
  },
  remove: async ({ ctx, input }) => {
    const servers = serversFor(ctx)
    return persist(ctx, removeServer(servers, input.id))
  },
  searchRegistry: async ({ input }) => searchOfficialRegistry(input.query),
})

const hostPlugin = definePlugin({
  id: 'mcp-servers',
  name: PACKAGE_NAME,
  Config,
  inject: ['connection', 'webServer', 'configEditor', 'credentials', 'tools', 'subprocess'],
  apis: [hostApi],
  setup: api => {
    const ctx = api.raw.ctx
    const root = ctx.root ?? ctx
    let manuallyDisconnected = disconnectionsByRoot.get(root)
    if (manuallyDisconnected === undefined) {
      manuallyDisconnected = new Set()
      disconnectionsByRoot.set(root, manuallyDisconnected)
    }
    const runtime = new ManagerRuntime(ctx, manuallyDisconnected)
    runtimes.set(ctx, runtime)
    void runtime.reconcile(Config.parse(api.config).servers).catch(() => {
      ctx.logger.warn('MCP manager could not reconcile a server configuration.')
    })

    ctx.on('credentials/reference-updated', ref => {
      const servers = serversFor(ctx)
      const affected = servers.filter(server => referenceBindings(server).some(([, reference]) => reference === ref))
      if (affected.length > 0) {
        void runtime.reconcile(servers, affected.map(server => server.id)).catch(() => {
          ctx.logger.warn('MCP manager could not refresh a credential-backed server.')
        })
      }
    })

    ctx.effect(() => async () => {
      await runtime.dispose()
    })
  },
})

export default hostPlugin
