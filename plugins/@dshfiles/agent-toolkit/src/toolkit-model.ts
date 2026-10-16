import { z } from 'zod'

const MEMORY_OWNER = '@dshfiles/memory'

const toolSchema = z.object({
  name: z.string(),
  description: z.string().catch(''),
  source: z.enum(['api', 'mcp', 'plugin', 'tool']).catch('tool'),
  owner: z.string().optional().catch(undefined),
  readOnly: z.boolean().optional().catch(undefined),
  enabled: z.boolean().catch(true),
})

const skillSchema = z.object({
  name: z.string(),
  description: z.string().catch(''),
  provider: z.string().catch(''),
  source: z.string().optional().catch(undefined),
  modelInvocable: z.boolean().catch(true),
  userInvocable: z.boolean().optional().catch(undefined),
})

const apiSchema = z.object({
  owner: z.string(),
  id: z.string(),
  methods: z.array(z.object({ name: z.string(), description: z.string().optional().catch(undefined), tool: z.string().optional().catch(undefined) })).catch([]),
})

/** A registry listing as any dshx leader serves it: fields an older leader lacks take neutral defaults. */
const listingSchema = z.object({
  apis: z.array(apiSchema).catch([]),
  tools: z.array(toolSchema).catch([]),
  toolScope: z.object({ sessionId: z.string() }).optional().catch(undefined),
  skills: z.array(skillSchema).catch([]),
})

export type ToolkitTool = z.infer<typeof toolSchema>
export type ToolkitSkill = z.infer<typeof skillSchema>
export type ToolkitListing = z.infer<typeof listingSchema>

/** Where a tool comes from, as the page filters it. `native` is DSH's own tools and plugins not built with dshx. */
export type ToolkitSource = 'native' | 'plugin' | 'mcp' | 'memory'
export type ToolkitFilter = 'all' | ToolkitSource | 'skills'
export type SkillOrigin = 'project-dsh' | 'project-agents' | 'user-dsh' | 'user-agents' | 'runtime' | 'custom' | 'bundled' | 'other'
export type SkillInvocation = 'both' | 'user' | 'model' | 'none'
export type PluginOrigin = 'dshfiles' | 'deepseek' | 'other'
export type ToolkitSection = 'tools' | 'apis' | 'plugins' | 'mcp' | 'skills' | 'memory'

export interface ApiMethodRow {
  readonly key: string
  readonly owner: string
  readonly path: string
  readonly description: string | undefined
  readonly tool: string | undefined
}

export interface McpServerRow {
  readonly id: string
  readonly name: string
  readonly serverName: string
  readonly enabled: boolean
  readonly lifecycle: string
  readonly tools: readonly ToolkitTool[]
}

export interface PluginRow {
  readonly entryId: string
  readonly moduleName: string
  readonly packageName: string
  readonly title: string | undefined
  readonly version: string | null
  readonly enabled: boolean
  readonly phase: string | null
  readonly origin: PluginOrigin
}

const SECTIONS_BY_FILTER = {
  all: ['tools', 'apis', 'plugins', 'mcp', 'skills', 'memory'],
  native: ['tools', 'plugins'],
  plugin: ['tools', 'apis', 'plugins'],
  mcp: ['tools', 'mcp'],
  memory: ['tools', 'apis', 'memory'],
  skills: ['skills'],
} as const satisfies Record<ToolkitFilter, readonly ToolkitSection[]>

const ORIGIN_ORDER = { dshfiles: 0, other: 1, deepseek: 2 } as const satisfies Record<PluginOrigin, number>

