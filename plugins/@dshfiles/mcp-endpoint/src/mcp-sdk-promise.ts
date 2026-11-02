import type { IncomingMessage, ServerResponse } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { Context, Effect, Layer, Schema, Tracer } from 'effect'
import { describeTool, failureResult, mcpTools, type McpProjects, type McpSessions } from './mcp-tools.js'

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
      // Each tool call is its own unit of work: it must not inherit the plugin activation span as its parent.
      const runTool = Effect.runPromiseWith(Context.omit(Tracer.ParentSpan)(yield* Effect.context<McpSessions | McpProjects>()))
      const createServer = (version: string) => {
        const server = new Server({ name: 'dsh', version }, { capabilities: { tools: {} } })
        server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools.map(describeTool) }))
        server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
          const tool = mcpTools.find(candidate => candidate.name === request.params.name)
          if (tool === undefined) return failureResult(`No MCP tool is named ${request.params.name}. List the tools again to read the available names.`)
          return runTool(tool.call(request.params.arguments), { signal: extra.signal })
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
