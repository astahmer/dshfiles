import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Agents, type Agent } from './agent.js'
import { AgentMentions } from './agent-mentions.js'
import type { CandidateRequest } from '@dshfiles/input-trigger/client'

const agent = (handle: string, fields: Partial<Agent> = {}): Agent => ({
  ...Agents.builtIn(1),
  handle,
  name: handle.toUpperCase(),
  ...fields,
})

const request = (query: string): CandidateRequest => ({ query, signal: new AbortController().signal, position: 'inline', drilled: false })

const candidatesFor = async (query: string, agents: readonly Agent[]): Promise<readonly string[]> => {
  const source = AgentMentions.createSource({ section: 'Agents', list: async () => agents })
  const rows = await source.candidates({ sessionId: 'session-1' } as never, request(query))
  return rows.map(row => row.name)
}

test('a plain @ stays with files and threads until the query narrows; @agent: lists right away', async () => {
  assert.deepEqual(await candidatesFor('', [agent('dsh'), agent('reviewer')]), [])
  assert.deepEqual(await candidatesFor('re', [agent('dsh'), agent('reviewer')]), ['@reviewer'])
  assert.deepEqual(await candidatesFor('agent:', [agent('dsh'), agent('reviewer')]), ['@dsh', '@reviewer'])
})

test('a scope prefix lists agents only', async () => {
  assert.deepEqual(await candidatesFor('agent:', [agent('dsh'), agent('reviewer')]), ['@dsh', '@reviewer'])
  assert.deepEqual(await candidatesFor('a:rev', [agent('dsh'), agent('reviewer')]), ['@reviewer'])
})

test('another source scope leaves this source empty', async () => {
  assert.deepEqual(await candidatesFor('thread:fix', [agent('dsh')]), [])
  assert.deepEqual(await candidatesFor('b:12', [agent('dsh')]), [])
  assert.deepEqual(await candidatesFor('skill:deploy', [agent('dsh')]), [])
})

test('disabled agents are never offered', async () => {
  assert.deepEqual(await candidatesFor('agent:', [agent('dsh'), agent('reviewer', { enabled: false })]), ['@dsh'])
})

test('a quoted query is a file path, not an agent lookup', async () => {
  const source = AgentMentions.createSource({ section: 'Agents', list: async () => [agent('dsh')] })
  assert.deepEqual(await source.candidates({ sessionId: 'session-1' } as never, { ...request('agent:ds'), quoted: true }), [])
})

test('picking inserts the plain mention text', () => {
  const source = AgentMentions.createSource({ section: 'Agents', list: async () => [] })
  assert.deepEqual(source.onPick?.({ candidate: { name: '@reviewer', section: 'Agents', value: 'reviewer' } } as never), { text: '@reviewer ' })
})

test('rows describe the route and the description', async () => {
  const source = AgentMentions.createSource({
    section: 'Agents',
    list: async () => [agent('reviewer', { route: { provider: 'codex-alex2', model: 'gpt-6-luna' }, description: 'Reviews diffs.' })],
  })
  const rows = await source.candidates({ sessionId: 'session-1' } as never, request('agent:'))
  assert.equal(rows[0]?.description, 'codex-alex2/gpt-6-luna · Reviews diffs.')
})
