import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import { apply as nativeMcpClient, type Config as NativeMcpConfig } from '@deepseek-ai/dsh-mcp-client'
import { credentialKey, credentialRef, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import { Effect, Layer, Schema } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  mcpServersApi,
  preferencesSchema,
  serverDraftSchema,
  storedServerSchema,
  type ManagerPreferences,
  type ManagerSnapshot,
  type ServerDraft,
  type ServerView,
  type StoredServer,
} from './api.js'
import { McpCatalogModel } from './catalog.js'
import { McpCommandLineModel } from './command-line.js'
import { ManagedLocalCommand, type LocalProcessStatus } from './local-process.js'
import { McpOAuthModel, oauthGrantSchema, type OAuthGrant, type PendingAuthorization } from './oauth.js'
import { redactingLogger } from './redaction.js'
import { ClientReconciler, type ClientTarget } from './reconcile.js'
import { McpContract, McpSchema, type McpFilterIssue } from './schema.js'
import { McpServerStateModel } from './server-state.js'
import { createTracedRegistrySearch } from './registry-search-host.js'

const registrySearchService = createTracedRegistrySearch({ fetch: (input, init) => globalThis.fetch(input, init) })

const ENTRY_ID = 'mcp-servers'
const PACKAGE_NAME = '@dshfiles/mcp-servers'
const MAX_SERVERS = 64
const CREDENTIAL_SCOPE = 'mcp-servers'
const OAUTH_CALLBACK_PATH = '/api/dshfiles-mcp-servers/oauth/callback'
const OAUTH_PENDING_TTL_MS = 600_000 // 10 minutes to finish a provider sign-in
const TOKEN_REFRESH_INTERVAL_MS = 300_000 // 5 minutes

class McpManagerOperationError extends Schema.TaggedError<McpManagerOperationError>()('McpManagerOperationError', {
  message: Schema.String,
}) {}

const operation = <A>(name: string, run: () => Promise<A>) =>
  Effect.fn(name)(() =>
    Effect.tryPromise({
      try: run,
      catch: error => new McpManagerOperationError({ message: error instanceof Error ? error.message : String(error) }),
    }),
  )()

/**
 * Loader row: the registered servers and the manager preferences. dshx refuses a Host that owns both a native Config
 * and a Settings namespace, so the preferences live in this row and the manager page edits them.
 */
const configRowSchema = Schema.Struct({
  servers: Schema.Array(storedServerSchema)
    .check(Schema.isMaxLength(MAX_SERVERS))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  preferences: Schema.optional(preferencesSchema),
})

const configSchema = configRowSchema.check(
  Schema.makeFilter((value: typeof configRowSchema.Type) => {
    const issues: McpFilterIssue[] = []
    value.servers.forEach((server, index) => {
      if (server.transport === 'stdio' && McpCommandLineModel.hasInlineCredential([server.command, ...server.args])) {
        issues.push({ path: ['servers', index], issue: 'Use credential references instead of inline command credentials.' })
      }
      if (
        server.transport === 'streamable-http' &&
        server.startCommand !== undefined &&
        McpCommandLineModel.hasInlineCredential([server.startCommand.command, ...server.startCommand.args])
      ) {
        issues.push({ path: ['servers', index, 'startCommand'], issue: 'Use credential references instead of inline command credentials.' })
      }
    })
    return issues
  }),
)

export const Config = McpContract.standard(configSchema)

type NativeTarget = ClientTarget & {
  readonly config: NativeMcpConfig
  readonly redactions: readonly string[]
  readonly localCommand?: { readonly command: string; readonly args: readonly string[]; readonly cwd: string; readonly env: Readonly<Record<string, string>> }
}

const entryFor = (ctx: Context) => {
  const matches = ctx.configEditor.entries().filter(entry => entry.options.id === ENTRY_ID && entry.options.name === PACKAGE_NAME)
  if (matches.length !== 1 || matches[0]?.fiber === undefined) {
    throw new Error('MCP manager profile row is unavailable.')
  }
  return matches[0]
}

const currentContext = (ctx: Context): Context => {
  return entryFor(ctx).fiber?.ctx ?? ctx
}

