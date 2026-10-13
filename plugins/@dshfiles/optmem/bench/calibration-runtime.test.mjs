import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runCalibration } from './calibration-runtime.mjs'

const chunks = ({ text, finish = 'stop', usage = {}, reasoning = 'checked facts' }) => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-start', index: 1, blockType: 'reasoning' },
  { type: 'reasoning-delta', index: 1, text: reasoning },
  { type: 'usage', usage },
  { type: 'finish', reason: { kind: finish } },
]

test('calibration retries output-limited calls and accounts all provider usage', async () => {
  const records = []
  const calls = []
  const answers = [
    { text: 'Mira Va', finish: 'max-tokens', usage: { inputTokens: 10, cacheReadTokens: 2, outputTokens: 20, reasoningTokens: 4 } },
    { text: 'Mira Vale: birch before cedar; 37 minutes.', usage: { inputTokens: 11, cacheReadTokens: 3, outputTokens: 21, reasoningTokens: 5 } },
  ]

  await runCalibration({
    cases: [{ id: 'infra', kind: 'leaf', input: ['Mira Vale owns rollout'], maxBytes: 128, expect: ['Mira Vale', '37 minutes'] }],
    variants: [{ id: 'baseline', initialBudget: 2_048, maxBudget: 4_096, instructions: () => 'summary only' }],
    sessionId: 'session-calibration-test',
    provider: 'opencode-go-alex',
    model: 'deepseek-v4.1-flash',
    stream: async function* (call) {
      calls.push(call)
      for (const chunk of chunks(answers[calls.length - 1])) yield chunk
    },
    write: record => records.push(record),
  })

  assert.deepEqual(
    calls.map(call => call.maxTokens),
    [2_048, 4_096],
  )
  assert.ok(calls.every(call => call.purpose === 'compaction'))
  const endings = records.filter(record => record.kind === 'calibration-call-end')
  assert.deepEqual(
    endings.map(record => record.finish),
    ['max-tokens', 'stop'],
  )
  assert.equal(endings[0].reasoningTextBytes, Buffer.byteLength('checked facts'))
  const result = records.find(record => record.kind === 'calibration-end')
  assert.equal(result.complete, true)
  assert.equal(result.quality.pass, true)
  assert.deepEqual(result.usage, { inputTokens: 21, cacheReadTokens: 5, outputTokens: 41, reasoningTokens: 9 })
})

test('calibration uses the configured retry cap without raising its first budget', async () => {
  const records = []
  const calls = []
  const answers = [{ text: 'partial', finish: 'max-tokens' }, { text: 'note' }]

  await runCalibration({
    cases: [{ id: 'stress', kind: 'leaf', input: ['source'], maxBytes: 128, expect: ['note'] }],
    variants: [{ id: 'retry-only', initialBudget: 2_048, maxBudget: 8_192, retryBudget: 8_192, instructions: () => 'summary only' }],
    sessionId: 'session-calibration-test',
    provider: 'opencode-go-alex',
    model: 'deepseek-v4.1-flash',
    stream: async function* (call) {
      calls.push(call)
      for (const chunk of chunks(answers[calls.length - 1])) yield chunk
    },
    write: record => records.push(record),
  })

  assert.deepEqual(
    calls.map(call => call.maxTokens),
    [2_048, 8_192],
  )
  assert.equal(records.find(record => record.kind === 'calibration-end').quality.pass, true)
})

test('calibration counterbalances variant order between repetitions', async () => {
  const records = []

  await runCalibration({
    cases: [{ id: 'tiny', kind: 'leaf', input: ['one fact'], maxBytes: 64, expect: ['one fact'] }],
    variants: [
      { id: 'first', initialBudget: 2_048, maxBudget: 4_096, instructions: () => 'first' },
      { id: 'second', initialBudget: 2_048, maxBudget: 4_096, instructions: () => 'second' },
    ],
    sessionId: 'session-calibration-test',
    provider: 'opencode-go-alex',
    model: 'deepseek-v4.1-flash',
    repetitions: 2,
    stream: async function* () {
      for (const chunk of chunks({ text: 'one fact' })) yield chunk
    },
    write: record => records.push(record),
  })

  assert.deepEqual(
    records.filter(record => record.kind === 'calibration-end').map(record => [record.rep, record.variant]),
    [
      [1, 'first'],
      [1, 'second'],
      [2, 'second'],
      [2, 'first'],
    ],
  )
})

test('calibration sends a variant to its own summary route', async () => {
  const calls = []
  const records = []
  await runCalibration({
    cases: [{ id: 'route', kind: 'leaf', input: ['Mira Vale owns rollout'], maxBytes: 128, expect: ['Mira Vale'] }],
    variants: [
      { id: 'agent-route', initialBudget: 2_048, maxBudget: 4_096, instructions: () => 'summary only' },
      {
        id: 'luna-off',
        provider: 'codex-alex2',
        model: 'gpt-6-luna',
        reasoningEffort: 'off',
        initialBudget: 2_048,
        maxBudget: 4_096,
        instructions: () => 'summary only',
      },
    ],
    sessionId: 'session-calibration-test',
    provider: 'opencode-go-alex',
    model: 'deepseek-v4.1-flash',
    stream: async function* (call) {
      calls.push(call)
      for (const chunk of chunks({ text: 'Mira Vale owns rollout.' })) yield chunk
    },
    write: record => records.push(record),
  })

  assert.deepEqual(
    calls.map(call => [call.provider, call.model, call.reasoningEffort]),
    [
      ['opencode-go-alex', 'deepseek-v4.1-flash', undefined],
      ['codex-alex2', 'gpt-6-luna', 'off'],
    ],
  )
  assert.deepEqual(
    records.filter(record => record.kind === 'calibration-call-end').map(record => record.model),
    ['deepseek-v4.1-flash', 'gpt-6-luna'],
  )
})
