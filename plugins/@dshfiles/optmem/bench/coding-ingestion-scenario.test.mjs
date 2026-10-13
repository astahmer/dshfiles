import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateFixture } from './fixtures.mjs'
import { prepareFixture } from './fixtures/ingestion-coding/prepare.mjs'
import { createScenario } from './scenarios/ingestion-coding.mjs'
import { scoreProbe } from './probes.mjs'

const acceptance = fileURLToPath(new URL('./acceptance/coding-ingestion.test.mjs', import.meta.url))
const referenceDirectory = fileURLToPath(new URL('./fixtures/ingestion-coding/reference/', import.meta.url))
const runAcceptance = project =>
  spawnSync(process.execPath, ['--test', '--test-reporter=tap', acceptance], {
    cwd: project,
    env: { PATH: process.env.PATH, BENCH_PROJECT: project },
    encoding: 'utf8',
    timeout: 60000,
  })
const candidate = async () => {
  const project = await mkdtemp(join(tmpdir(), 'optmem-coding-candidate-'))
  await generateFixture('ingestion-coding', project)
  return project
}
const applyReference = async project => {
  await cp(referenceDirectory, resolve(project, 'src'), { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(project, 'package.json'), 'utf8'))
  await writeFile(resolve(project, 'package.json'), JSON.stringify({ ...manifest, version: '0.2.0' }))
  await writeFile(resolve(project, 'CHANGELOG.md'), '# 0.2.0\n\nCorrected scope isolation, bounded retry, and partial-result preservation.\n')
}

test('coding scenario has a large deterministic 65-turn corpus and actual tool work throughout three sessions', () => {
  const scenario = createScenario()
  const turns = scenario.conversations.flatMap(conversation => conversation.turns)
  assert.deepEqual(
    scenario.conversations.map(conversation => conversation.turns.length),
    [21, 20, 24],
  )
  assert.equal(turns.length, 65)
  assert.equal(scenario.metadata.turnCount, 65)
  assert.ok(
    scenario.conversations.every(
      conversation => conversation.turns[0].prompt.includes('DSH_HOME') && conversation.turns[0].prompt.includes('Never decompress or reconstruct'),
    ),
  )
  assert.equal(scenario.fixture, 'ingestion-coding')
  assert.equal(scenario.acceptance, 'acceptance/coding-ingestion.test.mjs')
  assert.equal(Object.hasOwn(scenario, 'compaction'), false)
  assert.deepEqual(scenario.truth, {})
  assert.ok(scenario.metadata.estimatedPromptTokens >= 100000)
  assert.ok(scenario.metadata.estimatedPromptTokens <= 250000)
  const packets = turns.filter(turn => turn.packet !== undefined)
  assert.equal(packets.length, 54)
  assert.equal(new Set(packets.map(turn => `${turn.packet.topic}:${turn.packet.stage}`)).size, 54)
  assert.ok(packets.every(turn => turn.packet.requiresTools && turn.prompt.includes('real Node tests')))
  assert.ok(turns.filter(turn => turn.probe === undefined).every(turn => /run|test/i.test(turn.prompt)))
  assert.equal(turns.filter(turn => turn.probe?.kind === 'cross-session').length, 3)
  assert.equal(turns.filter(turn => turn.probe?.kind === 'negative-recall').length, 1)
  assert.ok(turns.findIndex(turn => turn.probe?.kind === 'delayed-recall') >= 20)
})

test('paired seeds reproduce exact corpus; pilot preserves corrections, module contract, and hidden acceptance', () => {
  for (const rep of [1, 2, 3]) {
    assert.deepEqual(createScenario({ rep }), createScenario({ rep }))
    assert.notEqual(createScenario({ rep }).metadata.corpusSha256, createScenario({ rep: rep + 1 }).metadata.corpusSha256)
  }
  const pilot = createScenario({ variant: 'pilot' })
  assert.equal(pilot.metadata.turnCount, 29)
  assert.equal(pilot.metadata.packetCount, 18)
  assert.ok(pilot.metadata.estimatedPromptTokens < 30000)
  assert.equal(pilot.acceptance, createScenario().acceptance)
  assert.ok(pilot.conversations[0].turns.some(turn => turn.prompt.includes('four TOTAL attempts')))
  assert.ok(pilot.conversations[1].turns.some(turn => turn.prompt.includes('newer observedAt always wins')))
  assert.ok(pilot.conversations[2].turns.some(turn => turn.prompt.includes('0.2.0')))
  for (const options of [{ rep: 0 }, { rep: NaN }, { rep: 10001 }, { variant: 'tiny' }]) assert.throws(() => createScenario(options))
})

