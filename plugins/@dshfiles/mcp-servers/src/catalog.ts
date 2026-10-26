import { decodeJson } from '@dshfiles/dshx/json'
import { z } from 'zod'
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

const categoryValueSchema = z.union([z.string(), z.array(z.string().catch(''))])
const registryMetadataSchema = z.object({
  category: categoryValueSchema.optional().catch(undefined),
  documentationUrl: z.string().optional().catch(undefined),
})

const registryRemoteSchema = z.object({
  type: z.string().optional().catch(undefined),
  transport: z.string().optional().catch(undefined),
  url: z.string().optional().catch(undefined),
})

const registryServerSchema = z.object({
  name: z.string().max(200),
  title: z.string().catch(''),
  category: categoryValueSchema.optional().catch(undefined),
  description: z.string().catch(''),
  version: z.string().catch(''),
  documentationUrl: z.string().optional().catch(undefined),
  websiteUrl: z.string().optional().catch(undefined),
  _meta: z.record(z.string(), registryMetadataSchema.catch({})).catch({}),
  remotes: z.array(registryRemoteSchema.catch({})).catch([]),
})

type RegistryServer = z.infer<typeof registryServerSchema>

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
  for (const metadata of Object.values(item._meta)) {
    const category = metadata.category
    if (Array.isArray(category)) {
      const first = category.find(value => value.trim().length > 0)
      if (first !== undefined) return first.trim().slice(0, 80)
    }
    if (category !== undefined && !Array.isArray(category) && category.trim().length > 0) return category.trim().slice(0, 80)
  }
  return 'Uncategorized'
}

const documentationOf = (item: RegistryServer): string | null => {
  const direct = safeHttps(item.documentationUrl) ?? safeHttps(item.websiteUrl)
  if (direct !== null) return direct
  for (const metadata of Object.values(item._meta)) {
    const url = safeHttps(metadata.documentationUrl)
    if (url !== null) return url
  }
  return null
}

const registryEntrySchema = z
  .union([z.object({ server: registryServerSchema }).transform(input => input.server), registryServerSchema])
  .transform((item): RegistryEntry => {
    const endpoint = item.remotes.find(
      remote => (remote.type === 'streamable-http' || remote.transport === 'streamable-http') && safeHttps(remote.url) !== null,
    )
    return {
      name: item.name,
      title: item.title.slice(0, 120),
      category: categoryOf(item),
      description: item.description.slice(0, 500),
      version: item.version.slice(0, 80),
      endpoint: endpoint === undefined ? null : safeHttps(endpoint.url),
      docsUrl: documentationOf(item),
    }
  })
const registryRowSchema = z.union([registryEntrySchema, z.undefined()]).catch(undefined)

const registryPayloadSchema = z.object({ servers: z.array(registryRowSchema).catch([]) }).catch({ servers: [] })
type RegistryPayload = z.infer<typeof registryPayloadSchema>

const readBoundedJson = async (response: Response): Promise<RegistryPayload> => {
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
  return decodeJson(registryPayloadSchema, new TextDecoder().decode(bytes))
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
      const payload = await readBoundedJson(response)
      return payload.servers.slice(0, 20).flatMap(row => (row === undefined ? [] : [row]))
    },
  })
}
