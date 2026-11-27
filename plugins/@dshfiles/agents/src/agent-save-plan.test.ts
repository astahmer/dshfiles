import assert from 'node:assert/strict'
import { test } from 'vitest'

import { AgentEditor } from './agent-editor.js'
import { AgentSavePlans } from './agent-save-plan.js'
import { Agents, type Agent } from './agent.js'

const reviewer: Agent = { ...Agents.builtIn(1), builtIn: false, handle: 'reviewer', name: 'Reviewer' }
const base = AgentEditor.draftOf(reviewer)
const defaults = new Map([
  ['p1', 'reviewer'],
  ['p2', 'planner'],
])

test('an unchanged agent plans nothing', () => {
  const plan = AgentSavePlans.of({ creating: false, base, draft: base, defaults, projects: null })
  assert.equal(AgentSavePlans.isEmpty(plan), true)
})

test('a tools-only change sends one setToolAccess batch and no whole-agent save', () => {
  const draft = { ...base, tools: { tools: { read: { enabled: false } }, groups: {} } }
  const plan = AgentSavePlans.of({ creating: false, base, draft, defaults, projects: null })
  assert.equal(plan.save, null)
  assert.deepEqual(plan.toolEdits, [[{ target: { kind: 'tool', key: 'read' }, entry: { enabled: false } }]])
  assert.equal(plan.subagents, null)
})

test("an edit to the agent's own fields saves them with the saved tools and subagents, not the draft's", () => {
  const draft = {
    ...base,
    instructions: 'Be brief.',
    tools: { tools: { read: { enabled: false } }, groups: {} },
    subagents: { allowed: ['planner'], default: 'planner' },
  }
  const plan = AgentSavePlans.of({ creating: false, base, draft, defaults, projects: null })
  assert.equal(plan.save?.instructions, 'Be brief.')
  assert.deepEqual(plan.save?.tools, base.tools)
  assert.deepEqual(plan.save?.subagents, base.subagents)
  assert.equal(plan.toolEdits.length, 1)
  assert.deepEqual(plan.subagents, { allowed: ['planner'], default: 'planner' })
})

test('project picks set new defaults and clear only projects this agent holds', () => {
  const plan = AgentSavePlans.of({ creating: false, base, draft: base, defaults, projects: new Set(['p2', 'p3']) })
  assert.deepEqual(plan.projects, [
    { projectId: 'p2', handle: 'reviewer' },
    { projectId: 'p3', handle: 'reviewer' },
    { projectId: 'p1', handle: null },
  ])
})

test('a new agent is created whole, then its projects are pointed at it', () => {
  const draft = { ...AgentEditor.draftOf(null), handle: 'fresh', name: 'Fresh', tools: { tools: {}, groups: { native: { pinned: true } } } }
  const plan = AgentSavePlans.of({ creating: true, base: AgentEditor.draftOf(null), draft, defaults, projects: new Set(['p1']) })
  assert.deepEqual(plan.save?.tools, draft.tools)
  assert.deepEqual(plan.toolEdits, [])
  assert.deepEqual(plan.projects, [{ projectId: 'p1', handle: 'fresh' }])
})

test('the review refuses a default subagent outside the allowed list, with a fix', () => {
  const draft = { ...base, subagents: { allowed: ['planner'], default: 'reviewer' } }
  const review = AgentEditor.review(draft, { creating: false, agents: [reviewer], catalog: null })
  assert.equal(review.errors[0]?.field, 'subagents')
  assert.deepEqual(review.errors[0]?.fix, { kind: 'subagent-default-parent', label: "Use the parent thread's agent" })
  const unknown = AgentEditor.review({ ...base, subagents: { allowed: ['planner'], default: null } }, { creating: false, agents: [reviewer], catalog: null })
  assert.match(unknown.warnings[0]?.message ?? '', /@planner is not a saved agent/u)
})

test('tool access key order does not make a draft dirty', () => {
  const ordered: Agent = { ...reviewer, tools: { tools: { b: { pinned: true, enabled: true }, a: { enabled: false } }, groups: {} } }
  const draft = AgentEditor.draftOf(ordered)
  assert.deepEqual(Object.keys(draft.tools.tools), ['a', 'b'])
  assert.equal(AgentEditor.isDirty({ ...draft, tools: { tools: { a: { enabled: false }, b: { enabled: true, pinned: true } }, groups: {} } }, draft), false)
})
