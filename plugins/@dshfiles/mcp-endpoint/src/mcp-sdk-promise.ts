import type { IncomingMessage, ServerResponse } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { defineApi, dshxRegistryApi, isApiError, method } from '@dshfiles/dshx/api'
import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { createHostApiClient, pluginToolCatalog } from '@dshfiles/dshx/host'
import { EndpointTokens } from './endpoint-tokens.js'
import { Context, Effect, Layer, Schema } from 'effect'
import { describedMcpTools, failureResult, mcpTools, type McpProjects, type McpSessions } from './mcp-tools.js'

/** The MCP SDK failed to connect or serve one request after it was admitted. */
export class McpTransportFailed extends Schema.TaggedError<McpTransportFailed>()('McpTransportFailed', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'The MCP transport failed to serve the request.'
  }
}

/**
 * The Promise edge of the MCP SDK: one server and transport per request (stateless, no session id), whose tool
 * handlers run the Effect tools in the services captured when the plugin activated, with the request's abort as
 * fiber interruption.
 */
export class McpServers extends Context.Service<
  McpServers,
  {
    readonly serve: (input: {
      readonly request: IncomingMessage
      readonly response: ServerResponse
      readonly body: unknown
      readonly version: string
    }) => Effect.Effect<void, McpTransportFailed>
  }
>()('@dshfiles/mcp-endpoint/McpServers') {
  static readonly layer = Layer.effect(
    McpServers,
    Effect.gen(function* () {
      const runTool = Effect.runPromiseWith(yield* DshxPlugin.detachedContext<McpSessions | McpProjects | EndpointTokens>())
      const host = yield* HostContext
      const caller = '@dshfiles/mcp-endpoint'
      const registry = createHostApiClient(host.ctx, dshxRegistryApi, caller)
      const catalog = async (name?: string) => {
        const listing = await registry.list({})
        const eligible = pluginToolCatalog({ listing }).filter(
          entry =>
            entry.owner !== caller &&
            entry.owner !== '@dshfiles/dshx' &&
            !mcpTools.some(tool => tool.name === entry.name) &&
            (name === undefined || entry.name === name),
        )
        const owners = [...new Set(eligible.map(entry => entry.owner))]
        const scoped = await Promise.all(owners.map(owner => registry.list({ owner, schemas: true })))
        const names = new Set(eligible.map(entry => `${entry.owner}\0${entry.apiId}\0${entry.method}`))
        return scoped.flatMap(value => pluginToolCatalog({ listing: value })).filter(entry => names.has(`${entry.owner}\0${entry.apiId}\0${entry.method}`))
      }
      const createServer = (version: string) => {
        const server = new Server({ name: 'dsh', version }, { capabilities: { tools: {} } })
        server.setRequestHandler(ListToolsRequestSchema, async () => {
          const mode = await runTool(EndpointTokens.use(tokens => tokens.pluginTools))
          if (mode === 'off') return { tools: describedMcpTools }
          const entries = await catalog()
          return {
            tools: [
              ...describedMcpTools,
              ...entries
                .filter(entry => entry.readOnly || mode === 'read-write')
                .map(entry => ({
                  name: entry.name,
                  description: entry.description,
                  inputSchema: entry.inputSchema,
                  annotations: { readOnlyHint: entry.readOnly },
                })),
            ],
          }
        })
        server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
          const tool = mcpTools.find(candidate => candidate.name === request.params.name)
          if (tool !== undefined) return runTool(tool.call(request.params.arguments), { signal: extra.signal })
          const mode = await runTool(EndpointTokens.use(tokens => tokens.pluginTools))
          if (mode === 'off') return failureResult('Plugin tools are off. Open Settings › MCP endpoint › plugin tools to enable them.')
          const entry = (await catalog(request.params.name)).find(candidate => candidate.name === request.params.name)
          if (entry === undefined) return failureResult(`No MCP tool is named ${request.params.name}. List the tools again to read the available names.`)
          if (!entry.readOnly && mode !== 'read-write')
            return failureResult('Plugin writes are disabled. Open Settings › MCP endpoint › plugin tools and choose read-write.')
          const contract = defineApi({ owner: entry.owner, id: entry.apiId, version: entry.version, methods: { [entry.method]: method<unknown>() } })
          const invoke = createHostApiClient(host.ctx, contract, caller)[entry.method]
          if (invoke === undefined) return failureResult('The plugin tool is unavailable. List the tools again and retry.')
          try {
            const result = await invoke(entry.takesInput ? (request.params.arguments ?? {}) : undefined, { signal: extra.signal })
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
          } catch (error) {
            return failureResult(
              isApiError(error) ? `${error.remoteCode ?? error.kind}: ${error.message}` : 'The plugin tool failed. List the tools again and retry.',
            )
          }
        })
        return server
      }
      return McpServers.of({
        serve: input =>
          Effect.tryPromise({
            try: async () => {
              const server = createServer(input.version)
              const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
              input.response.on('close', () => {
                void transport.close()
                void server.close()
              })
              await server.connect(transport)
              await transport.handleRequest(input.request, input.response, input.body)
            },
            catch: cause => new McpTransportFailed({ cause }),
          }),
      })
    }),
  )
}
