import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { completedRun, loadScenario, runtimeFingerprint } from './scenario-loader.mjs'

const identity = { scenarioHash: 'scenario', runtimeHash: 'runtime', provider: 'opencode-go-alex', model: 'deepseek-v4.1-flash', effort: '', summaryEffort: '' }
const evidence = { ...identity, arm: 'B', expectedTurns: 1, finishedAt: '2026-10-13T00:00:00Z', turns: [{ end: 'completed' }], drain: { complete: true } }

test('resume requires matching completed, drained implementation evidence', () => {
  assert.equal(completedRun({ evidence, ...identity }), true)
  for (const change of [
    { error: 'failed' },
    { turns: [{ end: 'aborted' }] },
    { turns: [] },
    { drain: { complete: false } },
    { runtimeHash: 'old-runtime' },
    { scenarioHash: 'old-scenario' },
    { summaryEffort: 'low' },
    { finishedAt: undefined },
  ])
    assert.equal(completedRun({ evidence: { ...evidence, ...change }, ...identity }), false)
  assert.equal(completedRun({ evidence: {}, ...identity }), false)
  assert.equal(completedRun({ evidence: null, ...identity }), false)
})

test('native-only completion does not require summary drain', () => {
  assert.equal(completedRun({ evidence: { ...evidence, arm: 'A', drain: undefined }, ...identity }), true)
})

test('static scenario identity is deterministic and validates prompt shape', async () => {
  const path = fileURLToPath(new URL('./scenarios/smoke.json', import.meta.url))
  const first = await loadScenario({ path, rep: 1 })
  const second = await loadScenario({ path, rep: 2 })
  assert.equal(first.scenarioHash, second.scenarioHash)
  assert.equal(first.sourceHash, second.sourceHash)
  assert.equal(first.scenario.conversations[0].turns.length, 2)
})

test('summary ablation uses stock context and includes recall', async () => {
  const loaded = await loadScenario({ path: fileURLToPath(new URL('./scenarios/summary-pilot.mjs', import.meta.url)) })
  assert.equal(loaded.scenario.compaction, undefined)
  assert.ok(loaded.scenario.conversations.length > 1)
  assert.ok(loaded.scenario.conversations.flatMap(conversation => conversation.turns).some(turn => turn.probe))
})

test('module scenarios retain validated packet metadata for tool evidence', async () => {
  const loaded = await loadScenario({
    path: fileURLToPath(new URL('./scenarios/ingestion-coding.mjs', import.meta.url)),
    variant: 'pilot',
  })
  const packets = loaded.scenario.conversations.flatMap(conversation => conversation.turns.filter(turn => turn.packet !== undefined))
  assert.equal(packets.length, 18)
  assert.ok(packets.every(turn => turn.packet.requiresTools && turn.packet.rows === 3))
  assert.ok(packets.every(turn => turn.packet.stage >= 1 && turn.packet.stage <= 3))
})

test('calibration runtime fingerprint includes calibration implementation', async () => {
  const benchmarkHash = await runtimeFingerprint({ arm: 'A' })
  const calibrationHash = await runtimeFingerprint({ arm: 'A', calibration: true })
  assert.notEqual(calibrationHash, benchmarkHash)
})

test('loads the original long scenarios with their named packet stages', async () => {
  const { scenario } = await loadScenario({ path: new URL('./scenarios/infra-rollout.mjs', import.meta.url).pathname, rep: 1, variant: 'pilot' })
  const packets = scenario.conversations.flatMap(conversation => conversation.turns.flatMap(turn => (turn.packet === undefined ? [] : [turn.packet])))
  assert.ok(packets.length > 0)
  assert.ok(packets.every(packet => typeof packet.stage === 'string' && packet.requiresTools === false))
})