const parseStoredConfig = (value: unknown): StoredServer[] => {
  const result = Schema.decodeUnknownResult(configSchema)(value ?? {})
  if (result._tag === 'Failure') throw new Error('MCP manager configuration is invalid.')
  return [...result.success.servers]
}

const serversFor = (ctx: Context): StoredServer[] => {
  return parseStoredConfig(entryFor(ctx).options.config)
}

/** A row may be unreadable or predate a field; either way the preferences fall back to their parsed defaults. */
const preferencesFrom = (value: unknown): ManagerPreferences => {
  const parsed = Schema.decodeUnknownResult(configSchema)(value ?? {})
  return McpSchema.decode(preferencesSchema, parsed._tag === 'Success' ? (parsed.success.preferences ?? {}) : {})
}

/** Read on every use, so a saved preference applies without a restart. */
const preferencesFor = (ctx: Context): ManagerPreferences => preferencesFrom(entryFor(ctx).options.config)

const grantKey = (server: StoredServer): CredentialKey =>
  credentialKey(CREDENTIAL_SCOPE, `oauth-${createHash('sha256').update(server.id).digest('hex').slice(0, 24)}`)

type HttpServer = Extract<StoredServer, { transport: 'streamable-http' }>

const usesOAuth = (server: StoredServer): server is HttpServer => server.transport === 'streamable-http' && server.auth === 'oauth'

const readGrant = async (ctx: Context, server: StoredServer): Promise<OAuthGrant | undefined> => {
  try {
    const record = await ctx.credentials.readRecord(grantKey(server))
    if (record?.kind !== 'grant') return undefined
    const parsed = Schema.decodeUnknownResult(oauthGrantSchema)(record.payload)
    return parsed._tag === 'Success' ? parsed.success : undefined
  } catch {
    return undefined
  }
}

/** Current grant, refreshed under the credential record lock when it is about to expire. */
const liveGrant = async (ctx: Context, server: StoredServer): Promise<OAuthGrant | undefined> => {
  const grant = await readGrant(ctx, server)
  if (grant === undefined || !McpOAuthModel.needsRefresh({ grant })) return grant
  let refreshed: OAuthGrant | undefined
  try {
    await ctx.credentials.modifyRecord(grantKey(server), async current => {
      const parsed = current?.kind === 'grant' ? Schema.decodeUnknownResult(oauthGrantSchema)(current.payload) : undefined
      const stored = parsed?._tag === 'Success' ? parsed.success : undefined
      if (stored === undefined) return current
      if (!McpOAuthModel.needsRefresh({ grant: stored })) {
        refreshed = stored
        return current
      }
      refreshed = await McpOAuthModel.refreshGrant({ grant: stored })
      return refreshed === undefined ? current : { kind: 'grant', payload: refreshed }
    })
  } catch {
    return undefined
  }
  return refreshed
}

const referenceBindings = (server: StoredServer): Array<[string, string]> => {
  return server.transport === 'stdio'
    ? Object.entries(server.envRefs)
    : [...Object.entries(server.headerRefs), ...Object.entries(server.startCommand?.envRefs ?? {})]
}

const projectServer = async (ctx: Context, server: StoredServer, localProcess: LocalProcessStatus): Promise<ServerView> => {
  const signedIn = usesOAuth(server) ? (await readGrant(ctx, server)) !== undefined : false
  const refs = [...new Set(referenceBindings(server).map(([, reference]) => reference))]
  const availability = new Map(
    await Promise.all(
      refs.map(async name => {
        try {
          const info = await ctx.credentials.describe(credentialRef(name))
          return [name, info.configured] as const
        } catch {
          return [name, false] as const
        }
      }),
    ),
  )
  return McpServerStateModel.publicServerView({ server, availability, clientLifecycle: 'inactive', localProcess, signedIn })
}

