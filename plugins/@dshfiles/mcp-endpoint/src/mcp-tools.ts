import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { Api } from '@dshfiles/dshx/effect'
import type { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { Context, Effect, Schema } from 'effect'

export interface ProjectRow {
  readonly projectId: string
  readonly title: string
  readonly path: string
}

/** The sessions API of `@dshfiles/session-controller`, called as this plugin. */
export class McpSessions extends Context.Service<McpSessions, Api.TypedApiClient<(typeof sessionsApi)['methods']>>()('@dshfiles/mcp-endpoint/McpSessions') {}

/** The registered DSH projects an outside agent may start threads in. */
export class McpProjects extends Context.Service<McpProjects, { readonly list: Effect.Effect<ReadonlyArray<ProjectRow>> }>()(
  '@dshfiles/mcp-endpoint/McpProjects',
) {}

/** A bounded, non-empty string: the shape every MCP argument repeats. */
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

const sessionId = text(256).annotate({ description: 'Thread id (a DSH Session id, e.g. from list_threads).' })

const textResult = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] })

export const failureResult = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }], isError: true })

/** A refused call reaches the outside agent as a tool error with DSH's own message and code, never a stack. */
const failureText = (error: Api.ApiCallFailure): string => (error._tag === 'ApiRemoteError' ? `${error.code}: ${error.message}` : error.message)

/** The JSON Schema MCP publishes for a tool's arguments, validated from the document Effect emits. */
const toolInputDocument = Schema.Struct({
  type: Schema.Literal('object'),
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
})
const decodeToolInputDocument = Schema.decodeUnknownSync(toolInputDocument)

/** The Effect schema is the source of truth: MCP publishes its JSON Schema, so a client sees the same constraints. */
const inputSchemaOf = (schema: Schema.ConstraintDecoder<unknown>) => {
  const document = decodeToolInputDocument(Schema.toJsonSchemaDocument(schema).schema)
  const entries = Object.entries(document.properties ?? {})
  const properties = Object.fromEntries(entries.filter(([, property]) => typeof property === 'object' && property !== null))
  if (document.required === undefined) return { type: 'object', properties }
  return { type: 'object', properties, required: [...document.required] }
}

type McpServices = McpSessions | McpProjects

export interface McpTool {
  readonly name: string
  readonly description: string
  readonly annotations?: ToolAnnotations
  readonly schema: Schema.ConstraintDecoder<unknown>
  // oxlint-disable-next-line antislop/no-unknown-parameters -- a tool call arrives as an untyped JSON object from the MCP client; `call` decodes it with the tool's own schema before the handler runs
  readonly call: (rawArguments: unknown) => Effect.Effect<CallToolResult, never, McpServices>
}

const defineTool = <Args, Output>(options: {
  readonly name: string
  readonly description: string
  readonly annotations?: ToolAnnotations
  readonly input: Schema.Decoder<Args>
  readonly handle: (args: Args) => Effect.Effect<Output, Api.ApiCallFailure, McpServices>
}): McpTool => {
  const decode = Schema.decodeUnknownEffect(options.input)
  const tool: McpTool = {
    name: options.name,
    description: options.description,
    schema: options.input,
    call: rawArguments =>
      decode(rawArguments ?? {}).pipe(
        Effect.matchEffect({
          onFailure: issue => Effect.succeed(failureResult(`Invalid arguments: ${issue.message}`)),
          onSuccess: args =>
            options.handle(args).pipe(
              Effect.match({
                onFailure: failure => failureResult(failureText(failure)),
                onSuccess: value => textResult(JSON.stringify(value, null, 2)),
              }),
              Effect.withSpan(options.name),
            ),
        }),
      ),
  }
  return options.annotations === undefined ? tool : { ...tool, annotations: options.annotations }
}

export const describeTool = (tool: McpTool) => {
  const described = { name: tool.name, description: tool.description, inputSchema: inputSchemaOf(tool.schema) }
  return tool.annotations === undefined ? described : { ...described, annotations: tool.annotations }
}

/** Every tool the MCP endpoint serves: each is a sessions API call made as this plugin. */
export const mcpTools: ReadonlyArray<McpTool> = [
  defineTool({
    name: 'list_projects',
    description: 'List DSH projects (registered folders) with their id, title and path. Use a projectId with create_thread.',
    annotations: { readOnlyHint: true },
    input: Schema.Record(Schema.String, Schema.Never),
    handle: () => McpProjects.use(projects => Effect.map(projects.list, list => ({ projects: list }))),
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
    handle: args => McpSessions.use(sessions => sessions.list(args)),
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
    handle: args => McpSessions.use(sessions => sessions.messages(args)),
  }),
  defineTool({
    name: 'create_thread',
    description: 'Start a DSH thread in a project (projectId) or a directory (cwd), optionally with a title, a model and a first prompt that starts its turn.',
    input: Schema.Struct({
      projectId: Schema.optionalKey(text(256)),
      cwd: Schema.optionalKey(text(4096).annotate({ description: 'Absolute directory; give either projectId or cwd.' })),
      prompt: Schema.optionalKey(text(100_000)),
      title: Schema.optionalKey(text(200)),
      agentPreset: Schema.optionalKey(text(200)),
      model: Schema.optionalKey(Schema.Struct({ provider: text(200), model: text(400), reasoningEffort: Schema.optionalKey(text(64)) })),
    }),
    handle: args => McpSessions.use(sessions => sessions.create(args)),
  }),
  defineTool({
    name: 'send_message',
    description: 'Send a user message to a thread: queue (default) runs it as the next turn, steer folds it into the running turn.',
    input: Schema.Struct({ sessionId, text: text(100_000), mode: Schema.optionalKey(Schema.Literals(['queue', 'steer'])) }),
    handle: args => McpSessions.use(sessions => sessions.prompt(args)),
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
    handle: args => McpSessions.use(sessions => sessions.wait(args)),
  }),
  defineTool({
    name: 'stop_turn',
    description: "Stop the thread's running turn; queued messages stay queued.",
    annotations: { destructiveHint: true },
    input: Schema.Struct({ sessionId }),
    handle: args => McpSessions.use(sessions => sessions.interrupt(args)),
  }),
]
