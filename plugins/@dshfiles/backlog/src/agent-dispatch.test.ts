import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Agents, type Agent } from '@dshfiles/agents/contract'

import { AgentComments } from './agent-dispatch.js'
import { defaultTargetFor, type StartThreadItem } from './start-thread.js'

const item: StartThreadItem = { id: 12, title: 'Fix the flaky test', preview: 'reason: race', project: '/Users/astahmer/dev/dshfiles' }

const agent = (fields: Partial<Agent> = {}): Agent => ({
  ...Agents.builtIn(1),
  handle: 'reviewer',
  name: 'Reviewer',
  instructions: 'Prefer small findings.',
  preset: 'standard',
  route: { provider: 'codex-alex2', model: 'gpt-6-luna', reasoningEffort: 'high' },
  ...fields,
})

test('a leading mention splits the handle from the task', () => {
  assert.deepEqual(AgentComments.mention('@reviewer look at b:12'), { handle: 'reviewer', task: 'look at b:12' })
  assert.deepEqual(AgentComments.mention('@dsh'), { handle: 'dsh', task: '' })
  assert.equal(AgentComments.mention('please ask @reviewer later'), null)
  assert.equal(AgentComments.mention('no mention here'), null)
})

test('an agent comment starts on the agent preset, route and instructions', () => {
  const request = AgentComments.request({ items: [item], agent: agent(), task: 'look at b:12', target: { kind: 'default' } })
  assert.deepEqual(request.agent, {
    handle: 'reviewer',
    name: 'Reviewer',
    instructions: 'Prefer small findings.',
    preset: 'standard',
    route: { provider: 'codex-alex2', model: 'gpt-6-luna', reasoningEffort: 'high' },
  })
  assert.equal(request.provider, null)
  assert.equal(request.model, null)
  assert.equal(request.send, true)
  assert.match(request.message, /^Work as @reviewer — Reviewer\./u)
  assert.match(request.message, /Work on b:12: Fix the flaky test/u)
  assert.match(request.message, /look at b:12$/u)
})

test('an agent comment with no task still names the item it came from', () => {
  const request = AgentComments.request({ items: [item], agent: agent(), task: '', target: { kind: 'default' } })
  assert.match(request.message, /Work on b:12: Fix the flaky test\n\nreason: race$/u)
})

test('a chosen agent composes its identity, instructions and task', () => {
  const message = AgentComments.opening(agent(), 'look at b:12')
  assert.match(message, /^Work as @reviewer — Reviewer\./u)
  assert.match(message, /Prefer small findings\./u)
  assert.match(message, /---\n\nlook at b:12$/u)
})

test('the built-in agent pins no route, so the Host default serves it', () => {
  const request = AgentComments.request({
    items: [item],
    agent: agent({ handle: 'dsh', name: 'DSH', preset: null, route: null }),
    task: 'go',
    target: { kind: 'default' },
  })
  assert.equal(request.agent?.route, null)
  assert.equal(request.agent?.preset, null)
  assert.match(request.message, /^Work as @dsh — DSH\./u)
})

test('the item target follows its project, not the Host default', () => {
  const projects = [
    { id: 'ws-dshfiles' as never, title: 'dshfiles', path: '/Users/astahmer/dev/dshfiles' },
    { id: 'ws-other' as never, title: 'other', path: '/Users/astahmer/dev/other' },
  ]
  assert.deepEqual(defaultTargetFor([item], projects), { kind: 'project', projectId: 'ws-dshfiles' })
  assert.deepEqual(defaultTargetFor([{ ...item, project: '/tmp/bare' }], projects), { kind: 'cwd', path: '/tmp/bare' })
  assert.deepEqual(defaultTargetFor([{ ...item, project: null }], projects), { kind: 'default' })
})
