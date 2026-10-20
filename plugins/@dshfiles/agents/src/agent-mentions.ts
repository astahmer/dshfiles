import type { InputTriggerCandidate, InputTriggerSource } from '@dshfiles/input-trigger/client'
import { AGENT_MENTION_SCOPES, type Agent } from './agent.js'

/** Every other source's scope, so its rows never leak into an agent lookup and vice versa. */
const OTHER_SCOPES = ['thread', 't', 'file', 'f', 'skill', 'mcp', 'backlog', 'b']
const MIXED_LIMIT = 5
const SCOPED_LIMIT = 40

/** The text after `@agent:`/`@a:`, the whole query for plain `@`, or undefined while another source's scope is typed. */
const scopedQuery = (query: string): { readonly text: string; readonly scoped: boolean } | undefined => {
  const scope = /^([a-z]+):/iu.exec(query)?.[1]?.toLowerCase()
  if (scope === undefined) return { text: query, scoped: false }
  if (AGENT_MENTION_SCOPES.includes(scope)) return { text: query.slice(scope.length + 1), scoped: true }
  return OTHER_SCOPES.includes(scope) ? undefined : { text: query, scoped: false }
}

const matches = (agent: Agent, text: string): boolean => {
  const query = text.trim().toLowerCase()
  if (query === '') return true
  return agent.handle.includes(query) || agent.name.toLowerCase().includes(query) || agent.description.toLowerCase().includes(query)
}

const candidateOf = (agent: Agent, section: string): InputTriggerCandidate => ({
  name: `@${agent.handle}`,
  label: `${agent.glyph === '' ? '' : `${agent.glyph} `}${agent.name}`,
  description: [agent.route === null ? 'harness default' : `${agent.route.provider}/${agent.route.model}`, agent.description]
    .filter(part => part.trim() !== '')
    .join(' · '),
  section,
  value: agent.handle,
})

/**
 * `@` mentions of agents. A picked row inserts `@handle ` as plain text, so the composer, the sent message and a
 * backlog comment all carry the same readable mention.
 */
const createSource = (options: { readonly list: () => Promise<readonly Agent[]>; readonly section: string }): InputTriggerSource => ({
  trigger: '@',
  name: 'agents',
  order: 20,
  showGroupTitle: true,
  async candidates(_session, request) {
    const query = scopedQuery(request.query)
    if (query === undefined || request.quoted === true) return []
    // A plain `@` already lists files and threads; agents join once the query narrows, or right away with `@agent:`.
    if (!query.scoped && query.text.trim() === '') return []
    const agents = (await options.list()).filter(agent => agent.enabled && matches(agent, query.text))
    const limit = query.scoped ? SCOPED_LIMIT : MIXED_LIMIT
    return agents.slice(0, limit).map(agent => candidateOf(agent, options.section))
  },
  onPick({ candidate }) {
    if (candidate.value === undefined) return undefined
    return { text: `@${candidate.value} ` }
  },
})

export class AgentMentions {
  static readonly createSource = createSource
  static readonly scopedQuery = scopedQuery
}
