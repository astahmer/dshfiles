import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { diagnoseParentWait } from './parent-cache-wait.mjs'

// Synthetic spans with the pinned traces_get output shape and agent-telemetry attribute names.
const span = (spanId, name, offsetMs, durationMs, attributes, overrides = {}) => ({
  spanId,
  parentSpanId: null,
  depth: 0,
  childCount: 0,
  name,
  service: 'dsh',
  scope: null,
  kind: 'internal',
  offsetMs,
  durationMs,
  status: 'ok',
  statusMessage: null,
  sessionId: attributes['dsh.session.id'] ?? null,
  attributes: Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined)),
  resource: {},
  events: [],
  linkCount: 0,
  ...overrides,
})
const chat = (id, start, attributes = {}, { durationMs = 10, ...overrides } = {}) =>
  span(
    id,
    'chat fixture-model',
    start,
    durationMs,
    {
      'gen_ai.operation.name': 'chat',
      'dsh.session.id': 'parent',
      'dsh.turn': 1,
      'dsh.llm.attempt': 1,
      'dsh.step': 1,
      'gen_ai.provider.name': 'fixture-route',
      'gen_ai.request.model': 'fixture-model',
      ...attributes,
    },
    { kind: 'client', ...overrides },
  )
const tool = (id, name, start, duration, overrides = {}, attributes = {}) =>
  span(
    id,
    `execute_tool ${name}`,
    start,
    duration,
    {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': name,
      'gen_ai.tool.call.id': `call-${id}`,
      'dsh.session.id': 'parent',
      'dsh.turn': 1,
      ...attributes,
    },
    overrides,
  )
const trace = (...spans) => ({ traceId: '00000000000000000000000000000001', startMs: 1_000, durationMs: 700_100, spans })
const diagnostic = (...spans) => diagnoseParentWait(trace(...spans), 'parent').observations

const fixture = () =>
  trace(
    chat('previous', 0),
    tool('spawn', 'subagent', 10, 5),
    tool('ptc', 'run_code', 15, 660_000),
    tool('wait-a', 'wait_agent', 20, 600_000, { parentSpanId: 'ptc', depth: 1 }, { 'dsh.turn': undefined, 'dsh.tool.root_call_id': 'call-ptc' }),
    tool('wait-b', 'wait_agent', 500_020, 150_000),
    chat(
      'child-a',
      30,
      { 'dsh.session.id': 'worker-a', 'dsh.session.parent_id': 'parent', 'gen_ai.usage.cache_creation.input_tokens': 80_000 },
      { durationMs: 600_000 },
    ),
    chat('child-b', 40, { 'dsh.session.id': 'worker-b', 'dsh.session.parent_id': 'parent' }, { durationMs: 650_000 }),
    tool('other-tool', 'bash', 80, 50),
    chat('standalone', 650_040, {
      'dsh.turn': undefined,
      'dsh.step': undefined,
      'dsh.llm.attempt': undefined,
      'dsh.llm.purpose': 'title',
      'dsh.llm.standalone': true,
    }),
    chat('next', 670_000, {
      'dsh.step': 2,
      'gen_ai.usage.input_tokens': 80_000,
      'gen_ai.usage.cache_creation.input_tokens': 42_000,
      'dshx.cost.usd': 0.18,
      'dshx.cost.price_id': 'example/fixture-model',
    }),
    span('turn', 'invoke_agent fixture', 0, 680_000, {
      'gen_ai.operation.name': 'invoke_agent',
      'dsh.session.id': 'parent',
      'dsh.turn': 1,
      'gen_ai.usage.cache_creation.input_tokens': 42_000,
    }),
  )
const json = value => JSON.parse(JSON.stringify(value))

test('one parent observation for overlapping waits; worker and aggregate usage do not count', () => {
  const [only, ...rest] = diagnoseParentWait(json(fixture()), 'parent').observations
  assert.deepEqual(rest, [])
  assert.deepEqual(only, {
    turn: 1,
    previousChatSpanId: 'previous',
    nextChatSpanId: 'next',
    pairwiseAttemptGapMs: 669_990,
    recordedWaitAgentUnionMs: 650_000,
    inboxWaitSpanIds: ['wait-a', 'wait-b'],
    otherToolSpanIdsInGap: ['spawn', 'ptc', 'other-tool'],
    otherParentChatSpanIdsInGap: ['standalone'],
    sameRecordedRoute: true,
    nextChatStatus: 'ok',
    reportedCacheWriteTokens: 42_000,
    nextChatListPriceTotalUsd: 0.18,
    nextChatListPriceCatalogId: 'example/fixture-model',
  })
})

test('missing usage and price stay unknown; explicit zero is distinct', () => {
  const wait = tool('wait', 'wait_agent', 20, 20)
  const [unknown] = diagnostic(chat('a', 0), wait, chat('b', 50, { 'gen_ai.usage.input_tokens': 1 }))
  assert.equal(unknown.reportedCacheWriteTokens, null)
  assert.equal(unknown.nextChatListPriceTotalUsd, null)
  const [zero] = diagnostic(chat('a', 0), wait, chat('b', 50, { 'gen_ai.usage.cache_creation.input_tokens': 0, 'dshx.cost.usd': 0 }))
  assert.equal(zero.reportedCacheWriteTokens, 0)
  assert.equal(zero.nextChatListPriceTotalUsd, 0)
})

