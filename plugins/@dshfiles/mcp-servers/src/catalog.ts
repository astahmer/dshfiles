import type { RegistryEntry } from './api.js'

export const PROVIDERS = [
  {
    id: 'figma',
    name: 'Figma',
    category: 'Design',
    description: 'Read design context and work with Figma files.',
    docsUrl: 'https://developers.figma.com/docs/figma-mcp-server/',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Developer tools',
    description: 'Work with repositories, issues, pull requests, and code.',
    docsUrl: 'https://github.com/github/github-mcp-server',
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'Project management',
    description: 'Search and manage Linear issues, projects, and comments.',
    docsUrl: 'https://linear.app/docs/mcp',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'Knowledge',
    description: 'Search, read, and update a Notion workspace.',
    docsUrl: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'Developer tools',
    description: 'Use Cloudflare services through the provider MCP server.',
    docsUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/',
  },
  {
    id: 'cloudflare-docs',
    name: 'Cloudflare Docs',
    category: 'Documentation',
    description: 'Search current Cloudflare developer documentation.',
    docsUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'Monitoring',
    description: 'Investigate errors, performance, and Sentry projects.',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'Deployment',
    description: 'Search Vercel docs and manage projects and deployments.',
    docsUrl: 'https://vercel.com/docs/mcp',
  },
] as const

export function filterProviders<T extends { name: string; category: string; description: string }>(rows: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase()
  return needle.length === 0 ? [...rows] : rows.filter(row => `${row.name} ${row.category} ${row.description}`.toLocaleLowerCase().includes(needle))
}

const REGISTRY_ENDPOINT = 'https://registry.modelcontextprotocol.io/v0.1/servers'
const MAX_REGISTRY_BYTES = 1_000_000

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function safeHttps(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.search === '' && url.hash === '' ? url.href : null
  } catch {
    return null
  }
}

function publisherMetadata(item: Record<string, unknown>): Record<string, unknown>[] {
  const root = object(item._meta)
  if (root === undefined) return []
  return Object.values(root)
    .map(object)
    .filter((value): value is Record<string, unknown> => value !== undefined)
}

function categoryOf(item: Record<string, unknown>): string {
  for (const metadata of publisherMetadata(item)) {
    const category = metadata.category
    if (typeof category === 'string' && category.trim().length > 0) return category.trim().slice(0, 80)
    if (Array.isArray(category)) {
      const first = category.find(value => typeof value === 'string' && value.trim().length > 0)
      if (typeof first === 'string') return first.trim().slice(0, 80)
    }
  }
  return 'Uncategorized'
}

function documentationOf(item: Record<string, unknown>): string | null {
  const direct = safeHttps(item.documentationUrl) ?? safeHttps(item.websiteUrl)
  if (direct !== null) return direct
  for (const metadata of publisherMetadata(item)) {
    const url = safeHttps(metadata.documentationUrl)
    if (url !== null) return url
  }
  return null
}

async function readBoundedJson(response: Response): Promise<unknown> {
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
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

function registryRow(value: unknown): RegistryEntry | undefined {
  const wrapped = object(value)
  const item = object(wrapped?.server) ?? wrapped
  if (item === undefined || typeof item.name !== 'string' || item.name.length > 200) return undefined

  const remotes = Array.isArray(item.remotes) ? item.remotes : []
  const endpoint = remotes
    .map(object)
    .find(remote => remote !== undefined && (remote.type === 'streamable-http' || remote.transport === 'streamable-http') && safeHttps(remote.url) !== null)
  const documentation = documentationOf(item)
  const version = typeof item.version === 'string' ? item.version.slice(0, 80) : ''
  const description = typeof item.description === 'string' ? item.description.slice(0, 500) : ''
  return {
    name: item.name,
    title: typeof item.title === 'string' ? item.title.slice(0, 120) : '',
    category: categoryOf(item),
    description,
    version,
    endpoint: endpoint === undefined ? null : safeHttps(endpoint.url),
    docsUrl: documentation,
  }
}

export async function searchOfficialRegistry(query: string): Promise<RegistryEntry[]> {
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
  const payload = object(await readBoundedJson(response))
  const rows = Array.isArray(payload?.servers) ? payload.servers : []
  return rows.slice(0, 20).flatMap(row => {
    const result = registryRow(row)
    return result === undefined ? [] : [result]
  })
}
