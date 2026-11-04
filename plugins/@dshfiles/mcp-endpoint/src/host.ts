import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import { Api, DshxPlugin, HostContext, hostService } from '@dshfiles/dshx/effect'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { Context, Effect, Layer } from 'effect'
import { mcpEndpointApi } from './endpoint-api.js'
import { EndpointTokens } from './endpoint-tokens.js'
import { isLoopbackAddress } from './local-address.js'
import { handleMcpRequest, MCP_PATH } from './mcp-route.js'
import { McpServers } from './mcp-sdk-promise.js'
import { McpProjects, McpSessions } from './mcp-tools.js'

const PACKAGE_ID = '@dshfiles/mcp-endpoint'
const VERSION = '0.1.0'

const urlsOf = (webServer: WebServer) => {
  const port = webServer.port
  if (port === undefined) return { localUrl: null, lanUrl: null }
  if (isLoopbackAddress(webServer.host)) return { localUrl: `${webServer.getOrigin()}${MCP_PATH}`, lanUrl: null }
  // A LAN bind keeps a localhost listener on the same port when @dshfiles/loopback-access runs.
  return { localUrl: `${webServer.protocol}//127.0.0.1:${port}${MCP_PATH}`, lanUrl: `${webServer.getOrigin()}${MCP_PATH}` }
}

/** The Host's web server: where the endpoint is reachable, and the route registration for the plugin's Scope. */
class EndpointWeb extends Context.Service<EndpointWeb, { readonly server: WebServer }>()('@dshfiles/mcp-endpoint/EndpointWeb') {
  static readonly layer = Layer.effect(
    EndpointWeb,
    Effect.map(hostService('webServer'), server => EndpointWeb.of({ server })),
  )
}

const endpointStatus = Effect.fn('mcp endpoint status read')(function* () {
  const tokens = yield* EndpointTokens
  const web = yield* EndpointWeb
  const lanEnabled = yield* tokens.lanEnabled
  const token = yield* tokens.tokenInfo
  return { path: MCP_PATH, ...urlsOf(web.server), lanEnabled, token }
})

const McpSessionsLive = Layer.effect(
  McpSessions,
  Effect.gen(function* () {
    const host = yield* HostContext
    return Api.client({ contract: sessionsApi, api: createHostApiClient(host.ctx, sessionsApi, PACKAGE_ID) })
  }),
)

const McpProjectsLive = Layer.effect(
  McpProjects,
  Effect.map(hostService('workspaceRegistry'), registry =>
    McpProjects.of({
      list: Effect.sync(() => registry.list().map(workspace => ({ projectId: workspace.id, title: workspace.title, path: workspace.path }))),
    }),
  ),
)

/** Serve `/mcp` on the Host web server while the plugin is active; each request runs in the plugin's services. */
const McpRouteLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const web = yield* EndpointWeb
    const handler = yield* DshxPlugin.callback((request: IncomingMessage, response: ServerResponse) =>
      handleMcpRequest({ request, response, version: VERSION }),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() => web.server.register({ kind: 'exact', path: MCP_PATH, handler })),
      unregister => Effect.sync(unregister),
    )
  }),
)

const EndpointLive = McpRouteLive.pipe(
  Layer.provide(McpServers.layer),
  Layer.provide(Layer.mergeAll(McpSessionsLive, McpProjectsLive)),
  Layer.provideMerge(Layer.mergeAll(EndpointTokens.layer, EndpointWeb.layer)),
)

export default DshxPlugin.make({
  name: 'dshfiles-mcp-endpoint',
  inject: ['webServer', 'workspaceRegistry'],
  layer: EndpointLive,
  apis: [
    Api.bind(mcpEndpointApi, {
      status: () => endpointStatus(),
      rotateToken: () =>
        Effect.gen(function* () {
          const token = yield* EndpointTokens.use(tokens => tokens.rotate)
          return { token, status: yield* endpointStatus() }
        }),
      revokeToken: () => EndpointTokens.use(tokens => tokens.revoke).pipe(Effect.andThen(endpointStatus())),
      setLanAccess: input => EndpointTokens.use(tokens => tokens.setLanEnabled(input.enabled)).pipe(Effect.andThen(endpointStatus())),
    }),
  ],
})
