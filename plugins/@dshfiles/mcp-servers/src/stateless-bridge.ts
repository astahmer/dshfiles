import type { Context } from '@deepseek-ai/cordis'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { StatelessMcpModel, type Discovery, type JsonRecord } from './stateless-protocol.js'

/** One stateless request, run by the Host's `StatelessMcp` service; an abort interrupts it. */
export type StatelessCall = (
  options: { readonly signal: AbortSignal | undefined },
  method: string,
  params: JsonRecord,
  extraHeaders: Readonly<Record<string, string>>,
) => Promise<JsonRecord>

export interface StatelessBridgeConfig {
  readonly serverName: string
  readonly discovery: Discovery
  readonly call: StatelessCall
  readonly maxInstructionBytes?: number
}

const MAX_PUBLIC_NAME_LENGTH = 64
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g
const HASH_LENGTH = 12
const DEFAULT_MAX_INSTRUCTION_BYTES = 32_768
/** Bound pagination so a server cannot keep the list request looping. */
const MAX_LIST_PAGES = 32

/**
 * The native client's public-name contract (`@deepseek-ai/dsh-mcp-client` keeps it private): `mcp__<server>__<tool>`
 * verbatim when it already fits, else normalized and suffixed with a hash of the identity, so the manager's per-server
 * tool count and mentions stay identical whichever protocol era serves the server.
 */
export const publicToolName = (serverName: string, rawName: string): string => {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)

interface ListedTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly outputSchema: unknown
  readonly taskRequired: boolean
}

/** Every page of `tools/list`, bounded. */
const listTools = async (call: StatelessCall): Promise<ReadonlyArray<ListedTool>> => {
  const tools: Array<ListedTool> = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await call({ signal: undefined }, 'tools/list', cursor === undefined ? {} : { cursor }, {})
    const listed = Array.isArray(result['tools']) ? result['tools'] : []
    for (const tool of listed) {
      if (!isRecord(tool) || typeof tool['name'] !== 'string' || !isRecord(tool['inputSchema'])) continue
      const execution = tool['execution']
      tools.push({
        name: tool['name'],
        description: typeof tool['description'] === 'string' ? tool['description'] : '',
        inputSchema: { ...tool['inputSchema'] },
        outputSchema: tool['outputSchema'],
        taskRequired: isRecord(execution) && execution['taskSupport'] === 'required',
      })
    }
    cursor = typeof result['nextCursor'] === 'string' && result['nextCursor'].length > 0 ? result['nextCursor'] : undefined
    if (cursor === undefined) return tools
  }
  return tools
}

interface SystemPromptService {
  section(input: { readonly name: string; readonly order: number; readonly interpolate: boolean; readonly text: () => string }): unknown
  getSectionOrder(name: string): number
}

const isSystemPrompt = (value: unknown): value is SystemPromptService =>
  isRecord(value) && typeof value['section'] === 'function' && typeof value['getSectionOrder'] === 'function'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-stateless-client'
export const inject = ['tools']

/**
 * The stateless counterpart of the native `mcp-client` plugin for one server that speaks MCP `2026-07-28`: it lists the
 * tools once, registers them under the same public names, contributes the server instructions, and lets each call be
 * its own request. There is no connection to supervise; a refreshed credential re-attaches the plugin.
 */
export async function apply(ctx: Context, config: StatelessBridgeConfig): Promise<void> {
  const label = `mcp-stateless-client(${config.serverName})`
  const maxInstructionBytes = config.maxInstructionBytes ?? DEFAULT_MAX_INSTRUCTION_BYTES
  const serverText = config.discovery.instructions.trimEnd()
  const instructions = serverText ? `### MCP server: ${config.serverName}\n\n${serverText}` : ''
  if (Buffer.byteLength(instructions) > maxInstructionBytes) ctx.logger.warn(`${label}: server instructions exceed maxInstructionBytes (${maxInstructionBytes}); they are not shown to the model`)
  else if (instructions)
    ctx.inject(['systemPrompt'], inner => {
      const prompt: unknown = inner.get('systemPrompt')
      if (!isSystemPrompt(prompt)) return
      prompt.section({ name: `mcp:${config.serverName}`, order: prompt.getSectionOrder('MCP_SERVERS'), interpolate: false, text: () => instructions })
    })

  if (!isRecord(config.discovery.capabilities['tools'])) return

  let disposers: Array<() => void> = []
  let disposed = false
  ctx.effect(() => () => {
    disposed = true
    for (const dispose of disposers) dispose()
    disposers = []
  }, 'mcp-stateless-client.tools')

  const register = (tools: ReadonlyArray<ListedTool>) => {
    const seen = new Set<string>()
    const next: Array<() => void> = []
    try {
      for (const tool of tools) {
        const publicName = publicToolName(config.serverName, tool.name)
        if (seen.has(publicName)) throw new Error(`server listed tool "${tool.name}" more than once — invalid tool list`)
        seen.add(publicName)
        const headers = StatelessMcpModel.paramHeaders(tool.inputSchema)
        if (!headers.ok) {
          ctx.logger.warn(`${label}: tool "${tool.name}" skipped: ${headers.reason}`)
          continue
        }
        next.push(
          ctx.tools.register(
            createMcpToolDefinition(ctx, {
              name: publicName,
              rawName: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              outputSchema: tool.outputSchema,
              taskRequired: tool.taskRequired,
              call: (args, execution) =>
                config.call({ signal: execution.signal }, 'tools/call', { name: tool.name, arguments: args }, StatelessMcpModel.paramHeaderValues(headers.headers, args)),
            }),
          ),
        )
      }
    } catch (error) {
      for (const dispose of next) dispose()
      ctx.logger.error(`${label}: tool registration failed, no tools registered: ${String(error)}`)
      return
    }
    disposers = next
  }

  // A stateless server has nothing to reconnect; the Host retries `tools/list` itself with backoff.
  try {
    const tools = await listTools(config.call)
    if (!disposed) register(tools)
  } catch (error) {
    if (!disposed) ctx.logger.error(`${label}: tools/list failed, no tools registered; use Refresh or disconnect and reconnect the server to retry: ${String(error)}`)
  }
}
