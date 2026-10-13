import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scoreProbe } from './probes.mjs'

test('restricted recall accepts memory retrieval but rejects filesystem evidence', () => {
  const probe = { id: 'fresh', kind: 'cross-session', expect: ['birch'] }
  assert.equal(scoreProbe({ answer: 'birch', probe, truth: {}, tools: ['functions.memory_search', 'memory_zoom'] }).pass, true)
  const leaked = scoreProbe({ answer: 'birch', probe, truth: {}, tools: ['read'] })
  assert.equal(leaked.pass, false)
  assert.deepEqual(leaked.forbiddenTools, ['read'])
})

test('negative recall requires only the exact unknown marker', () => {
  const probe = { id: 'unknown', kind: 'negative-recall', expect: ['NOT_RECORDED'] }
  assert.equal(scoreProbe({ answer: '`NOT_RECORDED`', probe, truth: {} }).pass, true)
  assert.equal(scoreProbe({ answer: 'NOT_RECORDED, but approved fallback is Acme.', probe, truth: {} }).pass, false)
})

test('analysis probes retain legitimate tool access and forbidden fact checks', () => {
  const probe = { id: 'analysis', kind: 'analysis', expect: ['page 79'], forbid: ['page 84'] }
  assert.equal(scoreProbe({ answer: 'page 79', probe, truth: {}, tools: ['read'] }).pass, true)
  assert.equal(scoreProbe({ answer: 'page 79 or page 84', probe, truth: {} }).pass, false)
})
