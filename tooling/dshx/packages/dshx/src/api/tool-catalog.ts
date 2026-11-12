import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { toToolSchema } from './json-schema.js'
import type { RegistryListing } from './types.js'

export interface PluginToolCatalogEntry {
  readonly name: string
  readonly description: string
  readonly readOnly: boolean
  readonly owner: string
  readonly apiId: string
  readonly version: number
  readonly method: string
  readonly inputSchema: JsonSchemaNode
  readonly takesInput: boolean
}

export const pluginToolCatalog = ({ listing }: { readonly listing: RegistryListing }): PluginToolCatalogEntry[] => {
  const tools = new Map(listing.tools.map(tool => [tool.name, tool]))
  const entries: PluginToolCatalogEntry[] = []
  for (const api of listing.apis) {
    for (const method of api.methods) {
      if (method.tool === undefined) continue
      const tool = tools.get(method.tool)
      if (tool !== undefined && tool.source !== 'api') continue
      const projected = toToolSchema(method.input)
      const takesInput = projected.type === 'object'
      entries.push({
        name: method.tool,
        description: tool?.description ?? method.description ?? '',
        readOnly: tool?.readOnly === true,
        owner: api.owner,
        apiId: api.id,
        version: api.version,
        method: method.name,
        inputSchema: takesInput ? projected : { type: 'object', properties: {} },
        takesInput,
      })
    }
  }
  return entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}