const packageNameOf = (moduleName: string): string => {
  const parts = moduleName.split('/')
  return (moduleName.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/')
}

export class AgentToolkit {
  static readonly filters = ['all', 'native', 'plugin', 'mcp', 'memory', 'skills'] as const satisfies readonly ToolkitFilter[]

  /** Decodes a listing from any dshx leader; an older one lacks fields, which take neutral defaults. */
  static readonly listingSchema = listingSchema

  static sourceOf(tool: ToolkitTool): ToolkitSource {
    if (tool.owner === MEMORY_OWNER) return 'memory'
    if (tool.source === 'mcp') return 'mcp'
    return tool.source === 'tool' ? 'native' : 'plugin'
  }

  static shows(filter: ToolkitFilter, section: ToolkitSection): boolean {
    const sections: readonly ToolkitSection[] = SECTIONS_BY_FILTER[filter]
    return sections.includes(section)
  }

  static matches(query: string, ...fields: ReadonlyArray<string | undefined>): boolean {
    const needle = query.trim().toLowerCase()
    return needle === '' || fields.some(field => field?.toLowerCase().includes(needle) === true)
  }

  static tools(input: { readonly tools: readonly ToolkitTool[]; readonly filter: ToolkitFilter; readonly query: string }): readonly ToolkitTool[] {
    return input.tools.filter(
      tool =>
        (input.filter === 'all' || input.filter === AgentToolkit.sourceOf(tool)) && AgentToolkit.matches(input.query, tool.name, tool.description, tool.owner),
    )
  }

  /** The methods plugins serve each other, with the agent tool a method is exposed as. */
  static apiMethods(input: { readonly listing: ToolkitListing; readonly filter: ToolkitFilter; readonly query: string }): readonly ApiMethodRow[] {
    return input.listing.apis
      .filter(api => input.filter !== 'memory' || api.owner === MEMORY_OWNER)
      .flatMap(api =>
        api.methods.map(method => ({
          key: `${api.owner}/${api.id}.${method.name}`,
          owner: api.owner,
          path: `${api.id}.${method.name}`,
          description: method.description,
          tool: method.tool,
        })),
      )
      .filter(row => AgentToolkit.matches(input.query, row.owner, row.path, row.description, row.tool))
  }

  /** The Host's source is authoritative; origin never depends on cwd or an exposed filesystem path. */
  static skillOrigin(skill: ToolkitSkill): SkillOrigin {
    switch (skill.source) {
      case 'project-dsh':
      case 'project-agents':
      case 'user-dsh':
      case 'user-agents':
      case 'runtime':
      case 'custom':
      case 'bundled':
        return skill.source
      default:
        return 'other'
    }
  }

  /** An older registry does not say whether a person can invoke a skill; DSH's default is yes. */
  static invocation(skill: ToolkitSkill): SkillInvocation {
    const user = skill.userInvocable ?? true
    if (user && skill.modelInvocable) return 'both'
    if (user) return 'user'
    return skill.modelInvocable ? 'model' : 'none'
  }

  static mcpServers(input: {
    readonly servers: readonly {
      readonly id: string
      readonly name: string
      readonly serverName: string
      readonly enabled: boolean
      readonly clientLifecycle: string
    }[]
    readonly tools: readonly ToolkitTool[]
  }): readonly McpServerRow[] {
    return input.servers.map(server => ({
      id: server.id,
      name: server.name,
      serverName: server.serverName,
      enabled: server.enabled,
      lifecycle: server.clientLifecycle,
      tools: input.tools.filter(tool => tool.name.startsWith(`mcp__${server.serverName}__`)),
    }))
  }

  static noteCounts(notes: readonly { readonly type: string }[]): readonly { readonly type: string; readonly count: number }[] {
    const counts = new Map<string, number>()
    for (const note of notes) counts.set(note.type, (counts.get(note.type) ?? 0) + 1)
    return [...counts].map(([type, count]) => ({ type, count })).sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
  }

  static pluginPackages(entries: readonly { readonly moduleName: string }[]): readonly string[] {
    return [...new Set(entries.map(entry => packageNameOf(entry.moduleName)))].sort()
  }

  /** Our bundles first, then third-party ones, then DSH's own; one row per Loader entry. */
  static plugins(input: {
    readonly entries: readonly {
      readonly entryId: string
      readonly moduleName: string
      readonly title?: string | undefined
      readonly enabled: boolean
      readonly fiberPhase: string | null
    }[]
    readonly versions: Readonly<Record<string, string | null>>
  }): readonly PluginRow[] {
    return input.entries
      .filter(entry => !entry.moduleName.startsWith('cordis:'))
      .map((entry): PluginRow => {
        const packageName = packageNameOf(entry.moduleName)
        const origin: PluginOrigin = packageName.startsWith('@dshfiles/') ? 'dshfiles' : packageName.startsWith('@deepseek-ai/') ? 'deepseek' : 'other'
        return {
          entryId: entry.entryId,
          moduleName: entry.moduleName,
          packageName,
          title: entry.title === entry.moduleName || entry.title === packageName ? undefined : entry.title,
          version: input.versions[packageName] ?? null,
          enabled: entry.enabled,
          phase: entry.fiberPhase,
          origin,
        }
      })
      .sort((left, right) => ORIGIN_ORDER[left.origin] - ORIGIN_ORDER[right.origin] || left.moduleName.localeCompare(right.moduleName))
  }

  /** The filter's plugin rows: `native` is DSH's own entries, `plugin` everything else. */
  static pluginsFor(rows: readonly PluginRow[], filter: ToolkitFilter, query: string): readonly PluginRow[] {
    return rows.filter(
      row =>
        (filter === 'native' ? row.origin === 'deepseek' : filter === 'plugin' ? row.origin !== 'deepseek' : true) &&
        AgentToolkit.matches(query, row.moduleName, row.title, row.entryId),
    )
  }
}
