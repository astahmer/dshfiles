import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { Effect, Schema } from 'effect'
import type { SessionsClient } from './sessions-client.js'

export interface ProjectRow {
  readonly projectId: string
  readonly title: string
  readonly path: string
}

/** A bounded, non-empty string: the shape every MCP argument repeats. */
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

const sessionId = text(256).annotate({ description: 'Thread id (a DSH Session id, e.g. from list_threads).' })

const apiErrorSchema = Schema.Struct({ message: Schema.String, remoteCode: Schema.optionalKey(Schema.String) })

const textResult = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] })

const failureResult = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }], isError: true })

class McpToolCallFailure extends Schema.TaggedError<McpToolCallFailure>()('McpToolCallFailure', {
  message: Schema.String,
}) {}

/** A refused call reaches the outside agent as a tool error with DSH's own message and code, never a stack. */
const failureText = (error: unknown) => {
  const refusal = Schema.decodeUnknownResult(apiErrorSchema)(error)
  if (refusal._tag === 'Failure') return 'The DSH call failed.'
  const code = refusal.success.remoteCode
  return `${code === undefined ? '' : `${code}: `}${refusal.success.message}`
}

const run = <Value>(name: string, call: () => Promise<Value>): Promise<CallToolResult> =>
  Effect.runPromise(
    Effect.fn(name)(() =>
      Effect.tryPromise({ try: call, catch: error => new McpToolCallFailure({ message: failureText(error) }) }).pipe(
        Effect.match({
          onFailure: failure => failureResult(failure.message),
          onSuccess: value => textResult(JSON.stringify(value, null, 2)),
        }),
      ),
    )(),
  )

/** The JSON Schema MCP publishes for a tool's arguments, validated from the document Effect emits. */
const toolInputDocument = Schema.Struct({
  type: Schema.Literal('object'),
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
})

/** The Effect schema is the source of truth: MCP publishes its JSON Schema, so a client sees the same constraints. */
const inputSchemaOf = (schema: Schema.ConstraintDecoder<unknown>) => {
  const document = Schema.decodeUnknownSync(toolInputDocument)(Schema.toJsonSchemaDocument(schema).schema)
  const entries = Object.entries(document.properties ?? {})
  const properties = Object.fromEntries(entries.filter(([, property]) => typeof property === 'object' && property !== null))
  if (document.required === undefined) return { type: 'object', properties }
  return { type: 'object', properties, required: [...document.required] }
}

interface McpTool {
  readonly name: string
  readonly description: string
  readonly annotations?: ToolAnnotations
  readonly schema: Schema.ConstraintDecoder<unknown>
  // oxlint-disable-next-line antislop/no-unknown-parameters -- a tool call arrives as an untyped JSON object from the MCP client; `call` decodes it with the tool's own schema before the handler runs
  readonly call: (rawArguments: unknown, signal: AbortSignal) => Promise<CallToolResult>
}

const defineTool = <Args>(options: {
  readonly name: string
  readonly description: string
  readonly annotations?: ToolAnnotations
  readonly input: Schema.ConstraintDecoder<Args>
  // oxlint-disable-next-line antislop/no-unknown-returns -- each handler returns a domain value that `run` serializes for the MCP client
  readonly handle: (args: Args, signal: AbortSignal) => Promise<unknown>
}): McpTool => {
  const tool: McpTool = {
    name: options.name,
    description: options.description,
    schema: options.input,
    call: async (rawArguments, signal) => {
      const decoded = Schema.decodeUnknownResult(options.input)(rawArguments ?? {})
      if (decoded._tag === 'Failure') return failureResult(`Invalid arguments: ${decoded.failure.message}`)
      return run(options.name, () => options.handle(decoded.success, signal))
    },
  }
  return options.annotations === undefined ? tool : { ...tool, annotations: options.annotations }
}

