import { prefixedTokenAt } from '@dshfiles/input-trigger/caret-token'

import { projectReferenceDraftToken } from './project-reference-draft.js'

/** The `#tag` or `@query` token the caret is on, with the source scope it names when it has one. */
export interface InlineToken {
  readonly trigger: '#' | '@'
  /** The text a source matches against: the whole query for plain `@`, the part after `scope:` for a scoped one. */
  readonly query: string
  /** Offsets of the whole token (`[start, end)`), so a pick replaces exactly that token. */
  readonly start: number
  readonly end: number
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

/** The draft after a pick, and where the caret goes. */
export interface InlinePick {
  readonly text: string
  readonly caret: number
}

export interface InlineProjectRow {
  readonly path: string
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
  /** The token the caret is on, resolved with the rich composer's Codex rules: one whitespace-delimited token. */
  static tokenAt(text: string, caret: number): InlineToken | null {
    const tag = prefixedTokenAt({ text, caret, prefix: '#' })
    const mention = prefixedTokenAt({ text, caret, prefix: '@' })
    // Like Codex arbitrating `$` against `@`, the token that starts later is the one being typed.
    if (tag !== null && (mention === null || tag.start > mention.start)) return { trigger: '#', query: tag.query, start: tag.start, end: tag.end, scope: null }
    if (mention === null) return null
    const scope = /^([a-z]+):/iu.exec(mention.query)?.[1]?.toLowerCase() ?? null
    const query = scope === null ? mention.query : mention.query.slice(scope.length + 1)
    return { trigger: '@', query, start: mention.start, end: mention.end, scope }
  }

  /**
   * The text and caret after picking a row (Codex's completion separator): the token is replaced and the caret lands after
   * one space. A space already there is reused, unless a word follows it directly, which keeps its own separator.
   */
  static applyPick(input: { readonly text: string; readonly token: InlineToken; readonly insert: string }): InlinePick {
    const inserted = input.insert.trimEnd()
    const rest = input.text.slice(input.token.end)
    const reuseSeparator = /^[^\S\r\n](?:\s|$)/u.test(rest)
    const separator = reuseSeparator ? '' : ' '
    const text = `${input.text.slice(0, input.token.start)}${inserted}${separator}${rest}`
    const pick: InlinePick = { text, caret: input.token.start + inserted.length + 1 }
    return pick
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

  /** Project paths match by full path or final folder name and insert a readable draft token for serialization on submit. */
  static projects(token: InlineToken | null, projects: readonly string[]): readonly InlineProjectRow[] {
    if (token === null || token.trigger !== '@' || token.scope !== null) return []
    const query = token.query.trim().toLowerCase()
    return projects
      .filter(path => query === '' || path.toLowerCase().includes(query) || (path.split('/').filter(Boolean).at(-1) ?? path).toLowerCase().includes(query))
      .slice(0, 6)
      .map(path => ({ path, insert: `${projectReferenceDraftToken(path, projects)} ` }))
  }

  /** The text after picking one row: the readable mention a dispatch reads, plus a space. */
  static insertFor(handle: string): string {
    return `@${handle} `
  }
}
