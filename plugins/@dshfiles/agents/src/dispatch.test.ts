import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Agents, type Agent } from './agent.js'
import { AgentDispatch, type AgentThreadTarget } from './dispatch.js'

const agent = (fields: Partial<Agent> = {}): Agent => ({
  ...Agents.builtIn(1),
  ...fields,
})

const catalog = {
  default: { provider: 'opencode-go_mathias', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
  routableProviders: ['codex-alex2', 'opencode-go_mathias'],
  failures: [],
  groups: [
    {
      id: 'codex-alex2',
      name: 'Codex Alex2',
      models: [
        {
          id: 'gpt-6-luna',
          name: 'GPT-6 Luna',
          reasoning: {
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'max', name: 'Max' },
            ],
            defaultEffort: 'max',
          },
        },
      ],
    },
    {
      id: 'opencode-go_mathias',
      name: 'OpenCode Go Mathias',
      models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }],
    },
  ],
}

test('decodes the Host catalog into routable rows and the default key', () => {
  const decoded = AgentDispatch.catalog(catalog)
  assert.deepEqual(
    decoded.options.map(option => option.key),
    ['codex-alex2/gpt-6-luna', 'opencode-go_mathias/deepseek-v4.1-flash'],
  )
  assert.equal(decoded.defaultKey, 'opencode-go_mathias/deepseek-v4.1-flash')
  assert.deepEqual(decoded.options[0]?.efforts, ['low', 'max'])
  assert.equal(decoded.options[0]?.defaultEffort, 'max')
})

test('a catalog without the default keeps no default key', () => {
  const decoded = AgentDispatch.catalog({ ...catalog, default: { provider: 'gone', model: 'gone' } })
  assert.equal(decoded.defaultKey, null)
})

test('creation arguments follow the target', () => {
  const project: AgentThreadTarget = { kind: 'project', projectId: 'ws-1' as never }
  assert.deepEqual(AgentDispatch.creationArgs(project, undefined), { workspaceId: 'ws-1' })
  assert.deepEqual(AgentDispatch.creationArgs({ kind: 'cwd', path: '/tmp/repo' }, undefined), { cwd: '/tmp/repo' })
  assert.deepEqual(AgentDispatch.creationArgs({ kind: 'default' }, undefined), {})
  assert.deepEqual(AgentDispatch.creationArgs({ kind: 'default' }, 'ws-default' as never), { workspaceId: 'ws-default' })
})

test('the opening message names the agent and carries the prompt', () => {
  const message = AgentDispatch.openingMessage({
    agent: agent({ handle: 'reviewer', name: 'Reviewer', instructions: 'Be picky.' }),
    prompt: 'Review b:9',
    target: { kind: 'default' },
  })
  assert.match(message, /^Work as @reviewer — Reviewer\./u)
  assert.match(message, /Be picky\./u)
  assert.match(message, /Review b:9$/u)
})

test('an empty prompt still asks the agent to inspect first', () => {
  const message = AgentDispatch.openingMessage({ agent: agent({ handle: 'dsh' }), prompt: '', target: { kind: 'default' } })
  assert.match(message, /Inspect the current workspace/u)
})

test('the title falls back to the agent name', () => {
  assert.equal(AgentDispatch.title({ agent: agent({ name: 'Reviewer' }), prompt: '', target: { kind: 'default' } }), 'Reviewer')
  assert.equal(AgentDispatch.title({ agent: agent({ name: 'Reviewer' }), prompt: 'Fix nav\nmore', target: { kind: 'default' } }), 'Fix nav')
})

test('narrows the schedule catalog to one agent’s threads', () => {
  const rows = AgentDispatch.schedules(
    [
      { id: 'schedule-1', sessionId: 'session-a', title: 'Daily review', status: 'active' },
      { id: 'schedule-2', sessionId: 'session-b', title: 'Someone else', status: 'active' },
      { id: 'schedule-3', sessionId: 'session-a', status: 'inactive' },
    ],
    ['session-a'],
  )
  assert.deepEqual(rows, [
    { id: 'schedule-1', sessionId: 'session-a', title: 'Daily review', status: 'active' },
    { id: 'schedule-3', sessionId: 'session-a', title: 'Reminder', status: 'inactive' },
  ])
})
