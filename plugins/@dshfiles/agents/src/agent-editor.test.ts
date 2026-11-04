import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AgentEditor, AGENT_TEMPLATES } from './agent-editor.js'
import { Agents, type Agent, type AgentDraft } from './agent.js'
import type { AgentModelOption } from './dispatch.js'

const agent = (fields: Partial<Agent> = {}): Agent => ({ ...Agents.builtIn(1), builtIn: false, ...fields })
const dsh = Agents.builtIn(1)
const reviewer = agent({ handle: 'reviewer', name: 'Reviewer' })
const draft = (fields: Partial<AgentDraft> = {}): AgentDraft => ({ ...AgentEditor.draftOf(null), name: 'Planner', ...fields })
const luna: AgentModelOption = {
  key: 'codex/gpt-6-luna',
  provider: 'codex',
  providerName: 'Codex',
  model: 'gpt-6-luna',
  modelName: 'GPT-6 Luna',
  efforts: ['low', 'high'],
  defaultEffort: 'low',
}
const context = { creating: true, agents: [dsh, reviewer], catalog: [luna] }

test('a fresh draft is clean and an edit makes it dirty, whatever the key order of its route', () => {
  const base = AgentEditor.draftOf(reviewer)
  assert.equal(AgentEditor.isDirty(base, base), false)
  assert.equal(AgentEditor.isDirty({ ...base, instructions: 'Be brief.' }, base), true)
  const routed = { ...base, route: { provider: 'codex', model: 'gpt-6-luna' } }
  assert.equal(AgentEditor.isDirty({ ...routed, route: { model: 'gpt-6-luna', provider: 'codex' } }, routed), false)
})

test('the review blocks a save without a name and over a taken handle, offering a free one', () => {
  assert.deepEqual(
    AgentEditor.review(draft({ name: '' }), context).errors.map(issue => issue.field),
    ['name'],
  )
  const clash = AgentEditor.review(draft({ name: 'Reviewer' }), context)
  assert.equal(clash.handle, 'reviewer')
  assert.match(clash.errors[0]?.message ?? '', /@reviewer is already an agent/u)
  assert.deepEqual(clash.errors[0]?.fix, { kind: 'use-handle', handle: 'reviewer-2', label: 'Use @reviewer-2' })
  // Editing an existing agent keeps its own handle without reporting it as taken.
  assert.deepEqual(AgentEditor.review(AgentEditor.draftOf(reviewer), { ...context, creating: false }).errors, [])
})

test('the review explains a bad memory scope and an empty peer list with a recovery for each', () => {
  const review = AgentEditor.review(draft({ memoryScope: 'bad scope!', delegation: { messaging: 'listed', handles: [], subagents: true } }), context)
  assert.deepEqual(
    review.errors.map(issue => [issue.field, issue.fix?.kind]),
    [
      ['memoryScope', 'clear-memory-scope'],
      ['peers', 'messaging-none'],
    ],
  )
})

test('an unknown peer and a route this Host lacks are warnings, not errors', () => {
  const review = AgentEditor.review(
    draft({ delegation: { messaging: 'listed', handles: ['ghost'], subagents: true }, route: { provider: 'gone', model: 'm' } }),
    context,
  )
  assert.deepEqual(review.errors, [])
  assert.deepEqual(
    review.warnings.map(issue => issue.field),
    ['peers', 'route'],
  )
  assert.equal(review.warnings[1]?.fix?.kind, 'reset-route')
  // Before the catalog loads the route is not reported missing.
  assert.deepEqual(AgentEditor.review(draft({ route: { provider: 'gone', model: 'm' } }), { ...context, catalog: null }).warnings, [])
})

test('long instructions warn that the opening message will clip them', () => {
  const review = AgentEditor.review(draft({ instructions: 'x'.repeat(5_000) }), context)
  assert.equal(review.errors.length, 0)
  assert.match(review.warnings[0]?.message ?? '', /will be cut/u)
})

test('a duplicate keeps the setup under a free handle and its own memory scope', () => {
  const scoped = agent({ handle: 'reviewer', name: 'Reviewer', memoryScope: 'agent:reviewer', instructions: 'Be brief.', enabled: false })
  const copy = AgentEditor.duplicate(scoped, [dsh, scoped, agent({ handle: 'reviewer-copy' })])
  assert.equal(copy.name, 'Reviewer copy')
  assert.equal(copy.handle, 'reviewer-copy-2')
  assert.equal(copy.instructions, 'Be brief.')
  assert.equal(copy.memoryScope, null)
  assert.equal(copy.enabled, true)
})

test('a template fills a new draft and never reuses a taken handle', () => {
  const template = AGENT_TEMPLATES[0]
  assert.ok(template !== undefined)
  const filled = AgentEditor.fromTemplate(template, [dsh, reviewer])
  assert.equal(filled.handle, 'reviewer-2')
  assert.equal(filled.glyph, template.glyph)
  assert.deepEqual(AgentEditor.review(filled, context).errors, [])
})

test('typed handles and peers are normalized the way a handle is stored', () => {
  assert.equal(AgentEditor.typedHandle('Code Reviewer!'), 'code-reviewer')
  assert.deepEqual(AgentEditor.parsePeers('@reviewer, planner  reviewer,'), ['reviewer', 'planner'])
  assert.equal(AgentEditor.routeLabel(null, [luna]), 'Harness default')
  assert.equal(AgentEditor.routeLabel({ provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'high' }, [luna]), 'GPT-6 Luna · high')
  assert.equal(AgentEditor.routeLabel({ provider: 'gone', model: 'raw-model' }, [luna]), 'raw-model')
})