test('exact and negative recall probes accept ground truth and reject superseded answers', () => {
  for (const turn of createScenario().conversations.flatMap(conversation => conversation.turns)) {
    if (turn.probe === undefined) continue
    const answer = turn.probe.expect.map(item => (Array.isArray(item) ? item[0] : item)).join(' ')
    assert.equal(scoreProbe({ answer, probe: turn.probe, truth: {} }).pass, true)
    assert.equal(scoreProbe({ answer: 'UNKNOWN', probe: turn.probe, truth: {} }).pass, false)
    for (const forbidden of turn.probe.forbid ?? []) assert.equal(scoreProbe({ answer: `${answer} ${forbidden}`, probe: turn.probe, truth: {} }).pass, false)
  }
})

test('preparation copies runnable prototype only and refuses to overwrite an existing fixture', async () => {
  const project = await candidate()
  assert.deepEqual((await readdir(project)).sort(), ['CHANGELOG.md', 'README.md', 'examples', 'package.json', 'src', 'test'].sort())
  const files = await readdir(resolve(project, 'src'))
  assert.equal(files.includes('errors.js'), false, 'reference-only files must stay outside model project')
  const smoke = spawnSync(process.execPath, ['--test', resolve(project, 'test/smoke.test.js')], {
    cwd: project,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(smoke.status, 0, smoke.stdout + smoke.stderr)
  assert.match(smoke.stdout, /# pass 2/)
  const cli = spawnSync(
    process.execPath,
    [
      resolve(project, 'src/cli.js'),
      '--state',
      resolve(project, 'example-state.json'),
      '--organization',
      'org-riverglass',
      '--provider',
      'paperfin',
      '--responses',
      resolve(project, 'examples/responses.json'),
    ],
    { cwd: project, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000 },
  )
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).result.recordCount, 1)
  const before = await readFile(resolve(project, 'src/store.js'), 'utf8')
  await assert.rejects(() => prepareFixture({ project }))
  assert.equal(await readFile(resolve(project, 'src/store.js'), 'utf8'), before)
})

test('hidden acceptance fails the smoke-green prototype and passes an independently authored actual reference implementation', async context => {
  const project = await candidate()
  const baseline = runAcceptance(project)
  assert.notEqual(baseline.status, 0, 'prototype must not pass hidden acceptance')
  assert.ok(Number(/# fail (\d+)/.exec(baseline.stdout)?.[1] ?? 0) >= 10, baseline.stdout + baseline.stderr)
  await writeFile(resolve(project, 'baseline-acceptance.log'), baseline.stdout + baseline.stderr)
  await applyReference(project)
  const verified = runAcceptance(project)
  await writeFile(resolve(project, 'reference-acceptance.log'), verified.stdout + verified.stderr)
  assert.equal(verified.status, 0, verified.stdout + verified.stderr)
  assert.match(verified.stdout, /# fail 0/)
  const brokenReport = await readFile(fileURLToPath(new URL('./fixtures/ingestion-coding/project/src/report.js', import.meta.url)), 'utf8')
  await writeFile(resolve(project, 'src/report.js'), brokenReport)
  const regression = runAcceptance(project)
  assert.notEqual(regression.status, 0, 'real report scope regression must fail independently of source acceptance')
  assert.match(regression.stdout, /not ok \d+ - reports reveal only the selected scope/)
  context.diagnostic(
    JSON.stringify({
      baselineFailures: Number(/# fail (\d+)/.exec(baseline.stdout)?.[1]),
      referencePasses: Number(/# pass (\d+)/.exec(verified.stdout)?.[1]),
      referenceFailures: Number(/# fail (\d+)/.exec(verified.stdout)?.[1]),
      reportRegressionFailures: Number(/# fail (\d+)/.exec(regression.stdout)?.[1]),
    }),
  )
})
