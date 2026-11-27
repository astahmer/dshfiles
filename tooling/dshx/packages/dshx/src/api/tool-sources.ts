import type { Context } from '@deepseek-ai/cordis'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { apiRegistry, type ApiRegistry } from './registry.js'
import type { RegistryToolSource } from './types.js'

/** Where one agent tool comes from, as the registry listing (`dshx_registry.list`) reports it. */
export interface ToolSourceView {
  readonly source: RegistryToolSource
  /** Owning package for API and plugin tools. */
  readonly owner?: string
}

const classify = (name: string, apiOwner: string | undefined, pluginOwner: string | undefined): RegistryToolSource => {
  if (apiOwner !== undefined) return 'api'
  if (name.startsWith('mcp__')) return 'mcp'
  return pluginOwner === undefined ? 'tool' : 'plugin'
}

const apiToolOwners = (registry: ApiRegistry): Map<string, string> => {
  const owners = new Map<string, string>()
  for (const api of registry.apis.values()) {
    for (const definition of Object.values(api.methods)) if (definition.tool !== undefined) owners.set(definition.tool.name, api.owner)
  }
  return owners
}

/**
 * A synchronous classifier over the current registry: the same `api` / `mcp` / `plugin` / `tool` rule and owner as the
 * registry listing, for Host code that decides per tool name while a request is built and cannot await the listing.
 * Snapshot the API tools once per call of this function; build a new one after `tools/change`. Forced by
 * `@dshfiles/tool-search`, which groups tools by MCP server or owning plugin for per-agent tool access.
 */
const toolSources = (ctx: Context): ((name: string) => ToolSourceView) => {
  const registry = apiRegistry(ctx)
  const apiOwners = apiToolOwners(registry)
  let tools: ToolRuntime | undefined
  try {
    tools = ctx.get('tools')
  } catch {
    tools = undefined
  }
  return name => {
    const apiOwner = apiOwners.get(name)
    const definition = tools?.get(name)
    const pluginOwner = definition === undefined ? undefined : registry.toolOwners?.get(definition)
    const owner = apiOwner ?? pluginOwner
    const source = classify(name, apiOwner, pluginOwner)
    return owner === undefined ? { source } : { source, owner }
  }
}

export class ToolSourcesModel {
  static readonly classify = classify
  static readonly apiToolOwners = apiToolOwners
  static readonly of = toolSources
}
