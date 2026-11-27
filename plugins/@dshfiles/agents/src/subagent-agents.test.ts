import { MAX_SUBAGENT_AGENT_PREAMBLE_CHARS } from '@dshfiles/tool-subagent/agent-resolver'
import { describe, expect, it } from 'vitest'
import { Agents, type Agent, type AgentSubagents } from './agent.js'
import { SubagentAgents } from './subagent-agents.js'

const agentOf = (handle: string, extra: Partial<Agent> = {}): Agent => ({
  ...Agents.builtIn(0),
  handle,
  name: handle[0]?.toUpperCase() + handle.slice(1),
  description: '',
  builtIn: false,
  ...extra,
})

const registry = (...agents: Agent[]) => new Map([Agents.builtIn(0), ...agents].map(agent => [agent.handle, agent] as const))

const lead = (subagents: AgentSubagents) => agentOf('lead', { subagents })

describe('SubagentAgents.decide', () => {
  it('inherits when no agent is named and the parent has no default', () => {
    expect(SubagentAgents.decide({ agents: registry(lead({ allowed: 'any', default: null })), parent: 'lead', handle: undefined })).toEqual({ kind: 'inherit' })
  })

  it("starts the parent's default agent when none is named", () => {
    const decision = SubagentAgents.decide({
      agents: registry(lead({ allowed: ['reviewer'], default: 'reviewer' }), agentOf('reviewer')),
      parent: 'lead',
      handle: undefined,
    })
    expect(decision).toMatchObject({ kind: 'agent', agent: { handle: 'reviewer' } })
  })

  it('allows any agent under `any` and the parent itself under a list', () => {
    const agents = registry(lead({ allowed: ['reviewer'], default: null }), agentOf('reviewer'), agentOf('ops'))
    expect(SubagentAgents.decide({ agents, parent: 'lead', handle: 'lead' })).toMatchObject({ kind: 'agent', agent: { handle: 'lead' } })
    expect(SubagentAgents.decide({ agents, parent: 'lead', handle: 'reviewer' })).toMatchObject({ kind: 'agent' })
    const open = registry(lead({ allowed: 'any', default: null }), agentOf('ops'))
    expect(SubagentAgents.decide({ agents: open, parent: 'lead', handle: 'ops' })).toMatchObject({ kind: 'agent', agent: { handle: 'ops' } })
  })

  it('refuses an unlisted handle naming both handles, the allowed ones and how to change it', () => {
    const agents = registry(lead({ allowed: ['reviewer'], default: null }), agentOf('reviewer'), agentOf('ops'))
    const decision = SubagentAgents.decide({ agents, parent: 'lead', handle: 'ops' })
    expect(decision.kind).toBe('refused')
    const message = decision.kind === 'refused' ? decision.message : ''
    expect(message).toContain("@lead's subagents may not run as @ops")
    expect(message).toContain('Allowed: @lead, @reviewer')
    expect(message).toContain('agents_subagents_set')
  })

  it('refuses an unknown handle and lists the valid ones', () => {
    const agents = registry(lead({ allowed: 'any', default: null }), agentOf('reviewer'))
    const decision = SubagentAgents.decide({ agents, parent: 'lead', handle: 'ghost' })
    expect(decision).toEqual({
      kind: 'refused',
      message: '@ghost does not exist. Agents @lead may start: @lead, @dsh, @reviewer. Pass one of them, or omit `agent`.',
    })
  })

  it('refuses a default that no longer exists with the way to change the default, and a disabled agent', () => {
    const gone = SubagentAgents.decide({ agents: registry(lead({ allowed: 'any', default: 'ghost' })), parent: 'lead', handle: undefined })
    expect(gone.kind === 'refused' ? gone.message : '').toMatch(/^@lead's default subagent agent @ghost does not exist\..*agents_subagents_set/u)
    const disabled = SubagentAgents.decide({ agents: registry(lead({ allowed: 'any', default: null }), agentOf('off', { enabled: false })), parent: 'lead', handle: 'off' })
    expect(disabled.kind === 'refused' ? disabled.message : '').toContain('@off is disabled')
  })

  it('treats a removed parent agent as unrestricted', () => {
    expect(SubagentAgents.decide({ agents: registry(agentOf('ops')), parent: 'gone', handle: 'ops' })).toMatchObject({ kind: 'agent' })
  })
})

describe('SubagentAgents.preamble', () => {
  it('opens with identity and instructions, bounded, and is empty for the bare built-in agent', () => {
    expect(SubagentAgents.preamble(Agents.builtIn(0))).toBe('')
    expect(SubagentAgents.preamble(agentOf('reviewer', { description: 'Reviews diffs', instructions: 'Be strict.' }))).toBe(
      'Work as @reviewer — Reviewer.\nReviews diffs\n\nBe strict.',
    )
    expect(SubagentAgents.preamble(agentOf('long', { instructions: 'x'.repeat(8_000) }))).toHaveLength(MAX_SUBAGENT_AGENT_PREAMBLE_CHARS)
  })
})

describe('SubagentAgents.listing', () => {
  it('lists enabled allowed agents, the parent first, with the default and how to change it', () => {
    const route = { provider: 'beta', model: 'review-model' }
    const listing = SubagentAgents.listing({
      agents: registry(lead({ allowed: ['reviewer', 'off'], default: 'reviewer' }), agentOf('reviewer', { route, preset: 'review' }), agentOf('off', { enabled: false }), agentOf('ops')),
      parent: 'lead',
    })
    expect(listing.agents.map(agent => agent.handle)).toEqual(['lead', 'reviewer'])
    expect(listing.agents[1]).toMatchObject({ route, preset: 'review' })
    expect(listing.default).toBe('reviewer')
    expect(listing.change).toContain('agents_subagents_set')
  })
})
