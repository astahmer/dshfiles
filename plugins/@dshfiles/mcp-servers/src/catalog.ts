import * as Schema from 'effect/Schema'
import type { RegistryEntry } from './api.js'

const providers = [
  {
    id: 'figma',
    name: 'Figma',
    category: 'Design',
    description: 'Read design context and work with Figma files.',
    url: 'https://mcp.figma.com/mcp',
    auth: 'oauth',
    docsUrl: 'https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Developer tools',
    description: 'Work with repositories, issues, and pull requests.',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'token',
    docsUrl: 'https://github.com/github/github-mcp-server',
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'Project management',
    description: 'Search and manage issues, projects, and comments.',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    docsUrl: 'https://linear.app/docs/mcp',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'Knowledge',
    description: 'Search, read, and update your Notion workspace.',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    docsUrl: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'Developer tools',
    description: 'Manage Cloudflare services through its hosted MCP server.',
    url: 'https://mcp.cloudflare.com/mcp',
    auth: 'oauth',
    docsUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/',
  },
  {
    id: 'cloudflare-docs',
    name: 'Cloudflare Docs',
    category: 'Documentation',
    description: 'Search current Cloudflare developer documentation.',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    auth: 'none',
    docsUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'Monitoring',
    description: 'Investigate errors, performance, and projects in Sentry.',
    url: 'https://mcp.sentry.dev/mcp',
    auth: 'oauth',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'Deployment',
    description: 'Search Vercel docs and manage projects and deployments.',
    url: 'https://mcp.vercel.com',
    auth: 'oauth',
    docsUrl: 'https://vercel.com/docs/mcp',
  },
] as const satisfies readonly {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly description: string
  readonly url: string
  readonly auth: 'oauth' | 'none' | 'token'
  readonly docsUrl: string
}[]

const REGISTRY_ENDPOINT = 'https://registry.modelcontextprotocol.io/v0.1/servers'
const MAX_REGISTRY_BYTES = 1_000_000

const categoryValueSchema = Schema.Union([Schema.String, Schema.Array(Schema.String)])

const registryMetadataSchema = Schema.Struct({
  category: Schema.optional(categoryValueSchema),
  documentationUrl: Schema.optional(Schema.String),
})

const registryRemoteSchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  transport: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
})

/** A Registry row is lenient by design: a field this version does not model is ignored, never fatal. */
const registryServerSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(200)),
  title: Schema.optional(Schema.String),
  category: Schema.optional(categoryValueSchema),
  description: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  documentationUrl: Schema.optional(Schema.String),
  websiteUrl: Schema.optional(Schema.String),
  _meta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  remotes: Schema.optional(Schema.Array(Schema.Unknown)),
})

type RegistryServer = typeof registryServerSchema.Type
type RegistryMetadata = typeof registryMetadataSchema.Type
type RegistryRemote = typeof registryRemoteSchema.Type

const registryMetadataOf = (value: unknown): RegistryMetadata => {
  const parsed = Schema.decodeUnknownResult(registryMetadataSchema)(value)
  return parsed._tag === 'Success' ? parsed.success : {}
}

const registryRemoteOf = (value: unknown): RegistryRemote | undefined => {
  const parsed = Schema.decodeUnknownResult(registryRemoteSchema)(value)
  return parsed._tag === 'Success' ? parsed.success : undefined
}

const metadataOf = (item: RegistryServer): readonly RegistryMetadata[] => Object.values(item._meta ?? {}).map(registryMetadataOf)
const remotesOf = (item: RegistryServer): readonly RegistryRemote[] =>
  (item.remotes ?? []).flatMap(remote => {
    const parsed = registryRemoteOf(remote)
    return parsed === undefined ? [] : [parsed]
  })

const safeHttps = (value: string | undefined): string | null => {
  if (value === undefined || value.length > 2048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.search === '' && url.hash === '' ? url.href : null
  } catch {
    return null
  }
}

const categoryOf = (item: RegistryServer): string => {
  for (const metadata of metadataOf(item)) {
    const category = metadata.category
    if (category === undefined) continue
    if (typeof category === 'string') {
      if (category.trim().length > 0) return category.trim().slice(0, 80)
      continue
    }
    const first = category.find(value => value.trim().length > 0)
    if (first !== undefined) return first.trim().slice(0, 80)
  }
  return 'Uncategorized'
}

