import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const report = fileURLToPath(new URL('./report.mjs', import.meta.url))
const withEvidence = async operation => {
  const directory = await mkdtemp(join(tmpdir(), 'optmem-report-test-'))
  try {
    await operation(directory)
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir(), 'optmem-report-test-')))
    await rm(directory, { recursive: true, force: true })
  }
}
const writeRun = async ({ directory, rep = 1, arm = 'B', ...changes }) => {
  const runId = `smoke-${arm}-r${rep}`
  const evidence = {
    runId,
    scenario: 'smoke',
    arm,
    rep,
    provider: 'opencode-go-alex',
    model: 'deepseek-v4.1-flash',
    runtimeHash: 'runtime',
    sourceHash: 'source',
    scenarioHash: 'scenario',
    variant: 'long',
    effort: '',
    summaryEffort: '',
    finishedAt: '2026-10-13T00:00:00Z',
    expectedTurns: 1,
    drain: { complete: true },
    turns: [
      {
        conversation: 'main',
        turn: 1,
        wallMs: 1000,
        end: 'completed',
        steps: [],
        answer: 'teal-otter-42',
        probe: { id: 'codename', kind: 'recall', pass: true },
      },
    ],
    ...changes,
  }
  await writeFile(join(directory, `${runId}.json`), JSON.stringify(evidence))
  await writeFile(
    join(directory, `${runId}.scenario.json`),
    JSON.stringify({ name: 'smoke', conversations: [{ name: 'main', turns: [{ prompt: 'recall', probe: { id: 'codename', expect: ['teal-otter-42'] } }] }] }),
  )
  return runId
}
const runReport = directory => spawnSync(process.execPath, [report, directory, '--json', join(directory, 'summary.json')], { encoding: 'utf8' })

test('report excludes aborted turns and incomplete drains from performance averages', async () =>
  withEvidence(async directory => {
    await writeRun({ directory, rep: 1, turns: [{ conversation: 'main', wallMs: 1000, end: 'error', steps: [], answer: '' }] })
    await writeRun({ directory, rep: 2, drain: { complete: false, pendingLeaves: 4, pendingViews: 0 } })
    const result = runReport(directory)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /FAILED smoke-B-r1/)
    assert.match(result.stdout, /INCOMPLETE SUMMARY DRAIN smoke-B-r2/)
    assert.doesNotMatch(result.stdout, /\| B OptMem compat \|/)
    const summaries = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'))
    assert.equal(summaries.length, 2)
  }))

test('unfinished provider calls remain unknown-cost accounting units', async () =>
  withEvidence(async directory => {
    const runId = await writeRun({ directory })
    await writeFile(
      join(directory, `${runId}.calls.jsonl`),
      JSON.stringify({
        kind: 'call-start',
        seq: 1,
        purpose: 'compaction',
        systemHead: 'You maintain the long-term memory',
        provider: 'opencode-go-alex',
        model: 'deepseek-v4.1-flash',
        startedAt: 1,
      }) + '\n',
    )
    const result = runReport(directory)
    assert.equal(result.status, 0, result.stderr)
    const [summary] = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'))
    assert.equal(summary.optmem.calls, 1)
    assert.equal(summary.optmem.unfinishedCalls, 1)
    assert.equal(summary.optmem.callsWithUsage, 0)
  }))

test('report refuses mismatched implementation cohorts', async () =>
  withEvidence(async directory => {
    await writeRun({ directory, rep: 1 })
    await writeRun({ directory, rep: 2, runtimeHash: 'other-runtime' })
    const result = runReport(directory)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /mixed benchmark policies/)
  }))

test('report refuses unpaired scenario data between modes', async () =>
  withEvidence(async directory => {
    await writeRun({ directory, arm: 'A' })
    await writeRun({ directory, arm: 'B', scenarioHash: 'other-scenario' })
    const result = runReport(directory)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unpaired benchmark comparison/)
  }))
