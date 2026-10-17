/** Node-only utilities using native Cordis and DSH registries, never a substitute plugin runtime. */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { CommandRuntime } from '@deepseek-ai/dsh-commands'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConnectionFetchHandler, ConnectionFetchRoute, HostConnectionHandle, PeerScope } from '@deepseek-ai/dsh-client-connection'
import { ApiProtocolModel } from '../api/common.js'
import { ApiDefinitionModel } from '../api/define.js'
import { createHostModule, createHostPlugin } from '../host/runtime.js'
import { createClientModule, createClientPlugin } from '../client/runtime.js'
import { createClientModuleLoader } from './client-module.js'

export interface MountedPlugin {
  readonly ctx: Context
  readonly fiber: Fiber
  dispose(): Promise<void>
  reload(): Promise<void>
}

export interface TestHost {
  readonly ctx: Context
  readonly connection: TestConnection
  readonly commands: Pick<CommandRuntime, 'find'> & {
    get(name: string): ReturnType<CommandRuntime['find']>
  }
  readonly tools: ToolRuntime
  mount(definition: unknown, options?: { readonly packageId?: string; readonly native?: boolean; readonly config?: unknown }): Promise<MountedPlugin>
  dispose(): Promise<void>
}

export interface TestConnection {
  readonly routeCount: number
  requestApi(request: {
    readonly packageId: string
    readonly apiId: string
    readonly method: string
    readonly version: number
    readonly input: unknown
  }): Promise<Response>
  dispose(): void
}

/** Provide the native Host Connection contract with an in-memory Fetch route carrier. */
export function provideTestConnection(ctx: Context): TestConnection {
  const routes = new Map<string, ConnectionFetchRoute>()
  const peer: PeerScope = {
    id: 'dshx-test' as PeerScope['id'],
    ctx,
    principal: { kind: 'owner' },
    signal: new AbortController().signal,
    interactions: 'answer',
    dispose: async () => undefined,
  }
  const notFound = (): Response => new Response('not found', { status: 404 })
  const handler: ConnectionFetchHandler = {
    requestBodyMode: request => routes.get(request.url.pathname)?.requestBody ?? 'buffered',
    fetch: async request => (await routes.get(new URL(request.url).pathname)?.fetch(request)) ?? notFound(),
  }
  const connection: HostConnectionHandle = {
    browserPeer: peer,
    allowsRemoteAuthorities: false,
    createPeer: options => ({ ...peer, principal: options.principal, interactions: options.interactions ?? 'answer' }),
    admitConnection: () => ({ peer, release: async () => undefined }),
    fetch: {
      register(route) {
        if (routes.has(route.path)) throw new Error(`Connection route already registered: ${route.path}`)
        routes.set(route.path, route)
        return async () => {
          routes.delete(route.path)
        }
      },
    },
    rpc: {
      handle: () => {
        throw new Error('The test Connection only supports exact Fetch routes.')
      },
      intercept: () => {
        throw new Error('The test Connection only supports exact Fetch routes.')
      },
    },
    createSharedFetchHandler: () => handler,
    requestRejection: () => undefined,
    admit: () => ({ peer }),
    authorizeIndex: () => true,
    authenticatedUrl: baseUrl => baseUrl,
  }
  const dispose = ctx.provide('connection', connection)
  return {
    /** Routes the mounted plugins registered, without the registry listing dshx serves on the first one's behalf. */
    get routeCount() {
      const registryPrefix = `/api${ApiProtocolModel.apiChannel(ApiDefinitionModel.registryOwner, ApiDefinitionModel.registryApi.id)}/`
      return [...routes.keys()].filter(path => !path.startsWith(registryPrefix)).length
    },
    requestApi: ({ packageId, apiId, method, version, input }) => {
      const endpoint = `${ApiProtocolModel.apiChannel(packageId, apiId).slice(1)}/${method}`
      const request = new Request(`http://dshx.test/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'dshx-test', method: endpoint, payload: { version, input } }),
      })
      return handler.fetch(request, peer)
    },
    dispose,
  }
}

function mounted(fiber: Fiber): MountedPlugin {
  if (fiber.state !== 2) throw new Error(`Plugin failed to activate (native fiber state ${fiber.state}). Check its required services and startup error.`)
  return {
    ctx: fiber.ctx,
    fiber,
    dispose: fiber.dispose,
    reload: () => fiber.restart(),
  }
}

/** Native commands, tools and prompts without model calls, a profile, or a DSH process. */
export async function createTestHost(): Promise<TestHost> {
  const ctx = new Context()
  const connection = provideTestConnection(ctx)
  const providers = [ctx.plugin(CommandRuntime), ctx.plugin(SystemPrompt), ctx.plugin(ToolRuntime)]
  await Promise.all(providers)
  const commands = ctx.commands
  const agent = { ctx } as Parameters<CommandRuntime['find']>[0]
  return {
    ctx,
    connection,
    tools: ctx.tools,
    commands: {
      find: (agent, name) => commands.find(agent, name),
      get: name => commands.find(agent, name),
    },
    async mount(definition, options = {}) {
      const metadata = { packageId: options.packageId ?? '@test/plugin' }
      const plugin = options.native ? createHostModule(definition as Record<string, unknown>, metadata) : createHostPlugin(definition, metadata)
      const fiber = ctx.plugin(plugin, options.config)
      await fiber
      return mounted(fiber)
    },
    dispose: async () => {
      connection.dispose()
      await ctx.fiber.dispose()
    },
  }
}

export interface TestClient {
  readonly ctx: Context
  /** The real renderer-owned registry, including declaration-collapse behavior. */
  readonly slots: SlotRegistry
  mount(definition: unknown, options?: { readonly packageId?: string; readonly native?: boolean }): Promise<MountedPlugin>
  dispose(): Promise<void>
}

/**
 * Native slots in Node, without React mounting. Declare test-owned root children
 * through client.slots.register before asserting contributions. For browser rendering,
 * use your normal React test library and the real application's standard props.
 */
export async function createTestClient(): Promise<TestClient> {
  const ctx = new Context()
  const load = createClientModuleLoader()
  const native = load('@deepseek-ai/dsh-client-ui-renderer/client') as typeof import('@deepseek-ai/dsh-client-ui-renderer/client')
  await ctx.plugin(native.SlotRegistry)
  return {
    ctx,
    slots: ctx.slots,
    async mount(definition, options = {}) {
      const metadata = { packageId: options.packageId ?? '@test/plugin' }
      const plugin = options.native ? createClientModule(definition as Record<string, unknown>, metadata) : createClientPlugin(definition, metadata)
      const fiber = ctx.plugin(plugin as Parameters<Context['plugin']>[0])
      await fiber
      return mounted(fiber)
    },
    dispose: () => ctx.fiber.dispose(),
  }
}

export async function mountPlugin(
  host: TestHost | TestClient,
  definition: unknown,
  options?: { readonly packageId?: string; readonly native?: boolean },
): Promise<MountedPlugin> {
  return host.mount(definition, options)
}