const documentationOf = (item: RegistryServer): string | null => {
  const direct = safeHttps(item.documentationUrl) ?? safeHttps(item.websiteUrl)
  if (direct !== null) return direct
  for (const metadata of metadataOf(item)) {
    const url = safeHttps(metadata.documentationUrl)
    if (url !== null) return url
  }
  return null
}

/** A Registry row arrives either wrapped in `{ server }` or bare; an unrecognized row is dropped, not fatal. */
const registryServerFromRow = (row: unknown): RegistryServer | undefined => {
  const wrapped = Schema.decodeUnknownResult(Schema.Struct({ server: registryServerSchema }))(row)
  if (wrapped._tag === 'Success') return wrapped.success.server
  const bare = Schema.decodeUnknownResult(registryServerSchema)(row)
  return bare._tag === 'Success' ? bare.success : undefined
}

const registryEntryFromRow = (row: unknown): RegistryEntry | undefined => {
  const item = registryServerFromRow(row)
  if (item === undefined) return undefined
  const endpoint = remotesOf(item).find(
    remote => (remote.type === 'streamable-http' || remote.transport === 'streamable-http') && safeHttps(remote.url) !== null,
  )
  return {
    name: item.name,
    title: (item.title ?? '').slice(0, 120),
    category: categoryOf(item),
    description: (item.description ?? '').slice(0, 500),
    version: (item.version ?? '').slice(0, 80),
    endpoint: endpoint === undefined ? null : safeHttps(endpoint.url),
    docsUrl: documentationOf(item),
  }
}

const registryPayloadSchema = Schema.Struct({ servers: Schema.optional(Schema.Array(Schema.Unknown)) })

const parseRegistryRows = (text: string): readonly RegistryEntry[] => {
  const parsed = Schema.decodeUnknownResult(registryPayloadSchema)(JSON.parse(text))
  if (parsed._tag === 'Failure') return []
  return (parsed.success.servers ?? []).flatMap(row => {
    const entry = registryEntryFromRow(row)
    return entry === undefined ? [] : [entry]
  })
}

const readBoundedJson = async (response: Response): Promise<readonly RegistryEntry[]> => {
  if (response.body === null) throw new Error('Registry response has no body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_REGISTRY_BYTES) {
        await reader.cancel()
        throw new Error('Registry response is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return parseRegistryRows(new TextDecoder().decode(bytes))
}

export type RegistrySearchFetcher = (input: URL, init: RequestInit) => Promise<Response>
export type RegistrySearchService = { readonly search: (input: { readonly query: string }) => Promise<RegistryEntry[]> }

export class McpCatalogModel {
  static readonly providers = providers

  /** Endpoint identity for duplicate detection: host plus path without a trailing slash. */
  static readonly endpointKey = (value: string): string => {
    try {
      const url = new URL(value)
      return `${url.host.toLocaleLowerCase()}${url.pathname.replace(/\/+$/, '')}`
    } catch {
      return value.trim().toLocaleLowerCase()
    }
  }

  static readonly filterProviders = <T extends { name: string; category: string; description: string }>({
    rows,
    query,
  }: {
    readonly rows: readonly T[]
    readonly query: string
  }): T[] => {
    const needle = query.trim().toLocaleLowerCase()
    return needle.length === 0 ? [...rows] : rows.filter(row => `${row.name} ${row.category} ${row.description}`.toLocaleLowerCase().includes(needle))
  }

  static readonly createRegistrySearchService = ({ fetch }: { readonly fetch: RegistrySearchFetcher }): RegistrySearchService => ({
    search: async ({ query }) => {
      const url = new URL(REGISTRY_ENDPOINT)
      url.searchParams.set('search', query)
      url.searchParams.set('version', 'latest')
      url.searchParams.set('limit', '20')
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
        redirect: 'error',
      })
      if (!response.ok) throw new Error('Registry request failed.')
      const rows = await readBoundedJson(response)
      return rows.slice(0, 20)
    },
  })
}
