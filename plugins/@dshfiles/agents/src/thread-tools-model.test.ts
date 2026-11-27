import { describe, expect, it } from 'vitest'
import { Agents, type Agent } from './agent.js'
import type { ThreadAccessView } from './thread-agents.js'
import { ThreadTools } from './thread-tools-model.js'

const POLICY_SOURCE = { explicit: 'agent', inherited: 'agent', 'project-default': 'project-default', default: 'default' } as const

const view = (
  overrides: {
    handle?: string
    resolution?: ThreadAccessView['agent']['resolution']
    override?: ThreadAccessView['agent']['override']
    recorded?: boolean
  } = {},
): ThreadAccessView => {
  const handle = overrides.handle ?? 'reviewer'
  const resolution = overrides.resolution ?? 'project-default'
  const override = overrides.override ?? null
  return {
    sessionId: 's1',
    recorded: overrides.recorded ?? true,
    agent: { sessionId: 's1', handle, resolution, projectId: 'w', inheritedFrom: null, access: { tools: {}, groups: {} }, decidedAt: 1, override },
    policy: {
      agent: handle,
      source: override !== null ? 'override' : POLICY_SOURCE[resolution],
      toolsFrom: override?.kind === 'all' ? null : (override?.handle ?? handle),
      access: { tools: {}, groups: {} },
      change: '',
    },
  }
}

describe('ThreadTools.state', () => {
  it('names the agent, its source and its own tools', () => {
    expect(ThreadTools.state(view())).toEqual({
      agent: 'reviewer',
      source: 'project default',
      tools: "@reviewer's tools",
      value: 'agent:reviewer',
      overridden: false,
      recorded: true,
    })
    expect(ThreadTools.state(view({ handle: 'dsh', resolution: 'default' })).source).toBe('default')
    expect(ThreadTools.state(view({ resolution: 'explicit' })).source).toBe('agent')
    expect(ThreadTools.state(view({ resolution: 'inherited' })).source).toBe('agent')
  })

  it('shows another agent tool set or all tools as an override that can be reset', () => {
    expect(ThreadTools.state(view({ override: { kind: 'agent', handle: 'luna', access: { tools: {}, groups: {} } } }))).toMatchObject({
      source: 'override',
      tools: "@luna's tools",
      value: 'agent:luna',
      overridden: true,
    })
    expect(ThreadTools.state(view({ override: { kind: 'all' } }))).toMatchObject({ tools: 'All tools', value: 'all', overridden: true })
  })

  it('marks a preview of a thread whose agent is not decided yet', () => {
    expect(ThreadTools.state(view({ recorded: false })).recorded).toBe(false)
  })
})

describe('ThreadTools.requestFor', () => {
  it('maps a choice to the override; picking the thread agent clears it', () => {
    expect(ThreadTools.requestFor('all', 'reviewer')).toEqual({ kind: 'all' })
    expect(ThreadTools.requestFor('agent:luna', 'reviewer')).toEqual({ kind: 'agent', handle: 'luna' })
    expect(ThreadTools.requestFor('agent:reviewer', 'reviewer')).toBeNull()
  })
})

describe('ThreadTools.choices', () => {
  const agent = (handle: string, enabled = true): Agent => ({ ...Agents.builtIn(0), handle, name: handle, builtIn: handle === 'dsh', enabled })

  it('lists enabled agents with the thread agent first, keeping it even when disabled', () => {
    const agents = [agent('dsh'), agent('luna'), agent('reviewer', false), agent('off', false)]
    expect(ThreadTools.choices(agents, 'reviewer').map(row => row.handle)).toEqual(['reviewer', 'dsh', 'luna'])
  })
})
