import type {} from '@deepseek-ai/cordis'

/**
 * One plugin's claim that some of its tools must be declared to every Session instead of hidden behind
 * `tool_search`. Keep the set small and the tools cheap: the declared list is sent with every request, so a
 * large schema costs cached tokens on each turn.
 */
export interface ToolVisibilityDeclaration {
  /** The package that owns the tools, for the README and for a future audit view. */
  readonly owner: string
  /** Exact tool names; no wildcards, so a rename cannot silently widen the declared list. */
  readonly tools: readonly string[]
  /** One sentence a human reads when asking why this tool is always visible. */
  readonly reason: string
}

/** The registry `@dshfiles/tool-search` publishes on the Host while it is loaded. */
export interface ToolSearchVisibility {
  declare(declaration: ToolVisibilityDeclaration): void
  names(): ReadonlySet<string>
  /** Why each declared name is visible; used by tests and by a future settings page. */
  reasons(): ReadonlyMap<string, string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only while `@dshfiles/tool-search` is loaded; absent means every plugin tool stays searchable. */
    toolSearchVisibility?: ToolSearchVisibility
  }
}

/**
 * Declare always-visible tools for this plugin. Returns false when `@dshfiles/tool-search` is not loaded, so the
 * caller can retry (the plugin loads before some of the plugins that own tools, so an early call is expected).
 */
export const declareVisibleTools = (ctx: { get(name: 'toolSearchVisibility'): ToolSearchVisibility | undefined }, declaration: ToolVisibilityDeclaration): boolean => {
  const registry = ctx.get('toolSearchVisibility')
  if (registry === undefined) return false
  registry.declare(declaration)
  return true
}

/** The one registry a Host has. Kept here so the contract and its test share one implementation. */
export const makeToolSearchVisibility = (): ToolSearchVisibility => {
  const declared = new Map<string, string>()
  return {
    declare: ({ owner, tools, reason }) => {
      let changed = false
      for (const tool of tools) {
        const previous = declared.get(tool)
        if (previous !== undefined) continue
        declared.set(tool, `${owner}: ${reason}`)
        changed = true
      }
      return changed
    },
    names: () => new Set(declared.keys()),
    reasons: () => new Map(declared),
  }
}