test('do not infer waits from spawn, child runtime, failed or unscoped wait, or cross-turn idle', () => {
  const a = chat('a', 0)
  const b = chat('b', 100)
  assert.deepEqual(diagnostic(a, tool('spawn', 'subagent', 20, 50), chat('child', 30, { 'dsh.session.id': 'worker' }), b), [])
  assert.deepEqual(diagnostic(a, tool('failed-wait', 'wait_agent', 20, 50, { status: 'error' }), b), [])
  assert.deepEqual(diagnostic(a, tool('child-wait', 'wait_agent', 20, 50, { parentSpanId: 'a' }, { 'dsh.session.id': 'worker' }), b), [])
  assert.deepEqual(diagnostic(a, tool('wait', 'wait_agent', 20, 50), chat('later-turn', 100, { 'dsh.turn': 2 })), [])
  assert.deepEqual(diagnostic(a, tool('partial', 'wait_agent', 20, 100), b), [])
  assert.deepEqual(diagnostic(a, tool('unparented', 'wait_agent', 20, 50, {}, { 'dsh.turn': 'unknown' }), b), [])
  assert.deepEqual(diagnostic(a, tool('no-resume', 'wait_agent', 20, 50)), [])
})

test('first observed normal chat attempt stays first even if it fails or switches route', () => {
  const [only, ...rest] = diagnostic(
    chat('a', 0),
    tool('wait', 'wait_agent', 20, 50),
    chat('failure', 80, { 'gen_ai.provider.name': 'other-route' }, { status: 'error' }),
    chat('retry', 100, { 'dsh.llm.attempt': 2, 'gen_ai.usage.cache_creation.input_tokens': 25 }),
  )
  assert.deepEqual(rest, [])
  assert.equal(only.nextChatSpanId, 'failure')
  assert.equal(only.nextChatStatus, 'error')
  assert.equal(only.sameRecordedRoute, false)
  assert.equal(only.reportedCacheWriteTokens, null)
})

test('microsecond boundaries include enclosed waits and exclude touching or empty intervals', () => {
  const [only, ...rest] = diagnostic(
    chat('first', 0, {}, { durationMs: 0.1 }),
    tool('before', 'bash', 0, 0.1),
    tool('wait', 'wait_agent', 0.1, 0.2),
    tool('overlapping-wait', 'wait_agent', 0.2, 0.1),
    tool('empty-wait', 'wait_agent', 0.2, 0),
    chat('empty-chat', 0.2, { 'dsh.llm.attempt': undefined }, { durationMs: 0 }),
    chat('next', 0.3, {}, { durationMs: 0, status: 'error' }),
    tool('after', 'bash', 0.3, 0.1),
  )
  assert.deepEqual(rest, [])
  assert.equal(only.pairwiseAttemptGapMs, 0.2)
  assert.equal(only.recordedWaitAgentUnionMs, 0.2)
  assert.deepEqual(only.inboxWaitSpanIds, ['wait', 'overlapping-wait'])
  assert.deepEqual(only.otherToolSpanIdsInGap, [])
  assert.deepEqual(only.otherParentChatSpanIdsInGap, [])
})

test('do not use a zero-duration prior attempt as a known end or silently skip it', () => {
  assert.deepEqual(diagnostic(chat('a', 0), chat('unknown-end', 15, {}, { durationMs: 0 }), tool('wait', 'wait_agent', 20, 20), chat('b', 50)), [])
})

test('earlier overlapping model and unmarked side call do not turn a pairwise gap into inactivity', () => {
  const [only, ...rest] = diagnostic(
    chat('earlier', 0, {}, { durationMs: 100 }),
    chat('previous', 15, {}, { durationMs: 5 }),
    tool('wait', 'wait_agent', 20, 40),
    chat('unmarked-side-call', 30, { 'dsh.llm.attempt': undefined }),
    chat('next', 60),
  )
  assert.deepEqual(rest, [])
  assert.equal(only.previousChatSpanId, 'previous')
  assert.equal(only.nextChatSpanId, 'next')
  assert.equal(only.pairwiseAttemptGapMs, 40)
  assert.equal(only.recordedWaitAgentUnionMs, 40)
  assert.deepEqual(only.otherParentChatSpanIdsInGap, ['earlier', 'unmarked-side-call'])
})

test('CLI accepts a normalized trace on stdin and emits no raw attributes', () => {
  const input = json(fixture())
  input.spans[0].attributes['gen_ai.input.messages'] = 'synthetic string that must not be echoed'
  const script = fileURLToPath(new URL('./parent-cache-wait.mjs', import.meta.url))
  const result = execFileSync(process.execPath, [script, 'parent'], { input: JSON.stringify(input), encoding: 'utf8' })
  assert.ok(!result.includes('synthetic string'))
  assert.equal(JSON.parse(result).observations.length, 1)
  assert.throws(() => diagnoseParentWait({ ...input, spans: [input.spans[0], input.spans[0]] }, 'parent'), /duplicate/i)
  input.spans[0].durationMs = -1
  const malformed = spawnSync(process.execPath, [script, 'parent'], { input: JSON.stringify(input), encoding: 'utf8' })
  assert.equal(malformed.status, 1)
  assert.equal(malformed.stdout, '')
  assert.ok(!malformed.stderr.includes('synthetic string'))
})
