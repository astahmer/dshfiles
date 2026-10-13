import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertTaskAcceptance } from './long-task-acceptance.mjs'
import { createLongScenario, scenarioGroundTruth } from './long-scenarios.mjs'
import { scoreProbe } from './probes.mjs'

const names = ['infra-rollout', 'ingestion-incident', 'product-support']

for (const name of names) {
  test(`${name}: long corpus has realistic volume, distinct work packets, three sessions, and no compaction override`, async () => {
    const scenario = createLongScenario({ name })
    const turns = scenario.conversations.flatMap(conversation => conversation.turns)
    assert.equal(scenario.conversations.length, 3)
    assert.equal(turns.length, 68)
    assert.equal(scenario.metadata.turnCount, turns.length)
    assert.ok(scenario.metadata.estimatedPromptTokens >= 100000)
    assert.ok(scenario.metadata.estimatedPromptTokens <= 250000)
    assert.equal(Object.hasOwn(scenario, 'compaction'), false)
    assert.equal(Object.hasOwn(scenario, 'fixture'), false)
    assert.deepEqual(scenario.truth, {})
    const packets = turns.filter(turn => turn.packet !== undefined)
    assert.equal(packets.length, 54)
    assert.equal(new Set(packets.map(turn => `${turn.packet.topic}:${turn.packet.stage}`)).size, 54)
    assert.equal(new Set(packets.map(turn => turn.prompt)).size, 54)
    assert.ok(packets.every(turn => turn.packet.rows === 18))
    const cross = scenario.conversations[2].turns
    assert.equal(cross.filter(turn => turn.probe?.kind === 'cross-session').length, 3)
    assert.equal(cross.filter(turn => turn.probe?.kind === 'negative-recall').length, 1)
    assert.ok(cross.filter(turn => turn.probe !== undefined).every(turn => !turn.prompt.includes('ground-truth.json')))
    assert.ok(turns.findIndex(turn => turn.probe?.kind === 'delayed-recall') >= 20)
    const wrapper = await import(`./scenarios/${name}.mjs`)
    assert.deepEqual(wrapper.createScenario({ rep: 1, variant: 'long' }), scenario)
  })

  test(`${name}: paired repetitions are stable; different seeds alter evidence but not acceptance`, () => {
    for (const rep of [1, 2, 3]) {
      const first = createLongScenario({ name, rep })
      assert.deepEqual(createLongScenario({ name, rep }), first)
      const next = createLongScenario({ name, rep: rep + 1 })
      assert.notEqual(first.metadata.seed, next.metadata.seed)
      assert.notEqual(first.metadata.corpusSha256, next.metadata.corpusSha256)
      assert.deepEqual(first.conversations[2], next.conversations[2])
    }
    const pilot = createLongScenario({ name, variant: 'pilot' })
    assert.equal(pilot.metadata.turnCount, 24)
    assert.equal(pilot.metadata.packetCount, 10)
    assert.equal(pilot.metadata.rowsPerPacket, 5)
    assert.ok(pilot.metadata.estimatedPromptTokens < 25000)
    assert.deepEqual(pilot.conversations[2], createLongScenario({ name }).conversations[2])
  })

  test(`${name}: handoff prompt marks action identifiers as unordered`, () => {
    const scenario = createLongScenario({ name, variant: 'pilot' })
    const handoff = scenario.conversations[2].turns.find(turn => turn.prompt.includes('Write the final executable handoff contract'))
    assert.ok(handoff)
    assert.match(handoff.prompt, /Required action identifiers \(unordered; use project memory to derive their operational order\):/)
    const actions = scenarioGroundTruth({ name }).actions
    assert.ok(handoff.prompt.includes([...actions].reverse().join(', ')))
    assert.equal(handoff.prompt.includes(actions.join(', ')), false)
  })

  test(`${name}: probes accept oracle answers and reject forbidden or missing facts`, () => {
    const scenario = createLongScenario({ name })
    for (const turn of scenario.conversations.flatMap(conversation => conversation.turns)) {
      if (turn.probe === undefined) continue
      const answer = turn.probe.expect.map(item => (Array.isArray(item) ? item[0] : item)).join(' ')
      assert.equal(scoreProbe({ answer, probe: turn.probe, truth: {} }).pass, true, turn.probe.id)
      assert.equal(scoreProbe({ answer: 'UNKNOWN', probe: turn.probe, truth: {} }).pass, false, turn.probe.id)
      for (const forbidden of turn.probe.forbid ?? []) {
        assert.equal(scoreProbe({ answer: `${answer} ${forbidden}`, probe: turn.probe, truth: {} }).pass, false, turn.probe.id)
      }
    }
  })

  test(`${name}: task acceptance rejects superseded values, scope leaks, skipped gates, unsafe order, and destructive rollback`, () => {
    const expected = scenarioGroundTruth({ name })
    assertTaskAcceptance({ name, actual: structuredClone(expected) })
    const field = Object.keys(expected.state)[0]
    const variants = [
      { ...expected, state: { ...expected.state, [field]: { 'infra-rollout': 15, 'ingestion-incident': 84, 'product-support': 30 }[name] } },
      { ...expected, state: { ...expected.state, organization: 'org-driftwood' } },
      { ...expected, actions: [...expected.actions].reverse() },
      { ...expected, prerequisites: expected.prerequisites.slice(1) },
      { ...expected, rejected: [] },
      { ...expected, rollback: { trigger: 'gate-failure', preserveDurableState: false } },
      { ...expected, unapprovedExtra: true },
    ]
    for (const actual of variants) assert.throws(() => assertTaskAcceptance({ name, actual }))
  })
}

