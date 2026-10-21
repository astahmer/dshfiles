import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AgentScope, type AgentScopeLookup } from './agent-scope.ts'

const lookupOf = (agents: Record<string, { memoryScope: string | null }>, parents: Record<string, string>): AgentScopeLookup => ({
  threadAgent: async sessionId => agents[sessionId] ?? null,
  parentOf: async sessionId => parents[sessionId],
})

test('a subagent inherits the scope of the agent whose thread spawned it', () => {
  const lookup = lookupOf({ 'session-root': { memoryScope: 'agent:reviewer' } }, { 'session-child': 'session-root' })
  return AgentScope.resolve({ sessionId: 'session-child', lookup }).then(scope => assert.equal(scope, 'agent:reviewer'))
})

test('a chain is followed for a bounded number of hops', () => {
  const parents: Record<string, string> = { 'session-3': 'session-2', 'session-2': 'session-1', 'session-1': 'session-root', 'session-root': 'session-above' }
  const lookup = lookupOf({ 'session-above': { memoryScope: 'agent:planner' } }, parents)
  return Promise.all([
    AgentScope.resolve({ sessionId: 'session-3', lookup }),
    // One hop further than the cap: the scope is not found and the project block serves.
    AgentScope.resolve({
      sessionId: 'session-3',
      lookup: { ...lookup, parentOf: async id => (id === 'session-2' ? 'session-1' : id === 'session-1' ? 'session-root' : undefined) },
    }),
  ]).then(([found, capped]) => {
    assert.equal(found, 'agent:planner')
    assert.equal(capped, null)
  })
})

test('an agent thread with no scope stops the walk instead of borrowing its own parent', async () => {
  const lookup = lookupOf({ 'session-child': { memoryScope: null }, 'session-root': { memoryScope: 'agent:reviewer' } }, { 'session-child': 'session-root' })
  assert.equal(await AgentScope.resolve({ sessionId: 'session-child', lookup }), null)
})

test('a thread no agent started, or a parent that is gone, reads the project block', async () => {
  assert.equal(await AgentScope.resolve({ sessionId: 'session-plain', lookup: lookupOf({}, {}) }), null)
  assert.equal(await AgentScope.resolve({ sessionId: 'session-orphan', lookup: lookupOf({}, { 'session-orphan': 'session-missing' }) }), null)
})
