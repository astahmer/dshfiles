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
    assert.equal(summary.optmem.errors, 0)
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

test('report counts required-tool packet evidence without scoring it as task success', async () =>
  withEvidence(async directory => {
    await writeRun({
      directory,
      turns: [
        {
          conversation: 'main',
          turn: 1,
          wallMs: 1000,
          end: 'completed',
          steps: [{ tools: ['read', 'bash'] }],
          answer: 'private answer one',
          packet: { topic: 'repair', stage: 1, rows: 3, requiresTools: true },
        },
        {
          conversation: 'main',
          turn: 2,
          wallMs: 1000,
          end: 'completed',
          steps: [{ tools: [] }],
          answer: 'private answer two',
          packet: { topic: 'repair', stage: 2, rows: 3, requiresTools: true },
        },
      ],
    })
    const result = runReport(directory)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Required-tool packet evidence \(tool presence, not task success\)/)
    assert.match(result.stdout, /smoke-B-r1 \| 2 \| 1 \| 1 \| 2/)
    const [summary] = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'))
    assert.deepEqual(summary.toolPackets, { required: 2, withCalls: 1, missingCalls: 1, calls: 2 })
    assert.doesNotMatch(JSON.stringify(summary), /private answer/)
  }))

test('report separates direct calibration costs without copying summary text', async () =>
  withEvidence(async directory => {
    const runId = await writeRun({ directory, arm: 'A', calibration: { variants: ['baseline-default'], limit: 1, repetitions: 1 } })
    await writeFile(
      join(directory, `${runId}.calls.jsonl`),
      `${JSON.stringify({ kind: 'call-start', seq: 1, purpose: 'compaction', calibration: true, provider: 'opencode-go-alex', model: 'deepseek-v4.1-flash' })}\n${JSON.stringify({ seq: 1, purpose: 'compaction', calibration: true, provider: 'opencode-go-alex', model: 'deepseek-v4.1-flash', finish: 'stop', usage: { inputTokens: 10, cacheReadTokens: 2, outputTokens: 5, reasoningTokens: 3 } })}\n`,
    )
    await writeFile(
      join(directory, `${runId}.calibration.jsonl`),
      `${JSON.stringify({ kind: 'calibration-call-end', variant: 'baseline-default', finish: 'stop', usage: { inputTokens: 10, cacheReadTokens: 2, outputTokens: 5, reasoningTokens: 3 } })}\n${JSON.stringify({ kind: 'calibration-end', caseId: 'support-open-work', variant: 'baseline-default', complete: true, quality: { pass: false }, clipped: false, text: 'private synthetic summary: Elin Moss, export retention 45d, human review; permissions preflight not run; verify active org-lumen membership and reviewer permission.' })}\n`,
    )

    const result = runReport(directory)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Direct summary calibration \(not mode comparison\)/)
    const [summary] = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'))
    assert.equal(summary.optmem.calls, 0)
    assert.equal(summary.calibration[0].calls, 1)
    assert.equal(summary.calibration[0].qualityPasses, 1)
    assert.doesNotMatch(JSON.stringify(summary), /private synthetic summary text/)
  }))
