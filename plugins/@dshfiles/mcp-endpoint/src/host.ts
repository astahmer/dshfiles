import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { mcpEndpointApi } from './endpoint-api.js'
import { createEndpointStore, type EndpointStore } from './endpoint-store.js'
import { isLoopbackAddress } from './local-address.js'
import { createMcpRoute, MCP_PATH } from './mcp-route.js'
import { createSessionsClient } from './sessions-client.js'

const VERSION = '0.1.0'

class EndpointStorageFailure extends Schema.TaggedError<EndpointStorageFailure>()('EndpointStorageFailure', {
  message: Schema.String,
}) {}

class EndpointRuntime extends EffectContext.Service<EndpointRuntime, { readonly store: EndpointStore }>()('dshfiles/mcp-endpoint/EndpointRuntime') {}

const endpointPlugin = DshxEffect.plugin({
  layer: (ctx: Context) => Layer.succeed(EndpointRuntime, { store: createEndpointStore(ctx) }),
  setup: (ctx: Context) =>
    Effect.gen(function* () {
      const runtime = yield* EndpointRuntime
      const route = createMcpRoute({
        store: runtime.store,
        sessions: () => createSessionsClient(ctx),
        projects: () => ctx.workspaceRegistry.list().map(workspace => ({ projectId: workspace.id, title: workspace.title, path: workspace.path })),
        version: VERSION,
      })
      yield* Effect.acquireRelease(
        Effect.sync(() => ctx.webServer.register({ kind: 'exact', path: MCP_PATH, handler: route })),
        unregister => Effect.sync(unregister),
      )
    }),
})

const storageOperation = <Value>(operation: () => Promise<Value>) =>
  Effect.tryPromise({ try: operation, catch: () => new EndpointStorageFailure({ message: 'The MCP endpoint storage operation failed.' }) })

const urlsOf = (webServer: WebServer) => {
  const port = webServer.port
  if (port === undefined) return { localUrl: null, lanUrl: null }
  if (isLoopbackAddress(webServer.host)) return { localUrl: `${webServer.getOrigin()}${MCP_PATH}`, lanUrl: null }
  // A LAN bind keeps a localhost listener on the same port when @dshfiles/loopback-access runs.
  return { localUrl: `${webServer.protocol}//127.0.0.1:${port}${MCP_PATH}`, lanUrl: `${webServer.getOrigin()}${MCP_PATH}` }
}

const statusOf = (store: EndpointStore, webServer: WebServer) =>
  Effect.gen(function* () {
    const lanEnabled = yield* storageOperation(() => store.lanEnabled())
    const token = yield* storageOperation(() => store.tokenInfo())
    return { path: MCP_PATH, ...urlsOf(webServer), lanEnabled, token }
  })

const { hostApi, ...effectPlugin } = endpointPlugin

const endpointHost = hostApi(mcpEndpointApi, {
  status: Effect.fn('mcp endpoint status read')(({ ctx }) =>
    Effect.gen(function* () {
      const runtime = yield* EndpointRuntime
      return yield* statusOf(runtime.store, ctx.webServer)
    }),
  ),
  rotateToken: Effect.fn('mcp endpoint token rotate')(({ ctx }) =>
    Effect.gen(function* () {
      const runtime = yield* EndpointRuntime
      const token = yield* storageOperation(() => runtime.store.rotate())
      return { token, status: yield* statusOf(runtime.store, ctx.webServer) }
    }),
  ),
  revokeToken: Effect.fn('mcp endpoint token revoke')(({ ctx }) =>
    Effect.gen(function* () {
      const runtime = yield* EndpointRuntime
      yield* storageOperation(() => runtime.store.revoke())
      return yield* statusOf(runtime.store, ctx.webServer)
    }),
  ),
  setLanAccess: Effect.fn('mcp endpoint LAN access set')(({ ctx, input }) =>
    Effect.gen(function* () {
      const runtime = yield* EndpointRuntime
      yield* storageOperation(() => runtime.store.setLanEnabled(input.enabled))
      return yield* statusOf(runtime.store, ctx.webServer)
    }),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: 'dshfiles-mcp-endpoint',
  inject: ['webServer', 'workspaceRegistry'],
  apis: [endpointHost],
})