test('infra-rollout: second-session correction defines Cedar readiness verification order', () => {
  const scenario = createLongScenario({ name: 'infra-rollout', variant: 'pilot' })
  const correction = scenario.conversations[1].turns[0].prompt
  assert.match(correction, /After cedar activation, verify readiness using private-overlay reachability and a completed collector heartbeat\./)
})

test('generator rejects malformed variant, repetition, and scenario names', () => {
  for (const options of [
    { name: 'not-a-scenario' },
    { name: names[0], variant: 'tiny' },
    { name: names[0], rep: 0 },
    { name: names[0], rep: 1.5 },
    { name: names[0], rep: NaN },
    { name: names[0], rep: 10001 },
  ])
    assert.throws(() => createLongScenario(options))
})

test('real acceptance subprocess reads a project artifact and fails on missing or corrupted deliverables', async () => {
  const project = await mkdtemp(resolve(tmpdir(), 'optmem-long-acceptance-'))
  const acceptance = fileURLToPath(new URL('./acceptance/long-task.test.mjs', import.meta.url))
  const runAcceptance = target =>
    spawnSync(process.execPath, ['--test', acceptance], { cwd: target, env: { PATH: process.env.PATH, BENCH_PROJECT: target }, encoding: 'utf8' })
  assert.notEqual(runAcceptance(project).status, 0, 'missing deliverable must fail')
  for (const name of names) {
    const separateProject = await mkdtemp(resolve(tmpdir(), 'optmem-long-acceptance-'))
    await mkdir(resolve(separateProject, 'deliverables'))
    const artifact = resolve(separateProject, 'deliverables', `${name}.json`)
    await writeFile(artifact, JSON.stringify(scenarioGroundTruth({ name })))
    const result = runAcceptance(separateProject)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const expected = scenarioGroundTruth({ name })
    const changedState = { ...expected, state: { ...expected.state, organization: 'org-driftwood' } }
    await writeFile(artifact, JSON.stringify(changedState))
    const mismatch = runAcceptance(separateProject)
    assert.notEqual(mismatch.status, 0, 'wrong scope must fail acceptance')
    const failedChecks = [...`${mismatch.stdout}\n${mismatch.stderr}`.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1])
    assert.deepEqual(failedChecks, ['long scenario handoff retains effective decisions, types, and scope'])
    await writeFile(artifact, '{broken-json')
    const broken = runAcceptance(separateProject)
    assert.notEqual(broken.status, 0, 'malformed deliverable must fail')
  }
})
