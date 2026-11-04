import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { Effect, Layer, Schedule, Stream } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { mcpServersApi } from './api.js'
import { configSchema, type ManagerConfig } from './config.js'
import { McpExecutables, McpHost } from './host-promise.js'
import { LocalCommands } from './local-process.js'
import { McpManager, OAUTH_CALLBACK_PATH } from './manager.js'
import { McpOAuth } from './oauth-promise.js'
import { PendingAuthorizations } from './pending-authorizations.js'
import { RegistrySearch } from './registry-search.js'

const PACKAGE_NAME = '@dshfiles/mcp-servers'
const TOKEN_REFRESH_INTERVAL = '5 minutes'
const CONFIG_DEBOUNCE = '250 millis'

/** Start every configured client, then keep them in step with credential edits, profile edits and expiring OAuth tokens. */
const workers = Layer.effectDiscard(
  Effect.gen(function* () {
    const manager = yield* McpManager
    const host = yield* McpHost
    const warnOnFailure =
      (message: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.asVoid,
          Effect.catchCause(() => host.warn(message)),
        )

    yield* manager.reconcile().pipe(warnOnFailure('MCP manager could not reconcile a server configuration.'))
    yield* host.showSettingsPage
    yield* host.serveRoute({ path: OAUTH_CALLBACK_PATH, handler: manager.handleCallback })
    yield* DshxPlugin.worker(
      Stream.runForEach(host.referenceUpdates, reference =>
        manager.referenceUpdated(reference).pipe(warnOnFailure('MCP manager could not refresh a credential-backed server.')),
      ),
    )
    yield* DshxPlugin.worker(
      host.configUpdates.pipe(
        Stream.debounce(CONFIG_DEBOUNCE),
        Stream.runForEach(() => manager.reconcile().pipe(warnOnFailure('MCP manager could not reconcile a server configuration.'))),
      ),
    )
    const refreshTokens = manager.refreshTokens.pipe(warnOnFailure('MCP manager could not refresh OAuth tokens.'))
    yield* DshxPlugin.worker(Effect.sleep(TOKEN_REFRESH_INTERVAL).pipe(Effect.andThen(Effect.repeat(refreshTokens, Schedule.spaced(TOKEN_REFRESH_INTERVAL)))))
  }),
)

const pluginLayer = (config: ManagerConfig) =>
  workers.pipe(
    Layer.provideMerge(McpManager.layer(config)),
    Layer.provideMerge(Layer.mergeAll(McpOAuth.layer, LocalCommands.layer, RegistrySearch.layer, PendingAuthorizations.layer)),
    Layer.provideMerge(Layer.mergeAll(McpHost.layer, McpExecutables.layer, DshChildProcessSpawner.layer, FetchHttpClient.layer)),
  )

const handlers = Api.handlers(mcpServersApi, {
  list: () => McpManager.use(manager => manager.snapshot),
  refresh: () => McpManager.use(manager => manager.reconcile().pipe(Effect.andThen(manager.snapshot))),
  save: input => McpManager.use(manager => manager.save(input.server)),
  setEnabled: input => McpManager.use(manager => manager.setEnabled(input)),
  setConnection: input => McpManager.use(manager => manager.setConnection(input)),
  remove: input => McpManager.use(manager => manager.remove(input.id)),
  authorize: input => McpManager.use(manager => manager.authorize(input)),
  signOut: input => McpManager.use(manager => manager.signOut(input.id)),
  setPreferences: input => McpManager.use(manager => manager.setPreferences(input.preferences)),
  searchRegistry: input => McpManager.use(manager => manager.searchRegistry(input.query)),
})

export default DshxPlugin.make({
  name: PACKAGE_NAME,
  Config: configSchema,
  inject: ['connection', 'webServer', 'configEditor', 'credentials', 'tools', 'subprocess', 'settings'],
  layer: pluginLayer,
  apis: [Api.bind(mcpServersApi, handlers)],
})
