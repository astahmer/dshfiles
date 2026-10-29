import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import { defineHost } from '@dshfiles/dshx/host'
import { mcpEndpointApi, type EndpointStatus } from './endpoint-api.js'
import { createEndpointStore, type EndpointStore } from './endpoint-store.js'
import { isLoopbackAddress } from './local-address.js'
import { createMcpRoute, MCP_PATH } from './mcp-route.js'
import { createSessionsClient } from './sessions-client.js'

const VERSION = '0.1.0'

const stores = new WeakMap<Context, EndpointStore>()

const storeOf = (ctx: Context): EndpointStore => {
  const existing = stores.get(ctx)
  if (existing !== undefined) return existing
  const store = createEndpointStore(ctx)
  stores.set(ctx, store)
  return store
}

const urlsOf = (webServer: WebServer) => {
  const port = webServer.port
  if (port === undefined) return { localUrl: null, lanUrl: null }
  if (isLoopbackAddress(webServer.host)) return { localUrl: `${webServer.getOrigin()}${MCP_PATH}`, lanUrl: null }
  // A LAN bind keeps a localhost listener on the same port when @dshfiles/loopback-access runs.
  return { localUrl: `${webServer.protocol}//127.0.0.1:${port}${MCP_PATH}`, lanUrl: `${webServer.getOrigin()}${MCP_PATH}` }
}

const statusOf = async (ctx: Context): Promise<EndpointStatus> => {
  const store = storeOf(ctx)
  return { path: MCP_PATH, ...urlsOf(ctx.webServer), lanEnabled: await store.lanEnabled(), token: await store.tokenInfo() }
}

const endpointHost = mcpEndpointApi.host({
  status: ({ ctx }) => statusOf(ctx),
  rotateToken: async ({ ctx }) => {
    const token = await storeOf(ctx).rotate()
    return { token, status: await statusOf(ctx) }
  },
  revokeToken: async ({ ctx }) => {
    await storeOf(ctx).revoke()
    return statusOf(ctx)
  },
  setLanAccess: async ({ ctx, input }) => {
    await storeOf(ctx).setLanEnabled(input.enabled)
    return statusOf(ctx)
  },
})

export default defineHost({
  name: 'dshfiles-mcp-endpoint',
  inject: ['webServer', 'workspaceRegistry'],
  apis: [endpointHost],
  setup: (ctx: Context) => {
    const route = createMcpRoute({
      store: storeOf(ctx),
      sessions: () => createSessionsClient(ctx),
      projects: () => ctx.workspaceRegistry.list().map(workspace => ({ projectId: workspace.id, title: workspace.title, path: workspace.path })),
      version: VERSION,
    })
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: MCP_PATH, handler: route }), 'mcp-endpoint: /mcp route')
  },
})
