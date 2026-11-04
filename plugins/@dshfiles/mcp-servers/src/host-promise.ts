import type { Events } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import { credentialRef, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { apply as nativeMcpClient, type Config as NativeMcpConfig } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { parseSecretReference } from '@dshfiles/credential-port'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { DshxPlugin, HostContext, hostService } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Queue, Schema, type Scope, Stream } from 'effect'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { configSchema, type ManagerConfig } from './config.js'
import { ClientStartFailed, CredentialStoreFailed, ExecutableUnresolved, ManagerConfigUnavailable } from './errors.js'
import { oauthGrantSchema, type OAuthGrant } from './oauth.js'
import { redactingLogger } from './redaction.js'

const ENTRY_ID = 'mcp-servers'
const PACKAGE_NAME = '@dshfiles/mcp-servers'

const decodeConfig = Schema.decodeUnknownEffect(configSchema)
const decodeGrant = Schema.decodeUnknownOption(oauthGrantSchema)

type CallbackHandler = (request: IncomingMessage, response: ServerResponse) => Effect.Effect<void>

/** Resolves a local start command to an absolute executable with its resolved environment. */
export class McpExecutables extends Context.Service<
  McpExecutables,
  { readonly resolve: (input: { readonly command: string; readonly env: Readonly<Record<string, string>> }) => Effect.Effect<string, ExecutableUnresolved> }
>()('@dshfiles/mcp-servers/McpExecutables') {
  static readonly layer = Layer.effect(
    McpExecutables,
    Effect.gen(function* () {
      const subprocess = yield* hostService('subprocess')
      return McpExecutables.of({
        resolve: input =>
          Effect.tryPromise({
            try: signal => subprocess.resolveExecutable(input.command, input.env, signal),
            catch: cause => new ExecutableUnresolved({ command: input.command, cause }),
          }),
      })
    }),
  )
}

/** The Host services the MCP manager reads and writes: its profile row, credentials, tool registry, native clients and routes. */
export class McpHost extends Context.Service<
  McpHost,
  {
    readonly config: Effect.Effect<ManagerConfig, ManagerConfigUnavailable>
    /** The raw row, for preferences that must survive an unreadable row. */
    readonly rawConfig: Effect.Effect<unknown, ManagerConfigUnavailable>
    readonly editConfig: (change: (current: Record<string, unknown>) => Record<string, unknown>) => Effect.Effect<void, ManagerConfigUnavailable>
    /** Fires after a profile edit reaches this row; the manager reconciles in place instead of restarting. */
    readonly configUpdates: Stream.Stream<void>
    readonly readGrant: (key: CredentialKey) => Effect.Effect<Option.Option<OAuthGrant>>
    /** Replace the grant under the credential record lock with what `change` returns for it; `None` keeps it. */
    readonly modifyGrant: (
      key: CredentialKey,
      change: (stored: OAuthGrant) => Effect.Effect<Option.Option<OAuthGrant>>,
    ) => Effect.Effect<Option.Option<OAuthGrant>, CredentialStoreFailed>
    readonly writeGrant: (key: CredentialKey, grant: OAuthGrant) => Effect.Effect<void, CredentialStoreFailed>
    readonly deleteGrant: (key: CredentialKey) => Effect.Effect<void, CredentialStoreFailed>
    readonly isConfigured: (reference: string) => Effect.Effect<boolean>
    readonly resolveReference: (reference: string) => Effect.Effect<Option.Option<string>>
    readonly toolNames: Effect.Effect<ReadonlyArray<string>>
    readonly warn: (format: string, ...params: ReadonlyArray<unknown>) => Effect.Effect<void>
    /** Run one native MCP client for the current Scope; closing it disposes the client fiber. */
    readonly attachClient: (input: {
      readonly id: string
      readonly config: NativeMcpConfig
      readonly redactions: ReadonlyArray<string>
    }) => Effect.Effect<void, ClientStartFailed, Scope.Scope>
    readonly serveRoute: (input: { readonly path: string; readonly handler: CallbackHandler }) => Effect.Effect<void, never, Scope.Scope>
    readonly showSettingsPage: Effect.Effect<void, never, Scope.Scope>
    readonly referenceUpdates: Stream.Stream<string>
  }
