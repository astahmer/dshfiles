import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Effect, Schema } from 'effect'
import type { SessionsClient } from './sessions-client.js'
import { z } from 'zod'

export interface ProjectRow {
  readonly projectId: string
  readonly title: string
  readonly path: string
}

const sessionId = z.string().min(1).max(256).describe('Thread id (a DSH Session id, e.g. from list_threads).')

const apiErrorSchema = z.object({ message: z.string(), remoteCode: z.string().optional() })

const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }] })

class McpToolCallFailure extends Schema.TaggedError<McpToolCallFailure>()('McpToolCallFailure', {
  message: Schema.String,
}) {}

const failureText = (error: unknown) => {
  const refusal = apiErrorSchema.safeParse(error).data
  return refusal === undefined ? 'The DSH call failed.' : `${refusal.remoteCode === undefined ? '' : `${refusal.remoteCode}: `}${refusal.message}`
}

/** A refused call reaches the outside agent as a tool error with DSH's own message and code, never a stack. */
const run = <Value>(name: string, call: () => Promise<Value>) =>
  Effect.runPromise(
    Effect.fn(name)(() =>
      Effect.tryPromise({ try: call, catch: error => new McpToolCallFailure({ message: failureText(error) }) }).pipe(
        Effect.match({
          onFailure: failure => ({ isError: true, ...textResult(failure.message) }),
          onSuccess: value => textResult(JSON.stringify(value, null, 2)),
        }),
      ),
    )(),
  )

/** One MCP server per request (stateless transport): every tool is a sessions API call made as this plugin. */
export const createMcpServer = (input: { readonly sessions: SessionsClient; readonly projects: () => readonly ProjectRow[]; readonly version: string }) => {
  const { sessions } = input
  const server = new McpServer({ name: 'dsh', version: input.version })
  server.registerTool(
    'list_projects',
    {
      description: 'List DSH projects (registered folders) with their id, title and path. Use a projectId with create_thread.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run('mcp projects list', async () => ({ projects: input.projects() })),
  )
  server.registerTool(
    'list_threads',
    {
      description: 'List DSH threads newest first: id, title, directory, project and whether a turn is running.',
      inputSchema: {
        query: z.string().max(200).optional().describe('Match title, directory or project title.'),
        projectId: z.string().min(1).max(256).optional(),
        includeArchived: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
      },
      annotations: { readOnlyHint: true },
    },
    args => run('mcp threads list', () => sessions.list(args)),
  )
  server.registerTool(
    'read_thread',
    {
      description: "Read a thread's most recent user and assistant messages, oldest first, and whether a turn is running.",
      inputSchema: { sessionId, limit: z.number().int().min(1).max(100).optional().describe('Default 20.') },
      annotations: { readOnlyHint: true },
    },
    args => run('mcp thread read', () => sessions.messages(args)),
  )
  server.registerTool(
    'create_thread',
    {
      description:
        'Start a DSH thread in a project (projectId) or a directory (cwd), optionally with a title, a model and a first prompt that starts its turn.',
      inputSchema: {
        projectId: z.string().min(1).max(256).optional(),
        cwd: z.string().min(1).max(4096).optional().describe('Absolute directory; give either projectId or cwd.'),
        prompt: z.string().min(1).max(100_000).optional(),
        title: z.string().min(1).max(200).optional(),
        agentPreset: z.string().min(1).max(200).optional(),
        model: z
          .object({ provider: z.string().min(1).max(200), model: z.string().min(1).max(400), reasoningEffort: z.string().min(1).max(64).optional() })
          .optional(),
      },
    },
    args => run('mcp thread create', () => sessions.create(args)),
  )
  server.registerTool(
    'send_message',
    {
      description: 'Send a user message to a thread: queue (default) runs it as the next turn, steer folds it into the running turn.',
      inputSchema: { sessionId, text: z.string().min(1).max(100_000), mode: z.enum(['queue', 'steer']).optional() },
    },
    args => run('mcp message send', () => sessions.prompt(args)),
  )
  server.registerTool(
    'wait_for_turn',
    {
      description: 'Wait until the thread is idle with nothing queued, or until timeoutMs passes; returns idle or running.',
      inputSchema: { sessionId, timeoutMs: z.number().int().min(0).max(300_000).optional().describe('Default 60000, at most 300000.') },
      annotations: { readOnlyHint: true },
    },
    (args, extra) => run('mcp turn wait', () => sessions.wait(args, { signal: extra.signal })),
  )
  server.registerTool(
    'stop_turn',
    {
      description: "Stop the thread's running turn; queued messages stay queued.",
      inputSchema: { sessionId },
      annotations: { destructiveHint: true },
    },
    args => run('mcp turn stop', () => sessions.interrupt(args)),
  )
  return server
}
