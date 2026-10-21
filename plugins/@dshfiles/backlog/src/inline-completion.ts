/** A `#tag` or `@query` token right before the caret, with the source scope it names when it has one. */
export interface InlineToken {
  readonly trigger: '#' | '@'
  /** The text a source matches against: the whole query for plain `@`, the part after `scope:` for a scoped one. */
  readonly query: string
  /** Start offset of the token in the text, so a pick replaces exactly what was typed. */
  readonly start: number
  /** The lowercase scope before `:`, or null for a plain token. */
  readonly scope: string | null
}

/** An agent the comment box can complete from; a subset of the agent record the agents API returns. */
export interface InlineAgent {
  readonly handle: string
  readonly name: string
  readonly glyph: string
  readonly description: string
}

export interface InlineAgentRow {
  readonly handle: string
  readonly insert: string
}

const AGENT_SCOPES: readonly string[] = ['agent', 'a']
const OTHER_SCOPES: readonly string[] = ['thread', 't', 'file', 'f', 'skill', 'mcp', 'backlog', 'b']

/**
 * Inline `@` completion for the backlog's own text boxes. The token grammar, the scope list and the picked text live
 * here so the capture composer and an item's comment box complete the same way, and so typing `@b:12` or `@t:` keeps
 * meaning a backlog item or thread reference instead of opening an agent list.
 */
export class InlineCompletion {
  /** The token being typed right before the caret, if any. */
  static tokenAt(text: string, caret: number): InlineToken | null {
    const match = /(^|\s)([#@])([\w./:-]*)$/u.exec(text.slice(0, caret))
    if (match === null || match[2] === undefined) return null
    const trigger = match[2] === '#' ? '#' : '@'
    const body = match[3] ?? ''
    const start = caret - body.length - 1
    if (trigger === '#') return { trigger, query: body, start, scope: null }
    const scope = /^([a-z]+):/iu.exec(body)?.[1]?.toLowerCase() ?? null
    if (scope === null) return { trigger, query: body, start, scope }
    return { trigger, query: body.slice(scope.length + 1), start, scope }
  }

  /** Agents to offer for one token: none under another source's scope or a quoted file path. */
  static agents(
    token: InlineToken | null,
    agents: readonly InlineAgent[],
    options: { readonly quoted?: boolean; readonly limit?: number } = {},
  ): readonly InlineAgentRow[] {
    if (token === null || token.trigger !== '@' || options.quoted === true) return []
    if (token.scope !== null && !AGENT_SCOPES.includes(token.scope)) {
      // A scope another source owns stays empty; `b:12`/`t:…` keep working as typed text.
      if (OTHER_SCOPES.includes(token.scope)) return []
      return []
    }
    const query = token.query.trim().toLowerCase()
    return agents
      .filter(
        agent => query === '' || agent.handle.includes(query) || agent.name.toLowerCase().includes(query) || agent.description.toLowerCase().includes(query),
      )
      .slice(0, options.limit ?? 8)
      .map(agent => ({ handle: agent.handle, insert: `@${agent.handle} ` }))
  }

  /** The text after picking one row: the readable mention a dispatch reads, plus a space. */
  static insertFor(handle: string): string {
    return `@${handle} `
  }
}