>()('@dshfiles/mcp-servers/McpHost') {
  static readonly layer = Layer.effect(
    McpHost,
    Effect.gen(function* () {
      const host = yield* HostContext
      const configEditor = yield* hostService('configEditor')
      const credentials = yield* hostService('credentials')
      const tools = yield* hostService('tools')
      const webServer = yield* hostService('webServer')
      const settings = yield* hostService('settings')

      const entry = Effect.suspend(() => {
        const matches = configEditor.entries().filter(candidate => candidate.options.id === ENTRY_ID && candidate.options.name === PACKAGE_NAME)
        const found = matches[0]
        if (matches.length !== 1 || found?.fiber === undefined) return Effect.fail(new ManagerConfigUnavailable({ reason: 'row-missing' }))
        return Effect.succeed(found)
      })

      const rawConfig = Effect.map(entry, found => found.options.config ?? {})
      const config = Effect.flatMap(rawConfig, raw =>
        decodeConfig(raw).pipe(Effect.mapError(cause => new ManagerConfigUnavailable({ reason: 'invalid', cause }))),
      )

      const editConfig = Effect.fn('mcp servers config edit')(function* (change: (current: Record<string, unknown>) => Record<string, unknown>) {
        const found = yield* entry
        yield* Effect.tryPromise({
          try: () => configEditor.edit(found, current => change(current)),
          catch: cause => new ManagerConfigUnavailable({ reason: 'write', cause }),
        })
      })

      const configUpdates = Stream.callback<void>(queue =>
        Effect.acquireRelease(
          Effect.sync(() =>
            host.ctx.on('internal/update', () => {
              Queue.offerUnsafe(queue, undefined)
            }),
          ),
          dispose => Effect.sync(dispose),
        ),
      )

      const readGrant = (key: CredentialKey) =>
        Effect.tryPromise(() => credentials.readRecord(key)).pipe(
          Effect.map(record => (record?.kind === 'grant' ? decodeGrant(record.payload) : Option.none())),
          Effect.catch(() => Effect.succeedNone),
        )

      const modifyGrant = Effect.fn('mcp servers grant modify')(function* (
        key: CredentialKey,
        change: (stored: OAuthGrant) => Effect.Effect<Option.Option<OAuthGrant>>,
      ) {
        const run = yield* DshxPlugin.callback(change)
        let result: Option.Option<OAuthGrant> = Option.none()
        yield* Effect.tryPromise({
          try: () =>
            credentials.modifyRecord(key, async current => {
              const stored = current?.kind === 'grant' ? decodeGrant(current.payload) : Option.none()
              if (Option.isNone(stored)) return current
              result = await run(stored.value)
              return Option.match(result, { onNone: () => current, onSome: grant => ({ kind: 'grant', payload: grant }) })
            }),
          catch: cause => new CredentialStoreFailed({ operation: 'write', cause }),
        })
        return result
      })

      const writeGrant = (key: CredentialKey, grant: OAuthGrant) =>
        Effect.tryPromise({
          try: () => credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: grant })),
          catch: cause => new CredentialStoreFailed({ operation: 'write', cause }),
        }).pipe(Effect.asVoid)

      const deleteGrant = (key: CredentialKey) =>
        Effect.tryPromise({ try: () => credentials.deleteRecord(key), catch: cause => new CredentialStoreFailed({ operation: 'delete', cause }) })

      const secrets = yield* SecretReferenceResolver

      // A `secret:ALIAS[@env]` binding names a global Secret Catalog alias; anything else is a DSH credential name.
      // Availability reads the Catalog's value-free key list, so a snapshot never reveals a value to show a badge.
      const secretConfigured = (reference: NonNullable<ReturnType<typeof parseSecretReference>>) =>
        Effect.suspend(() => {
          const bridge = host.ctx.get('secretCatalogCredentials')
          if (bridge === undefined) return Effect.succeed(false)
          return Effect.tryPromise(signal => bridge.listKeys(null, signal)).pipe(
            Effect.map(keys => keys.filter(key => key.alias === reference.alias && key.environment === reference.environment).length === 1),
            Effect.catch(() => Effect.succeed(false)),
          )
        })

      const isConfigured = (reference: string) => {
        const secret = parseSecretReference(reference)
        if (secret !== null) return secretConfigured(secret)
        return Effect.tryPromise(() => credentials.describe(credentialRef(reference))).pipe(
          Effect.map(info => info.configured),
          Effect.catch(() => Effect.succeed(false)),
        )
      }

      const resolveReference = (reference: string) => {
        if (parseSecretReference(reference) !== null)
          return secrets.resolve({ referenceText: reference, environmentValue: undefined }).pipe(
            Effect.map(Option.filter(value => value.length > 0)),
            Effect.tapError(error =>
              Effect.sync(() => host.ctx.logger.warn('MCP servers: Secret Catalog reference %s did not resolve: %s', reference, error.message)),
            ),
            Effect.catch(() => Effect.succeedNone),
          )
        return Effect.tryPromise(() => credentials.resolve(credentialRef(reference))).pipe(
          Effect.map(result => (result === undefined || result.value.length === 0 ? Option.none() : Option.some(result.value))),
          Effect.catch(() => Effect.succeedNone),
        )
      }

      const attachClient = Effect.fn('mcp server attach')(function* (input: {
        readonly id: string
        readonly config: NativeMcpConfig
        readonly redactions: ReadonlyArray<string>
      }) {
        const logger = redactingLogger(host.ctx.logger, input.redactions)
        yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => host.ctx.extend({ logger }).plugin(nativeMcpClient, input.config),
            catch: cause => new ClientStartFailed({ id: input.id, cause }),
          }).pipe(Effect.tapError(error => Effect.sync(() => logger.warn('MCP server %s: native client failed to start: %s', input.id, error.cause)))),
          fiber => Effect.promise(() => fiber.dispose()).pipe(Effect.ignore),
        )
      })

      const serveRoute = (input: { readonly path: string; readonly handler: CallbackHandler }) =>
        Effect.gen(function* () {
          const run = yield* DshxPlugin.callback(input.handler)
          yield* Effect.acquireRelease(
            Effect.sync(() => webServer.register({ kind: 'exact', path: input.path, handler: (request, response) => run(request, response) })),
            dispose => Effect.sync(dispose),
          )
        })

      const referenceUpdates = Stream.callback<string>(queue =>
        Effect.acquireRelease(
          Effect.sync(() =>
            host.ctx.on('credentials/reference-updated', (reference => {
              Queue.offerUnsafe(queue, String(reference))
            }) satisfies Events['credentials/reference-updated']),
          ),
          dispose => Effect.sync(dispose),
        ),
      )

      return McpHost.of({
        config,
        rawConfig,
        editConfig,
        configUpdates,
        readGrant,
        modifyGrant,
        writeGrant,
        deleteGrant,
        isConfigured,
        resolveReference,
        toolNames: Effect.sync(() => tools.schemas().map(tool => tool.name)),
        warn: (format, ...params) => Effect.sync(() => host.ctx.logger.warn(format, ...params)),
        attachClient,
        serveRoute,
        showSettingsPage: Effect.acquireRelease(
          Effect.sync(() => settings.configure({ auto: true })),
          dispose => Effect.sync(dispose),
        ).pipe(Effect.asVoid),
        referenceUpdates,
      })
    }),
  ).pipe(Layer.provide(SecretReferenceResolver.layer))
}
