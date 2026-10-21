import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Agents, type Agent } from './agent.js'
import { DelegationGuard } from './delegation-guard.js'

const agent = (subagents: boolean): Agent => ({
  ...Agents.builtIn(1),
  handle: 'reviewer',
  name: 'Reviewer',
  builtIn: false,
  delegation: { messaging: 'any', handles: [], subagents },
})

test('a delegation tool is refused when the agent may not spawn subagents', () => {
  assert.equal(
    DelegationGuard.refusal({ toolName: 'subagent', agent: agent(false) }),
    '@reviewer may not start subagents or workflows. Change its delegation setting to allow them.',
  )
  assert.equal(DelegationGuard.refusal({ toolName: 'subagent_fork', agent: agent(false) }) !== undefined, true)
  assert.equal(DelegationGuard.refusal({ toolName: 'workflow', agent: agent(false) }) !== undefined, true)
  assert.equal(DelegationGuard.refusal({ toolName: 'subagent', agent: agent(true) }), undefined)
})

test('everything else is untouched: other tools, a thread no agent started, a direct caller', () => {
  assert.equal(DelegationGuard.refusal({ toolName: 'bash', agent: agent(false) }), undefined)
  assert.equal(DelegationGuard.refusal({ toolName: 'subagent', agent: null }), undefined)
})
