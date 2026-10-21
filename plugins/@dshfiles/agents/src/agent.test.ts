import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AGENT_HANDLE_PATTERN, Agents, MAX_MESSAGE_CHARS, type Agent, type AgentDraft } from './agent.js'

const agent = (fields: Partial<Agent> = {}): Agent => ({
  ...Agents.builtIn(1),
  builtIn: false,
  ...fields,
})

const draft = (fields: Partial<AgentDraft> = {}): AgentDraft => ({
  handle: 'reviewer',
  name: 'Reviewer',
  glyph: '🔍',
  description: 'Reads diffs for bugs.',
  instructions: 'Prefer small, falsifiable findings.',
  preset: 'standard',
  route: { provider: 'codex-alex2', model: 'gpt-6-luna' },
  memoryScope: null,
  routine: '',
  enabled: true,
  ...fields,
})

test('handles are mentionable slugs', () => {
  assert.equal(Agents.handleFrom('Frontend Engineer'), 'frontend-engineer')
  assert.equal(Agents.handleFrom('  @@  '), 'agent')
  assert.equal(Agents.handleFrom('a'.repeat(80)), 'a'.repeat(32))
  assert.match(Agents.handleFrom('Reviewer'), AGENT_HANDLE_PATTERN)
})

test('parses only a leading mention', () => {
  assert.deepEqual(Agents.parseMention('@reviewer look at b:12'), { handle: 'reviewer', text: 'look at b:12' })
  assert.deepEqual(Agents.parseMention('  @dsh'), { handle: 'dsh', text: '' })
  assert.equal(Agents.parseMention('pony @reviewer look'), null)
  assert.equal(Agents.parseMention('email me at foo@reviewer'), null)
  assert.equal(Agents.parseMention('@Reviewer upper'), null)
  assert.equal(Agents.mentionedHandle('@frontend fix the nav'), 'frontend')
})

test('agent scope owns only its own prefixes', () => {
  assert.equal(Agents.isScopedToAgents('agent:rev'), true)
  assert.equal(Agents.isScopedToAgents('a:rev'), true)
  assert.equal(Agents.isScopedToAgents('A:rev'), true)
  assert.equal(Agents.isScopedToAgents('thread:rev'), false)
  assert.equal(Agents.isScopedToAgents('rev'), false)
})

test('the built-in agent pins nothing, so it means the harness default', () => {
  const builtIn = Agents.builtIn(5)
  assert.equal(builtIn.handle, 'dsh')
  assert.equal(builtIn.builtIn, true)
  assert.equal(builtIn.preset, null)
  assert.equal(builtIn.route, null)
  assert.equal(builtIn.instructions, '')
})

test('the opening message carries identity, instructions and the task', () => {
  const message = Agents.openingMessage({ agent: agent(draft()), text: 'review b:119', fallback: 'ignored' })
  assert.match(message, /^Work as @reviewer — Reviewer\./u)
  assert.match(message, /Reads diffs for bugs\./u)
  assert.match(message, /Prefer small, falsifiable findings\./u)
  assert.match(message, /---\n\nreview b:119$/u)
})

test('the opening message falls back to the dispatch prompt and stays bounded', () => {
  const long = Agents.openingMessage({ agent: agent({ instructions: 'x'.repeat(9_000) }), text: '', fallback: 'Work on b:7: fix it' })
  assert.equal(long.length, MAX_MESSAGE_CHARS)
  assert.match(long, /^Work as @dsh — DSH\./u)
  assert.match(long, /Work on b:7: fix it$/u)
})

test('the built-in agent leads the list, then names sort', () => {
  const ordered = Agents.order([agent(draft({ name: 'Zed', handle: 'zed' })), Agents.builtIn(1), agent(draft({ name: 'Alpha', handle: 'alpha' }))])
  assert.deepEqual(
    ordered.map(entry => entry.handle),
    ['dsh', 'alpha', 'zed'],
  )
})

test('a creating draft derives its handle from the name', () => {
  const normalized = Agents.normalizeDraft(draft({ handle: '', name: 'Bug Hunter' }), { creating: true })
  assert.equal(normalized.handle, 'bug-hunter')
  const renamed = Agents.normalizeDraft(draft({ handle: 'bug-hunter' }), { creating: false })
  assert.equal(renamed.handle, 'bug-hunter')
})

test('a memory scope is the agent’s own note scope, absent by default', () => {
  assert.equal(Agents.builtIn(1).memoryScope, null)
  assert.equal(Agents.defaultMemoryScope('reviewer'), 'agent:reviewer')
  assert.equal(Agents.normalizeDraft(draft({ memoryScope: '  agent:reviewer  ' }), { creating: false }).memoryScope, 'agent:reviewer')
  assert.equal(Agents.normalizeDraft(draft({ memoryScope: '   ' }), { creating: false }).memoryScope, null)
})

test('a routine rides the opening message and points at the schedule tools', () => {
  const message = Agents.openingMessage({
    agent: agent({ routine: 'Every weekday at 09:00, summarise open reviews.' }),
    text: 'start the routine',
    fallback: 'ignored',
  })
  assert.match(message, /Routine: Every weekday at 09:00, summarise open reviews\./u)
  assert.match(message, /schedule_create/u)
  assert.match(message, /---\n\nstart the routine$/u)
  assert.equal(Agents.routineSection('   '), '')
})

test('thread titles come from the first line of the prompt', () => {
  assert.equal(Agents.title('Fix the flaky test\n\nreason: race'), 'Fix the flaky test')
  assert.equal(Agents.title('   '), 'New thread')
})
