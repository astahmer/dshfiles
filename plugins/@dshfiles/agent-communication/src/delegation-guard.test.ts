import assert from 'node:assert/strict'
import { test } from 'vitest'
import { CommunicationDelegation, type DelegationSender } from './delegation-guard.js'

const sender = (messaging: 'any' | 'listed' | 'none', handles: readonly string[] = []): DelegationSender => ({
  handle: 'orchestrator',
  delegation: { messaging, handles: [...handles], subagents: true },
})

test('a thread no agent started keeps messaging unrestricted', () => {
  assert.deepEqual(CommunicationDelegation.direct({ sender: null, targetHandle: 'reviewer' }), { allowed: true })
  assert.deepEqual(CommunicationDelegation.broadcast({ sender: null }), { allowed: true })
})

test('any lets every peer through, none refuses, listed narrows to its handles', () => {
  assert.deepEqual(CommunicationDelegation.direct({ sender: sender('any'), targetHandle: 'reviewer' }), { allowed: true })
  assert.deepEqual(CommunicationDelegation.direct({ sender: sender('none'), targetHandle: 'reviewer' }), {
    allowed: false,
    reason: '@orchestrator may not message other Agents.',
  })
  assert.deepEqual(CommunicationDelegation.direct({ sender: sender('listed', ['reviewer']), targetHandle: 'reviewer' }), { allowed: true })
  const refused = CommunicationDelegation.direct({ sender: sender('listed', ['reviewer']), targetHandle: 'planner' })
  assert.equal(refused.allowed, false)
  assert.match(refused.allowed === false ? refused.reason : '', /only message @reviewer, not @planner/u)
  assert.equal(CommunicationDelegation.direct({ sender: sender('listed', ['reviewer']), targetHandle: null }).allowed, false)
})

test('a topic has no single peer, so listed cannot narrow a broadcast', () => {
  assert.deepEqual(CommunicationDelegation.broadcast({ sender: sender('any') }), { allowed: true })
  assert.deepEqual(CommunicationDelegation.broadcast({ sender: sender('listed', []) }), { allowed: true })
  assert.equal(CommunicationDelegation.broadcast({ sender: sender('none') }).allowed, false)
})

test('the subagent setting does not widen or narrow direct messaging', () => {
  const noSubagents = { ...sender('listed', ['reviewer']), delegation: { messaging: 'listed' as const, handles: ['reviewer'], subagents: false } }
  assert.deepEqual(CommunicationDelegation.direct({ sender: noSubagents, targetHandle: 'reviewer' }), { allowed: true })
})
