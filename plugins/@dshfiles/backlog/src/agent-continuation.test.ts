import assert from 'node:assert/strict'
import { test } from 'vitest'

import { AgentContinuation } from './agent-continuation.js'

const links = [
  { type: 'thread', target: 'session-linked', provenance: 'agent' },
  { type: 'item', target: '4' },
] as const
const threads = [
  { sessionId: 'session-linked', title: 'Linked' },
  { sessionId: 'session-unlinked', title: 'Unlinked' },
] as const

test('only offers an agent thread that is linked to the backlog item', () => {
  assert.deepEqual(AgentContinuation.candidates({ links, threads }), [threads[0]])
})

test('requires both item linkage and exact agent ownership to continue a thread', () => {
  assert.equal(AgentContinuation.ownsLinkedThread({ links, sessionId: 'session-linked', requestedHandle: 'reviewer', ownerHandle: 'reviewer' }), true)
  assert.equal(AgentContinuation.ownsLinkedThread({ links, sessionId: 'session-linked', requestedHandle: 'reviewer', ownerHandle: 'other' }), false)
  assert.equal(AgentContinuation.ownsLinkedThread({ links, sessionId: 'session-unlinked', requestedHandle: 'reviewer', ownerHandle: 'reviewer' }), false)
})