const describeTool = (tool: McpTool) => {
  const described = { name: tool.name, description: tool.description, inputSchema: inputSchemaOf(tool.schema) }
  return tool.annotations === undefined ? described : { ...described, annotations: tool.annotations }
}

/** One MCP server per request (stateless transport): every tool is a sessions API call made as this plugin. */
export const createMcpServer = (input: { readonly sessions: SessionsClient; readonly projects: () => readonly ProjectRow[]; readonly version: string }) => {
  const sessions = input.sessions
  const tools: readonly McpTool[] = [
    defineTool({
      name: 'list_projects',
      description: 'List DSH projects (registered folders) with their id, title and path. Use a projectId with create_thread.',
      annotations: { readOnlyHint: true },
      input: Schema.Record(Schema.String, Schema.Never),
      handle: async () => ({ projects: input.projects() }),
    }),
    defineTool({
      name: 'list_threads',
      description: 'List DSH threads newest first: id, title, directory, project and whether a turn is running.',
      annotations: { readOnlyHint: true },
      input: Schema.Struct({
        query: Schema.optionalKey(text(200).annotate({ description: 'Match title, directory or project title.' })),
        projectId: Schema.optionalKey(text(256)),
        includeArchived: Schema.optionalKey(Schema.Boolean),
        limit: Schema.optionalKey(
          Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)).annotate({ description: 'Default 50.' }),
        ),
      }),
      handle: async args => sessions.list(args),
    }),
    defineTool({
      name: 'read_thread',
      description: "Read a thread's most recent user and assistant messages, oldest first, and whether a turn is running.",
      annotations: { readOnlyHint: true },
      input: Schema.Struct({
        sessionId,
        limit: Schema.optionalKey(
          Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)).annotate({ description: 'Default 20.' }),
        ),
      }),
      handle: async args => sessions.messages(args),
    }),
    defineTool({
      name: 'create_thread',
      description:
        'Start a DSH thread in a project (projectId) or a directory (cwd), optionally with a title, a model and a first prompt that starts its turn.',
      input: Schema.Struct({
        projectId: Schema.optionalKey(text(256)),
        cwd: Schema.optionalKey(text(4096).annotate({ description: 'Absolute directory; give either projectId or cwd.' })),
        prompt: Schema.optionalKey(text(100_000)),
        title: Schema.optionalKey(text(200)),
        agentPreset: Schema.optionalKey(text(200)),
        model: Schema.optionalKey(Schema.Struct({ provider: text(200), model: text(400), reasoningEffort: Schema.optionalKey(text(64)) })),
      }),
      handle: async args => sessions.create(args),
    }),
    defineTool({
      name: 'send_message',
      description: 'Send a user message to a thread: queue (default) runs it as the next turn, steer folds it into the running turn.',
      input: Schema.Struct({ sessionId, text: text(100_000), mode: Schema.optionalKey(Schema.Literals(['queue', 'steer'])) }),
      handle: async args => sessions.prompt(args),
    }),
    defineTool({
      name: 'wait_for_turn',
      description: 'Wait until the thread is idle with nothing queued, or until timeoutMs passes; returns idle or running.',
      annotations: { readOnlyHint: true },
      input: Schema.Struct({
        sessionId,
        timeoutMs: Schema.optionalKey(
          Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(300_000)).annotate({
            description: 'Default 60000, at most 300000.',
          }),
        ),
      }),
      handle: async (args, signal) => sessions.wait(args, { signal }),
    }),
    defineTool({
      name: 'stop_turn',
      description: "Stop the thread's running turn; queued messages stay queued.",
      annotations: { destructiveHint: true },
      input: Schema.Struct({ sessionId }),
      handle: async args => sessions.interrupt(args),
    }),
  ]
  const server = new Server({ name: 'dsh', version: input.version }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(describeTool) }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find(candidate => candidate.name === request.params.name)
    if (tool === undefined) return failureResult(`No MCP tool is named ${request.params.name}. List the tools again to read the available names.`)
    return tool.call(request.params.arguments, extra.signal)
  })
  return server
}
