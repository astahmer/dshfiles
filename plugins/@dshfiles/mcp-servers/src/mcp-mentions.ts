import type { ClientSessionContext, InputTriggerCandidate, InputTriggerSource } from '@dshfiles/input-trigger/client'
import type { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RegistryListing } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { jsonTextSchema } from './json-text.js'

const registryMcpToolSchema = z.object({
  name: z.string().min(1).max(256),
  source: z.literal('mcp'),
  description: z.string().max(16_384),
})
const registryToolRowSchema = z.union([registryMcpToolSchema, z.undefined()]).catch(undefined)
const registryListingSchema = z.object({ tools: z.array(registryToolRowSchema).max(2_000) })

const mentionValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('server'), displayName: z.string().min(1).max(120), serverName: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/u) }).strict(),
  z.object({ kind: z.literal('tool'), name: z.string().min(1).max(256) }).strict(),
])

type MentionServer = {
  readonly name: string
  readonly serverName: string
}

type MentionTool = {
  readonly name: string
  readonly description: string
}
type MentionServerSearchRow = {
  readonly displayName: string
  readonly serverName: string
  readonly name: string
}

type MentionValue = z.infer<typeof mentionValueSchema>
type MentionCatalog = {
  readonly servers: readonly MentionServer[]
  readonly tools: readonly MentionTool[]
}
type MentionCatalogEntry = {
  readonly abort: AbortController
  readonly promise: Promise<MentionCatalog>
  expiresAt: number
}
type MentionSourceOptions = {
  readonly list: (sessionId: ClientSessionContext['sessionId'], signal: AbortSignal) => Promise<MentionCatalog>
  readonly rank: typeof rankByName
  readonly serverSection: string
  readonly toolSection: string
  readonly serverInstruction: string
  readonly toolInstruction: string
  readonly useWhenRelevant: string
}

const CATALOG_TTL_MS = 1_000
const MAX_SERVER_CANDIDATES = 40
const MAX_TOOL_CANDIDATES = 80

const mentionValueTextSchema = jsonTextSchema('An MCP mention value is JSON text.').pipe(mentionValueSchema)