const snapshot = async (ctx: Context, servers = serversFor(ctx), runtime?: ManagerRuntime): Promise<ManagerSnapshot> => {
  const tools = ctx.tools.schemas()
  const rows = await Promise.all(
    servers.map(async server => {
      const localProcess =
        runtime?.localProcess(server) ?? (server.transport === 'streamable-http' && server.startCommand !== undefined ? 'stopped' : 'not-configured')
      const projected = await projectServer(ctx, server, localProcess)
      const prefix = `mcp__${server.serverName}__`
      const registeredToolCount = tools.reduce((count, tool) => count + Number(tool.name.startsWith(prefix)), 0)
      const clientLifecycle = runtime?.reconciler.state(server.id) ?? (server.enabled ? 'starting' : 'inactive')
      return { ...projected, clientLifecycle, registeredToolCount }
    }),
  )
  return {
    servers: rows,
    providers: [...McpCatalogModel.providers],
    connectionHealth: 'not-reported',
    registrySearch: preferencesFor(ctx).registrySearch,
    preferences: preferencesFor(ctx),
  }
}

const resolveReferences = async (ctx: Context, refs: Record<string, string>): Promise<Record<string, string> | undefined> => {
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

const nativeTarget = async (ctx: Context, server: StoredServer, suspended: boolean): Promise<NativeTarget> => {
  const toolCallTimeoutMs = preferencesFor(ctx).toolCallTimeoutSeconds * 1000
  let config: NativeMcpConfig
  let ready: boolean
  let redactions: readonly string[]
  let grantVersion: number | undefined
  if (server.transport === 'stdio') {
    const env = await resolveReferences(ctx, server.envRefs)
    config = {
      transport: 'stdio',
      serverName: server.serverName,
      command: server.command,
      args: [...server.args],
      cwd: server.cwd,
      env: env ?? {},
      toolCallTimeoutMs,
      failOnStartupError: false,
    }
    ready = env !== undefined
    redactions = Object.values(env ?? {})
  } else {
    const referencedHeaders = await resolveReferences(ctx, server.headerRefs)
    const grant = usesOAuth(server) ? await liveGrant(ctx, server) : undefined
    const oauthReady = !usesOAuth(server) || grant !== undefined
    const headers =
      referencedHeaders === undefined || !oauthReady
        ? undefined
        : grant === undefined
          ? referencedHeaders
          : { ...referencedHeaders, Authorization: `Bearer ${grant.accessToken}` }
    grantVersion = grant?.issuedAt
    const localEnv = server.startCommand === undefined ? undefined : await resolveReferences(ctx, server.startCommand.envRefs)
    config = {
      transport: 'streamable-http',
      serverName: server.serverName,
      url: server.url,
      headers: headers ?? {},
      toolCallTimeoutMs,
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
        fingerprint: JSON.stringify({ server, grantVersion }),
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
    // Hash only the persisted, reference-only row and the grant issue time, so a
    // refreshed token reconnects. Secret values never enter fingerprints, errors,
    // snapshots, or manager-owned logs.
    fingerprint: JSON.stringify({ server, grantVersion }),
    config,
    redactions,
  }
}

const desiredTargets = async (ctx: Context, servers: readonly StoredServer[], manuallyDisconnected: ReadonlySet<string>): Promise<NativeTarget[]> => {
  return Promise.all(servers.map(server => nativeTarget(ctx, server, manuallyDisconnected.has(server.id))))
}

const storedDraft = (draft: ServerDraft): StoredServer => {
  const id = draft.id || randomUUID()
  const withOAuth = (server: Extract<StoredServer, { transport: 'streamable-http' }>): Extract<StoredServer, { transport: 'streamable-http' }> => {
    if (draft.transport !== 'streamable-http' || draft.auth !== 'oauth') return server
    return { ...server, auth: 'oauth' }
  }
  if (draft.transport === 'streamable-http') {
    const localStart = draft.startCommand
    if (localStart == null) {
      return withOAuth({
        id,
        name: draft.name,
        serverName: draft.serverName,
        enabled: draft.enabled,
        transport: 'streamable-http',
        url: draft.url,
        headerRefs: draft.headerRefs,
      })
    }
    const [command, ...args] = McpCommandLineModel.parseCommandLine(localStart.commandLine)
    if (command === undefined) throw new TypeError('Enter a local start command.')
    if (McpCommandLineModel.hasInlineCredential([command, ...args])) throw new TypeError('Use credential references instead of inline command credentials.')
    if (McpCommandLineModel.hasUnexpandedTilde([command, ...args])) throw new TypeError(McpCommandLineModel.UNEXPANDED_TILDE_MESSAGE)
    return withOAuth({
      id,
      name: draft.name,
      serverName: draft.serverName,
      enabled: draft.enabled,
      transport: 'streamable-http',
      url: draft.url,
      headerRefs: draft.headerRefs,
      startCommand: { command, args, cwd: localStart.cwd, envRefs: localStart.envRefs },
    })
  }
  const [command, ...args] = McpCommandLineModel.parseCommandLine(draft.commandLine)
  if (command === undefined) throw new TypeError('Enter a command.')
  if (McpCommandLineModel.hasInlineCredential([command, ...args])) throw new TypeError('Use credential references instead of inline command credentials.')
  if (McpCommandLineModel.hasUnexpandedTilde([command, ...args])) throw new TypeError(McpCommandLineModel.UNEXPANDED_TILDE_MESSAGE)
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
  readonly reconciler: ClientReconciler<NativeTarget>
  private readonly localProcesses = new Map<string, ManagedLocalCommand>()

  constructor(
    private readonly ctx: Context,
    readonly manuallyDisconnected: Set<string>,
  ) {
    this.reconciler = new ClientReconciler<NativeTarget>(async native => {
      const logger = redactingLogger(this.ctx.logger, native.redactions)
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
        } catch (error) {
          logger.warn('MCP server %s: local start command failed: %s', native.id, error)
          throw new Error('The local MCP start command could not be launched.')
        }
      }
      try {
        const scoped = this.ctx.extend({ logger })
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
      } catch (error) {
        logger.warn('MCP server %s: native client failed to start: %s', native.id, error)
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
    await this.reconciler.reconcile(async () => {
      const targets = await desiredTargets(this.ctx, servers, this.manuallyDisconnected)
      const restart = new Set(restartIds)
      for (const target of targets) {
        if (
          target.enabled &&
          target.ready &&
          target.suspended !== true &&
          target.localCommand !== undefined &&
          this.localProcesses.get(target.id)?.status === 'exited'
        ) {
          restart.add(target.id)
        }
      }
      return { targets, restart }
    })
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

const runtimeFor = (ctx: Context): ManagerRuntime | undefined => {
  return runtimes.get(currentContext(ctx))
}

const currentSnapshot = async (ctx: Context, servers?: StoredServer[]): Promise<ManagerSnapshot> => {
  const live = currentContext(ctx)
  const runtime = runtimes.get(live)
  const currentServers = servers ?? serversFor(live)
  return snapshot(live, currentServers, runtime)
}

const persist = async (ctx: Context, servers: StoredServer[]): Promise<ManagerSnapshot> => {
  if (servers.length > MAX_SERVERS) throw new Error(`At most ${MAX_SERVERS} servers can be configured.`)
  const entry = entryFor(ctx)
  await ctx.configEditor.edit(entry, current => ({ ...current, servers }))
  const live = currentContext(ctx)
  const runtime = runtimes.get(live)
  if (runtime !== undefined) await runtime.reconcile(servers)
  return currentSnapshot(ctx, servers)
}

const pendingAuthorizations = new Map<string, PendingAuthorization>()

const takePending = (state: string): PendingAuthorization | undefined => {
  const now = Date.now()
  for (const [key, pending] of pendingAuthorizations) if (now - pending.createdAt > OAUTH_PENDING_TTL_MS) pendingAuthorizations.delete(key)
  const pending = pendingAuthorizations.get(state)
  pendingAuthorizations.delete(state)
  return pending
}

const oauthServer = (ctx: Context, id: string): HttpServer => {
  const server = serversFor(ctx).find(candidate => candidate.id === id)
  if (server === undefined) throw new Error('MCP server was not found.')
  if (!usesOAuth(server)) throw new Error('This server does not use OAuth sign-in.')
  return server
}

const reconnect = async (ctx: Context, id: string): Promise<void> => {
  const live = currentContext(ctx)
  const runtime = runtimes.get(live)
  if (runtime === undefined) return
  runtime.manuallyDisconnected.delete(id)
  await runtime.reconcile(serversFor(live), [id])
}

const callbackPage = (response: ServerResponse, status: number, message: string): void => {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  })
  response.end(
    `<!doctype html><meta charset="utf-8"><title>MCP sign-in</title><body style="font:14px system-ui;padding:32px;color:#ddd;background:#1b1b1b"><p>${message}</p><p>You can close this tab and return to DSH.</p>${status === 200 ? '<script>setTimeout(()=>window.close(),800)</script>' : ''}</body>`,
  )
}

const handleOAuthCallback = async (ctx: Context, request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const url = new URL(request.url ?? '/', 'http://callback.invalid')
  const state = url.searchParams.get('state') ?? ''
  const pending = takePending(state)
  if (pending === undefined) return callbackPage(response, 400, 'This sign-in link has expired or was already used.')
  if (url.searchParams.has('error')) return callbackPage(response, 400, 'The provider did not authorize DSH.')
  const code = url.searchParams.get('code')
  if (code === null || code.length === 0 || code.length > 4096) return callbackPage(response, 400, 'The provider returned no authorization code.')
  try {
    const server = oauthServer(ctx, pending.serverId)
    const grant = await McpOAuthModel.exchangeCode({ pending, callbackParameters: url.searchParams })
    await ctx.credentials.modifyRecord(grantKey(server), async () => ({ kind: 'grant', payload: grant }))
    await reconnect(ctx, server.id)
    callbackPage(response, 200, 'Signed in. The MCP server is reconnecting.')
  } catch {
    ctx.logger.warn('MCP server %s: OAuth code exchange failed.', pending.serverId)
    callbackPage(response, 502, 'Signing in failed while exchanging the authorization code.')
  }
}

const { hostApi, setup: effectSetup } = DshxEffect.plugin({
  layer: Layer.empty,
  setup: (ctx, config) =>
    Effect.gen(function* () {
      const root = ctx.root ?? ctx
      const servers = parseStoredConfig(config)
      let manuallyDisconnected = disconnectionsByRoot.get(root)
      if (manuallyDisconnected === undefined) {
        manuallyDisconnected = new Set(preferencesFrom(config).connectOnStartup ? [] : servers.map(server => server.id))
        disconnectionsByRoot.set(root, manuallyDisconnected)
      }
      const runtime = new ManagerRuntime(ctx, manuallyDisconnected)
      runtimes.set(ctx, runtime)
      yield* Effect.tryPromise({
        try: () => runtime.reconcile(servers),
        catch: () => new McpManagerOperationError({ message: 'MCP manager could not reconcile a server configuration.' }),
      }).pipe(Effect.catch(() => Effect.sync(() => ctx.logger.warn('MCP manager could not reconcile a server configuration.'))))
      yield* Effect.addFinalizer(() => Effect.promise(() => runtime.dispose()))
      yield* Effect.sync(() => {
        ctx.effect(() => ctx.settings.configure({ auto: true }), 'MCP servers settings page')
        ctx.effect(
          () =>
            ctx.webServer.register({
              kind: 'exact',
              path: OAUTH_CALLBACK_PATH,
              handler: (request, response) => handleOAuthCallback(ctx, request, response),
            }),
          'MCP servers OAuth callback',
        )
        ctx.on('credentials/reference-updated', ref => {
          const current = serversFor(ctx)
          const affected = current.filter(server => referenceBindings(server).some(([, reference]) => reference === ref))
          if (affected.length > 0) {
            void runtime
              .reconcile(
                current,
                affected.map(server => server.id),
              )
              .catch(() => {
                ctx.logger.warn('MCP manager could not refresh a credential-backed server.')
              })
          }
        })
      })
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.sleep(TOKEN_REFRESH_INTERVAL_MS).pipe(
            Effect.andThen(
              Effect.tryPromise({
                try: async () => {
                  if (!serversFor(ctx).some(usesOAuth)) return
                  await runtime.reconcile()
                },
                catch: () => new McpManagerOperationError({ message: 'MCP manager could not refresh OAuth tokens.' }),
              }).pipe(Effect.catch(() => Effect.sync(() => ctx.logger.warn('MCP manager could not refresh OAuth tokens.')))),
            ),
          ),
        ),
      )
    }),
})

export default defineHost({
  name: PACKAGE_NAME,
  setup: effectSetup,
  Config,
  inject: ['connection', 'webServer', 'configEditor', 'credentials', 'tools', 'subprocess', 'settings'],
  apis: [
    hostApi(mcpServersApi, {
      list: ({ ctx }) => operation('mcp servers list', () => currentSnapshot(ctx)),
      refresh: ({ ctx }) =>
        operation('mcp servers refresh', async () => {
          const live = currentContext(ctx)
          await runtimes.get(live)?.reconcile()
          return currentSnapshot(ctx)
        }),
      save: ({ ctx, input }) =>
        operation('mcp servers save', async () => {
          const draft = McpSchema.decodeStrict(serverDraftSchema, input.server)
          const candidate = storedDraft(draft)
          const servers = serversFor(ctx)
          return persist(ctx, McpServerStateModel.saveServer({ current: servers, candidate, max: MAX_SERVERS }))
        }),
      setEnabled: ({ ctx, input }) =>
        operation('mcp servers set enabled', async () => {
          const servers = serversFor(ctx)
          return persist(ctx, McpServerStateModel.setServerEnabled({ current: servers, id: input.id, enabled: input.enabled }))
        }),
      setConnection: ({ ctx, input }) =>
        operation('mcp servers set connection', async () => {
          const live = currentContext(ctx)
          const servers = serversFor(live)
          const runtime = runtimeFor(live)
          if (runtime === undefined) throw new Error('MCP client lifecycle is unavailable.')
          await runtime.setConnection(input.id, input.connected, servers)
          return currentSnapshot(ctx, servers)
        }),
      remove: ({ ctx, input }) =>
        operation('mcp servers remove', async () => {
          const servers = serversFor(ctx)
          const removed = servers.find(server => server.id === input.id)
          const next = await persist(ctx, McpServerStateModel.removeServer({ current: servers, id: input.id }))
          if (removed !== undefined && usesOAuth(removed)) await ctx.credentials.deleteRecord(grantKey(removed)).catch(() => undefined)
          return next
        }),
      authorize: ({ ctx, input }) =>
        operation('mcp servers authorize', async () => {
          const server = oauthServer(ctx, input.id)
          const redirectUri = McpOAuthModel.callbackRedirectUri({ origin: input.origin, callbackPath: OAUTH_CALLBACK_PATH })
          const endpoints = await McpOAuthModel.discover({ serverUrl: server.url })
          if (endpoints.authorizationServer.registration_endpoint === undefined) {
            throw new Error('This provider requires a pre-registered OAuth client. Store its token as a credential reference header instead.')
          }
          const client = await McpOAuthModel.registerClient({
            authorizationServer: endpoints.authorizationServer,
            redirectUri,
            clientName: preferencesFor(ctx).oauthClientName,
          })
          const pkce = await McpOAuthModel.createPkcePair()
          const state = McpOAuthModel.createState()
          pendingAuthorizations.set(state, {
            serverId: server.id,
            state,
            verifier: pkce.verifier,
            redirectUri,
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            authorizationServer: endpoints.authorizationServer,
            resource: endpoints.resource,
            createdAt: Date.now(),
          })
          return { authorizationUrl: McpOAuthModel.authorizationUrl({ endpoints, clientId: client.clientId, redirectUri, challenge: pkce.challenge, state }) }
        }),
      signOut: ({ ctx, input }) =>
        operation('mcp servers sign out', async () => {
          const server = oauthServer(ctx, input.id)
          await ctx.credentials.deleteRecord(grantKey(server))
          await runtimes.get(currentContext(ctx))?.reconcile()
          return currentSnapshot(ctx)
        }),
      setPreferences: ({ ctx, input }) =>
        operation('mcp servers set preferences', async () => {
          await ctx.configEditor.edit(entryFor(ctx), current => ({ ...current, preferences: input.preferences }))
          await runtimes.get(currentContext(ctx))?.reconcile()
          return currentSnapshot(ctx)
        }),
      searchRegistry: ({ ctx, input }) =>
        operation('mcp servers search registry', async () => {
          if (!preferencesFor(ctx).registrySearch) throw new Error('Public MCP Registry search is turned off in Settings.')
          return registrySearchService.search({ query: input.query })
        }),
    }),
  ],
})
