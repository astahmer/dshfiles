import assert from 'node:assert/strict'
import test from 'node:test'
import * as agent from '@deepseek-ai/dsh-agent'
import * as agentLoop from '@deepseek-ai/dsh-agent-loop'
import * as session from '@deepseek-ai/dsh-session'
import * as sessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import agentEntry from '../lib/agent.js'
import agentLoopEntry from '../lib/agent-loop.js'
import sessionEntry from '../lib/session.js'
import sessionPersistenceJsonlEntry from '../lib/session-persistence-jsonl.js'

test('replacement entrypoints forward the local core module identities', () => {
  assert.equal(agentEntry, agent.default)
  assert.equal(agentLoopEntry, agentLoop.default)
  assert.equal(sessionEntry, session.default)
  assert.equal(sessionPersistenceJsonlEntry, sessionPersistenceJsonl.default)
})