const decodeMentionValue = (value: unknown): MentionValue | null => {
  const parsed = mentionValueTextSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const mentionClipboardText = (value: MentionValue): string => (value.kind === 'server' ? `MCP server: ${value.serverName}` : `MCP tool: ${value.name}`)

// The @ scopes shared with @dshfiles/mentions: `@t:`/`@thread:`, `@f:`/`@file:`, `@skill:` and `@mcp:`.
const MENTION_SCOPE = /^(thread|t|file|f|skill|mcp):/iu

/** The query this source ranks: the text after its own scope prefix, or undefined while another scope is typed. */
export class McpMentionModel {
  static readonly scopedQuery = ({ query, ownScope }: { readonly query: string; readonly ownScope: 'skill' | 'mcp' }): string | undefined => {
    const scope = MENTION_SCOPE.exec(query)?.[1]
    if (scope === undefined) return query
    return scope.toLowerCase() === ownScope ? query.slice(scope.length + 1) : undefined
  }

  static readonly decodeTools = (listing: RegistryListing): readonly MentionTool[] => {
    const parsedListing = registryListingSchema.safeParse(listing)
    if (!parsedListing.success) return []
    return parsedListing.data.tools.flatMap(tool => (tool === undefined ? [] : [{ name: tool.name, description: tool.description.slice(0, 1_024) }]))
  }

  static readonly candidates = (input: {
    readonly rankedServers: readonly MentionServerSearchRow[]
    readonly rankedTools: readonly MentionTool[]
    readonly serverSection: string
    readonly toolSection: string
  }): readonly InputTriggerCandidate[] => {
    return [
      ...input.rankedServers.slice(0, MAX_SERVER_CANDIDATES).map(server => ({
        name: server.serverName,
        label: server.displayName,
        description: server.serverName,
        section: input.serverSection,
        value: JSON.stringify({ kind: 'server', displayName: server.displayName, serverName: server.serverName }),
      })),
      ...input.rankedTools.slice(0, MAX_TOOL_CANDIDATES).map(tool => ({
        name: tool.name,
        description: tool.description.slice(0, 240),
        section: input.toolSection,
        value: JSON.stringify({ kind: 'tool', name: tool.name }),
      })),
    ]
  }

  static readonly pick = (
    candidate: Pick<InputTriggerCandidate, 'name' | 'label' | 'value'>,
  ):
    | {
        readonly insert: {
          readonly source: string
          readonly ref: string
          readonly label: string
          readonly clipboardText: string
        }
      }
    | undefined => {
    const value = decodeMentionValue(candidate.value)
    if (value === null) return undefined
    const ref = JSON.stringify(value)
    return {
      insert: {
        source: 'mcp-servers',
        ref,
        label: candidate.label ?? candidate.name,
        clipboardText: mentionClipboardText(value),
      },
    }
  }

  static readonly serialize = async (input: {
    readonly ref: string
    readonly signal: AbortSignal
    readonly serverInstruction: string
    readonly toolInstruction: string
    readonly useWhenRelevant: string
  }): Promise<string> => {
    input.signal.throwIfAborted()
    const value = decodeMentionValue(input.ref)
    if (value === null) throw new Error('MCP autocomplete reference is invalid.')
    const instruction = value.kind === 'server' ? input.serverInstruction : input.toolInstruction
    const name = value.kind === 'server' ? value.serverName : value.name
    return `${instruction} ${JSON.stringify(name)}. ${input.useWhenRelevant}`
  }
}

export const createMcpMentionSource = (options: MentionSourceOptions) => {
  const catalogs = new Map<ClientSessionContext['sessionId'], MentionCatalogEntry>()
  const fetchCatalog = (sessionId: ClientSessionContext['sessionId']): MentionCatalogEntry => {
    const existing = catalogs.get(sessionId)
    if (existing !== undefined && existing.expiresAt > Date.now()) return existing
    existing?.abort.abort()

    const abort = new AbortController()
    const entry: MentionCatalogEntry = {
      abort,
      promise: options.list(sessionId, abort.signal),
      expiresAt: Number.POSITIVE_INFINITY,
    }
    catalogs.set(sessionId, entry)
    entry.promise.then(
      () => {
        entry.expiresAt = Date.now() + CATALOG_TTL_MS
      },
      () => {
        if (catalogs.get(sessionId) === entry) catalogs.delete(sessionId)
      },
    )
    return entry
  }
  const clear = (): void => {
    for (const [sessionId, entry] of catalogs) {
      catalogs.delete(sessionId)
      entry.abort.abort()
    }
  }
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'mcp-servers',
    order: 20,
    showGroupTitle: false,
    async candidates(session, request) {
      const query = McpMentionModel.scopedQuery({ query: request.query, ownScope: 'mcp' })
      if (query === undefined || request.quoted === true) return []
      try {
        const catalog = await fetchCatalog(session.sessionId).promise
        if (request.signal.aborted) return []
        const serverSearchRows = catalog.servers.map(server => ({
          displayName: server.name,
          serverName: server.serverName,
          name: `${server.serverName} ${server.name}`,
        }))
        const rankedTools = options.rank(catalog.tools, query)
        const candidates = McpMentionModel.candidates({
          rankedServers: options.rank(serverSearchRows, query),
          rankedTools,
          serverSection: options.serverSection,
          toolSection: options.toolSection,
        })
        return candidates
      } catch {
        return []
      }
    },
    warm(session) {
      fetchCatalog(session.sessionId).promise.catch(() => undefined)
    },
    onPick({ candidate }) {
      return McpMentionModel.pick(candidate)
    },
    codec: {
      clipboardText(ref) {
        const value = decodeMentionValue(ref)
        return value === null ? 'MCP reference' : mentionClipboardText(value)
      },
      serialize(ref, signal) {
        return McpMentionModel.serialize({
          ref,
          signal,
          serverInstruction: options.serverInstruction,
          toolInstruction: options.toolInstruction,
          useWhenRelevant: options.useWhenRelevant,
        })
      },
    },
  }

  return { source, clear }
}
