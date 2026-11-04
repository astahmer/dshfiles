import { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { Config as NativeMcpConfig } from '@deepseek-ai/dsh-mcp-client'
import { Context, Effect, Layer, Option, Ref, Schema, type Scope } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { preferencesSchema, type ManagerPreferences, type ManagerSnapshot, type RegistryEntry, type ServerDraft, type StoredServer } from './api.js'
import { McpCatalogModel } from './catalog.js'
import { McpCommandLineModel } from './command-line.js'
import { configSchema, MAX_SERVERS, type ManagerConfig } from './config.js'
import {
  CredentialStoreFailed,
  ManagerConfigUnavailable,
  McpServerNotFound,
  OAuthFlowFailed,
  OAuthNotSupported,
  OAuthRegistrationUnsupported,
  RegistrySearchDisabled,
  RegistrySearchFailed,
  ServerChangeRejected,
} from './errors.js'
import { McpHost } from './host-promise.js'
import { LocalCommands, type LocalProcess, type LocalProcessStatus } from './local-process.js'
import { McpOAuthModel, type OAuthGrant, type PendingAuthorization } from './oauth.js'
import { McpOAuth } from './oauth-promise.js'
import { PendingAuthorizations } from './pending-authorizations.js'
import { makeClientReconciler, type ClientTarget } from './reconcile.js'
import { RegistrySearch } from './registry-search.js'
import { McpServerStateModel } from './server-state.js'

export const OAUTH_CALLBACK_PATH = '/api/dshfiles-mcp-servers/oauth/callback'
const CREDENTIAL_SCOPE = 'mcp-servers'

type HttpServer = Extract<StoredServer, { transport: 'streamable-http' }>

type NativeTarget = ClientTarget & {
  readonly config: NativeMcpConfig
  readonly redactions: ReadonlyArray<string>
  readonly localCommand?: { readonly command: string; readonly args: readonly string[]; readonly cwd: string; readonly env: Readonly<Record<string, string>> }
}

const decodeConfig = Schema.decodeUnknownResult(configSchema)
const decodePreferences = Schema.decodeUnknownEffect(preferencesSchema)

const usesOAuth = (server: StoredServer): server is HttpServer => server.transport === 'streamable-http' && server.auth === 'oauth'

const grantKey = (server: StoredServer): CredentialKey =>
  credentialKey(CREDENTIAL_SCOPE, `oauth-${createHash('sha256').update(server.id).digest('hex').slice(0, 24)}`)

const referenceBindings = (server: StoredServer): ReadonlyArray<readonly [string, string]> =>
  server.transport === 'stdio' ? Object.entries(server.envRefs) : [...Object.entries(server.headerRefs), ...Object.entries(server.startCommand?.envRefs ?? {})]

const rejected = (fallback: string) => (cause: unknown) =>
  new ServerChangeRejected({ reason: cause instanceof Error && cause.message.length > 0 ? cause.message.slice(0, 240) : fallback, cause })

/** The row's server list as a stored server from one draft; a command line is split without a shell. */
const storedDraft = (draft: ServerDraft): StoredServer => {
  const id = draft.id || randomUUID()
  if (draft.transport === 'streamable-http') {
    const oauth = draft.auth === 'oauth' ? { auth: 'oauth' as const } : {}
    const localStart = draft.startCommand
    const base = {
      id,
      name: draft.name,
      serverName: draft.serverName,
      enabled: draft.enabled,
      transport: draft.transport,
      url: draft.url,
      headerRefs: draft.headerRefs,
      ...oauth,
    }
    if (localStart == null) return base
    const [command, ...args] = McpCommandLineModel.parseCommandLine(localStart.commandLine)
    if (command === undefined) throw new TypeError('Enter a local start command.')
    if (McpCommandLineModel.hasInlineCredential([command, ...args])) throw new TypeError('Use credential references instead of inline command credentials.')
    if (McpCommandLineModel.hasUnexpandedTilde([command, ...args])) throw new TypeError(McpCommandLineModel.UNEXPANDED_TILDE_MESSAGE)
    return { ...base, startCommand: { command, args, cwd: localStart.cwd, envRefs: localStart.envRefs } }
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

const callbackPage = (response: ServerResponse, status: number, message: string): void => {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  })
  response.end(
    `<!doctype html><meta charset="utf-8"><title>MCP sign-in</title><body style="font:14px system-ui;padding:32px;color:#ddd;background:#1b1b1b"><p>${message}</p><p>You can close this tab and return to DSH.</p>${status === 200 ? '<script>window.setTimeout(()=>window.close(),800)</script>' : ''}</body>`,
  )
}

type ConfigError = ManagerConfigUnavailable
type ChangeError = ConfigError | ServerChangeRejected | McpServerNotFound
type Snapshot = Effect.Effect<ManagerSnapshot, ConfigError>

/**
 * The MCP manager: one native client per enabled server, each in its own child Scope with its local start command.
 * `reconcile` computes the targets (credentials, OAuth grants) and applies them under one Semaphore, so an older
 * target list can never be applied after a newer one.
 */
export class McpManager extends Context.Service<
  McpManager,
  {
    readonly snapshot: Snapshot
    readonly reconcile: (input?: {
      readonly servers?: ReadonlyArray<StoredServer>
      readonly restart?: ReadonlyArray<string>
    }) => Effect.Effect<void, ConfigError>
    readonly referenceUpdated: (reference: string) => Effect.Effect<void, ConfigError>
    readonly refreshTokens: Effect.Effect<void, ConfigError>
    readonly save: (draft: ServerDraft) => Effect.Effect<ManagerSnapshot, ChangeError>
    readonly setEnabled: (input: { readonly id: string; readonly enabled: boolean }) => Effect.Effect<ManagerSnapshot, ChangeError>
    readonly setConnection: (input: { readonly id: string; readonly connected: boolean }) => Effect.Effect<ManagerSnapshot, ConfigError | McpServerNotFound>
    readonly remove: (id: string) => Effect.Effect<ManagerSnapshot, ChangeError>
    readonly authorize: (input: {
      readonly id: string
      readonly origin: string
    }) => Effect.Effect<
      { readonly authorizationUrl: string },
      ConfigError | McpServerNotFound | OAuthNotSupported | OAuthRegistrationUnsupported | OAuthFlowFailed
    >
    readonly signOut: (id: string) => Effect.Effect<ManagerSnapshot, ConfigError | McpServerNotFound | OAuthNotSupported | CredentialStoreFailed>
    readonly setPreferences: (preferences: ManagerPreferences) => Effect.Effect<ManagerSnapshot, ConfigError>
    readonly searchRegistry: (query: string) => Effect.Effect<ReadonlyArray<RegistryEntry>, ConfigError | RegistrySearchDisabled | RegistrySearchFailed>
    readonly handleCallback: (request: IncomingMessage, response: ServerResponse) => Effect.Effect<void>
  }
>()('@dshfiles/mcp-servers/McpManager') {
  static readonly layer = (startup: ManagerConfig) =>
    Layer.effect(
      McpManager,
      Effect.gen(function* () {
        const host = yield* McpHost
        const oauth = yield* McpOAuth
        const localCommands = yield* LocalCommands
        const registry = yield* RegistrySearch
        const pendings = yield* PendingAuthorizations

        const connectOnStartup = (yield* decodePreferences(startup.preferences ?? {}).pipe(Effect.orDie)).connectOnStartup
        const disconnected = yield* Ref.make<ReadonlySet<string>>(new Set(connectOnStartup ? [] : startup.servers.map(server => server.id)))
        const localProcesses = yield* Ref.make<ReadonlyMap<string, LocalProcess>>(new Map())

        const servers = Effect.map(host.config, config => config.servers)

        /** A row may be unreadable or predate a field; either way the preferences fall back to their defaults. */
        const preferences = Effect.gen(function* () {
          const raw = yield* host.rawConfig
          const parsed = decodeConfig(raw)
          const stored = parsed._tag === 'Success' ? (parsed.success.preferences ?? {}) : {}
          return yield* decodePreferences(stored).pipe(
            Effect.catch(() => decodePreferences({})),
            Effect.orDie,
          )
        })

        const liveGrant = Effect.fnUntraced(function* (server: StoredServer) {
          const grant = yield* host.readGrant(grantKey(server))
          if (Option.isNone(grant) || !(yield* oauth.needsRefresh(grant.value))) return grant
          return yield* host
            .modifyGrant(grantKey(server), stored =>
              Effect.flatMap(oauth.needsRefresh(stored), stale => (stale ? oauth.refresh(stored) : Effect.succeedSome(stored))),
            )
            .pipe(Effect.catch(() => Effect.succeedNone))
        })

        const resolveReferences = (refs: Readonly<Record<string, string>>) =>
          Effect.forEach(Object.entries(refs), ([key, name]) =>
            Effect.map(
              host.resolveReference(name),
              Option.map((value): readonly [string, string] => [key, value]),
            ),
          ).pipe(Effect.map(entries => Option.map(Option.all(entries), resolved => Object.fromEntries(resolved))))

        const nativeTarget = Effect.fnUntraced(function* (server: StoredServer, suspended: boolean, toolCallTimeoutMs: number) {
          if (server.transport === 'stdio') {
            const env = yield* resolveReferences(server.envRefs)
            const resolved = Option.getOrElse(env, () => ({}))
            const stdio: NativeTarget = {
              id: server.id,
              enabled: server.enabled,
              ready: Option.isSome(env),
              suspended,
              // Only the reference-only row enters the fingerprint; secret values never reach fingerprints or logs.
              fingerprint: JSON.stringify({ server }),
              config: {
                transport: 'stdio',
                serverName: server.serverName,
                command: server.command,
                args: [...server.args],
                cwd: server.cwd,
                env: resolved,
                toolCallTimeoutMs,
                failOnStartupError: false,
              },
              redactions: Object.values(resolved),
            }
            return stdio
          }
          const referenced = yield* resolveReferences(server.headerRefs)
          const grant = usesOAuth(server) ? yield* liveGrant(server) : Option.none<OAuthGrant>()
          const oauthReady = !usesOAuth(server) || Option.isSome(grant)
          const headers =
            Option.isNone(referenced) || !oauthReady
              ? Option.none<Record<string, string>>()
              : Option.some(
                  Option.match(grant, {
                    onNone: () => referenced.value,
                    onSome: current => ({ ...referenced.value, Authorization: `Bearer ${current.accessToken}` }),
                  }),
                )
          const localEnv = server.startCommand === undefined ? Option.none<Record<string, string>>() : yield* resolveReferences(server.startCommand.envRefs)
          const resolvedHeaders = Option.getOrElse(headers, () => ({}))
          const startCommand = server.startCommand
          const http: NativeTarget = {
            id: server.id,
            enabled: server.enabled,
            ready: Option.isSome(headers) && (startCommand === undefined || Option.isSome(localEnv)),
            suspended,
            // The grant issue time joins the fingerprint, so a refreshed token reconnects.
            fingerprint: JSON.stringify({ server, grantVersion: Option.getOrUndefined(Option.map(grant, current => current.issuedAt)) }),
            config: {
              transport: 'streamable-http',
              serverName: server.serverName,
              url: server.url,
              headers: resolvedHeaders,
              toolCallTimeoutMs,
              failOnStartupError: false,
            },
            redactions: [...Object.values(resolvedHeaders), ...Object.values(Option.getOrElse(localEnv, () => ({})))],
            ...(startCommand !== undefined && Option.isSome(localEnv) && { localCommand: { ...startCommand, env: localEnv.value } }),
          }
          return http
        })

        const startClient = (target: NativeTarget): Effect.Effect<void, unknown, Scope.Scope> =>
          Effect.gen(function* () {
            const command = target.localCommand
            const local =
              command === undefined
                ? undefined
                : yield* localCommands
                    .start({ id: target.id, command, env: command.env })
                    .pipe(Effect.tapError(() => host.warn('MCP server %s: local start command failed.', target.id)))
            if (local !== undefined) yield* Ref.update(localProcesses, current => new Map(current).set(target.id, local))
            yield* host.attachClient({ id: target.id, config: target.config, redactions: target.redactions })
            if (local !== undefined) yield* local.markRunning
          })

        const reconciler = yield* makeClientReconciler(startClient)

        const localStatus = Effect.fnUntraced(function* (server: StoredServer) {
          if (server.transport !== 'streamable-http' || server.startCommand === undefined) return 'not-configured' satisfies LocalProcessStatus
          const local = (yield* Ref.get(localProcesses)).get(server.id)
          if (local !== undefined) return yield* local.status
          const lifecycle = yield* reconciler.state(server.id)
          const status: LocalProcessStatus = lifecycle === 'starting' ? 'starting' : 'stopped'
          return status
        })

        const reconcile = Effect.fn('mcp servers reconcile')(function* (
          input: { readonly servers?: ReadonlyArray<StoredServer>; readonly restart?: ReadonlyArray<string> } = {},
        ) {
          const plan = Effect.gen(function* () {
            const current = input.servers ?? (yield* servers)
            const ids = new Set(current.map(server => server.id))
            const suspended = yield* Ref.updateAndGet(disconnected, previous => new Set([...previous].filter(id => ids.has(id))))
            const toolCallTimeoutMs = (yield* preferences).toolCallTimeoutSeconds * 1000
            const targets = yield* Effect.forEach(current, server => nativeTarget(server, suspended.has(server.id), toolCallTimeoutMs))
            const locals = yield* Ref.get(localProcesses)
            const running = targets.filter(target => target.enabled && target.ready && target.suspended !== true && target.localCommand !== undefined)
            const exited = yield* Effect.forEach(running, target => {
              const local = locals.get(target.id)
              if (local === undefined) return Effect.succeed([])
              return Effect.map(local.status, status => (status === 'exited' ? [target.id] : []))
            })
            const restart = new Set([...(input.restart ?? []), ...exited.flat()])
            return { targets, restart }
          })
          yield* reconciler.reconcile(plan)
        })

        const snapshotOf = Effect.fn('mcp servers snapshot')(function* (current: ReadonlyArray<StoredServer>) {
          const tools = yield* host.toolNames
          const rows = yield* Effect.forEach(
            current,
            server =>
              Effect.gen(function* () {
                const signedIn = usesOAuth(server) ? Option.isSome(yield* host.readGrant(grantKey(server))) : false
                const references = [...new Set(referenceBindings(server).map(([, reference]) => reference))]
                const availability = new Map(
                  yield* Effect.forEach(
                    references,
                    reference => Effect.map(host.isConfigured(reference), (configured): readonly [string, boolean] => [reference, configured]),
                    {
                      concurrency: 'unbounded',
                    },
                  ),
                )
                const prefix = `mcp__${server.serverName}__`
                return McpServerStateModel.publicServerView({
                  server,
                  availability,
                  clientLifecycle: yield* reconciler.state(server.id),
                  localProcess: yield* localStatus(server),
                  signedIn,
                  registeredToolCount: tools.reduce((count, name) => count + Number(name.startsWith(prefix)), 0),
                })
              }),
            { concurrency: 'unbounded' },
          )
          const currentPreferences = yield* preferences
          const snapshot: ManagerSnapshot = {
            servers: rows,
            providers: [...McpCatalogModel.providers],
            connectionHealth: 'not-reported',
            registrySearch: currentPreferences.registrySearch,
            preferences: currentPreferences,
          }
          return snapshot
        })

        const snapshot = Effect.flatMap(servers, snapshotOf)

        const persist = Effect.fnUntraced(function* (next: ReadonlyArray<StoredServer>) {
          if (next.length > MAX_SERVERS) return yield* new ServerChangeRejected({ reason: `At most ${MAX_SERVERS} servers can be configured.` })
          yield* host.editConfig(current => ({ ...current, servers: next }))
          yield* reconcile({ servers: next })
          return yield* snapshotOf(next)
        })

        const existing = Effect.fnUntraced(function* (id: string) {
          const found = (yield* servers).find(server => server.id === id)
          if (found === undefined) return yield* new McpServerNotFound({ id })
          return found
        })

        const oauthServer = Effect.fnUntraced(function* (id: string) {
          const server = yield* existing(id)
          if (!usesOAuth(server)) return yield* new OAuthNotSupported({ id })
          return server
        })

        const save = Effect.fn('mcp servers save')(function* (draft: ServerDraft) {
          const candidate = yield* Effect.try({ try: () => storedDraft(draft), catch: rejected('The server could not be saved.') })
          const current = yield* servers
          const next = yield* Effect.try({
            try: () => McpServerStateModel.saveServer({ current: [...current], candidate, max: MAX_SERVERS }),
            catch: rejected('The server could not be saved.'),
          })
          return yield* persist(next)
        })

        const setEnabled = Effect.fn('mcp servers set enabled')(function* (input: { readonly id: string; readonly enabled: boolean }) {
          yield* existing(input.id)
          return yield* persist(McpServerStateModel.setServerEnabled({ current: [...(yield* servers)], id: input.id, enabled: input.enabled }))
        })

        const setConnection = Effect.fn('mcp servers set connection')(function* (input: { readonly id: string; readonly connected: boolean }) {
          const current = yield* servers
          if (!current.some(server => server.id === input.id)) return yield* new McpServerNotFound({ id: input.id })
          yield* Ref.update(disconnected, previous => {
            const next = new Set(previous)
            if (input.connected) next.delete(input.id)
            else next.add(input.id)
            return next
          })
          yield* reconcile({ servers: current, restart: input.connected ? [input.id] : [] })
          return yield* snapshotOf(current)
        })

        const remove = Effect.fn('mcp servers remove')(function* (id: string) {
          const removed = yield* existing(id)
          const next = yield* persist(McpServerStateModel.removeServer({ current: [...(yield* servers)], id }))
          if (usesOAuth(removed)) yield* host.deleteGrant(grantKey(removed)).pipe(Effect.ignore)
          return next
        })

        const authorize = Effect.fn('mcp servers authorize')(function* (input: { readonly id: string; readonly origin: string }) {
          const server = yield* oauthServer(input.id)
          const redirectUri = yield* Effect.try({
            try: () => McpOAuthModel.callbackRedirectUri({ origin: input.origin, callbackPath: OAUTH_CALLBACK_PATH }),
            catch: cause =>
              new OAuthFlowFailed({ step: 'redirect', reason: cause instanceof Error ? cause.message.slice(0, 240) : 'Pass only the DSH origin.', cause }),
          })
          const endpoints = yield* oauth.discover(server.url)
          if (endpoints.authorizationServer.registration_endpoint === undefined) return yield* new OAuthRegistrationUnsupported({ id: server.id })
          const client = yield* oauth.registerClient({ endpoints, redirectUri, clientName: (yield* preferences).oauthClientName })
          const start = yield* oauth.authorizationStart
          yield* pendings.put({
            serverId: server.id,
            state: start.state,
            verifier: start.verifier,
            redirectUri,
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            authorizationServer: endpoints.authorizationServer,
            resource: endpoints.resource,
          })
          const authorizationUrl = yield* Effect.try({
            try: () => McpOAuthModel.authorizationUrl({ endpoints, clientId: client.clientId, redirectUri, challenge: start.challenge, state: start.state }),
            catch: cause => new OAuthFlowFailed({ step: 'discover', reason: 'The authorization server has no authorization endpoint.', cause }),
          })
          return { authorizationUrl }
        })

        const signOut = Effect.fn('mcp servers sign out')(function* (id: string) {
          const server = yield* oauthServer(id)
          yield* host.deleteGrant(grantKey(server))
          yield* reconcile()
          return yield* snapshot
        })

        const setPreferences = Effect.fn('mcp servers set preferences')(function* (next: ManagerPreferences) {
          yield* host.editConfig(current => ({ ...current, preferences: next }))
          yield* reconcile()
          return yield* snapshot
        })

        const searchRegistry = Effect.fn('mcp servers search registry')(function* (query: string) {
          if (!(yield* preferences).registrySearch) return yield* new RegistrySearchDisabled()
          return yield* registry.search(query)
        })

        const exchange = Effect.fnUntraced(function* (pending: PendingAuthorization, parameters: URLSearchParams) {
          const server = yield* oauthServer(pending.serverId)
          const grant = yield* oauth.exchangeCode({ pending, callbackParameters: parameters })
          yield* host.writeGrant(grantKey(server), grant)
          yield* Ref.update(disconnected, previous => new Set([...previous].filter(id => id !== server.id)))
          yield* reconcile({ restart: [server.id] })
        })

        const handleCallback = Effect.fn('mcp oauth callback')(function* (request: IncomingMessage, response: ServerResponse) {
          const url = new URL(request.url ?? '/', 'http://callback.invalid')
          const pending = yield* pendings.take(url.searchParams.get('state') ?? '')
          if (Option.isNone(pending)) return callbackPage(response, 400, 'This sign-in link has expired or was already used.')
          if (url.searchParams.has('error')) return callbackPage(response, 400, 'The provider did not authorize DSH.')
          const code = url.searchParams.get('code')
          if (code === null || code.length === 0 || code.length > 4096) return callbackPage(response, 400, 'The provider returned no authorization code.')
          yield* exchange(pending.value, url.searchParams).pipe(
            Effect.matchCauseEffect({
              onSuccess: () => Effect.sync(() => callbackPage(response, 200, 'Signed in. The MCP server is reconnecting.')),
              onFailure: () =>
                host
                  .warn('MCP server %s: OAuth code exchange failed.', pending.value.serverId)
                  .pipe(Effect.andThen(Effect.sync(() => callbackPage(response, 502, 'Signing in failed while exchanging the authorization code.')))),
            }),
          )
        })

        const referenceUpdated = Effect.fn('mcp servers reference updated')(function* (reference: string) {
          const current = yield* servers
          const affected = current.filter(server => referenceBindings(server).some(([, bound]) => bound === reference))
          if (affected.length === 0) return
          yield* reconcile({ servers: current, restart: affected.map(server => server.id) })
        })

        const refreshTokens = Effect.gen(function* () {
          if (!(yield* servers).some(usesOAuth)) return
          yield* reconcile()
        })

        return McpManager.of({
          snapshot,
          reconcile,
          referenceUpdated,
          refreshTokens,
          save,
          setEnabled,
          setConnection,
          remove,
          authorize,
          signOut,
          setPreferences,
          searchRegistry,
          handleCallback,
        })
      }),
    )
}
