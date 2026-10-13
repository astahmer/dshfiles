// Aggregate run-arm.mjs outputs into Markdown tables and a compact summary JSON (no transcripts).
// Usage: node report.mjs <results-dir> [--json <summary.json>]
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { generateFixture } from './fixtures.mjs'
import { scoreProbe } from './probes.mjs'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'string' } } })
const dir = positionals[0]
// USD per million tokens, models.dev via AI Accounts' pricing cache: opencode-go deepseek-v4.1-flash.
const PRICE = { input: 0.15, cacheRead: 0.003, output: 0.6 }
const ARM_NAMES = { A: 'A native compaction', B: 'B OptMem compat', C: 'C OptMem full' }

const readJsonl = async file =>
  (await readFile(file, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))

const callKind = call => {
  if (call.kind === 'model-info') return 'model-info'
  if (call.purpose === 'agent') return 'agent'
  if (call.purpose === 'session-title') return 'title'
  if (call.purpose === 'compaction') return (call.systemHead ?? '').startsWith('You maintain the long-term memory') ? 'optmem' : 'native-compaction'
  return 'other'
}

const usageOf = calls => {
  const sum = key => calls.reduce((total, call) => total + (call.usage?.[key] ?? 0), 0)
  const input = sum('inputTokens')
  const cacheRead = sum('cacheReadTokens')
  const output = sum('outputTokens')
  return {
    calls: calls.length,
    callsWithUsage: calls.filter(call => call.usage !== undefined).length,
    maxTokenFinishes: calls.filter(call => call.finish === 'max-tokens').length,
    unfinishedCalls: calls.filter(call => call.incomplete).length,
    errors: calls.filter(call => call.error !== undefined || call.finish === 'error' || call.finish === 'aborted').length,
    reasoning: sum('reasoningTokens'),
    reasoningReportedCalls: calls.filter(call => call.usage?.reasoningTokens !== undefined).length,
    input,
    cacheRead,
    output,
    prompt: input + cacheRead,
    cost: (input * PRICE.input + cacheRead * PRICE.cacheRead + output * PRICE.output) / 1e6,
  }
}

// Probes are re-scored from the stored answers against the current scenario files, so a corrected expectation applies to
// every run. Stored answers are capped; a live pass on a capped answer is kept.
const benchRoot = dirname(fileURLToPath(import.meta.url))
const scenarios = new Map()
const scenarioProbes = async run => {
  const key = run.scenarioHash ?? run.scenario
  if (scenarios.has(key)) return scenarios.get(key)
  const scenario = JSON.parse(
    await readFile(join(dir, `${run.runId}.scenario.json`), 'utf8').catch(() => readFile(join(benchRoot, 'scenarios', `${run.scenario}.json`), 'utf8')),
  )
  const scratch = await mkdtemp(join(tmpdir(), 'optmem-bench-truth-'))
  const truth = { ...(await generateFixture(scenario.fixture, scratch)), ...scenario.truth }
  await rm(scratch, { recursive: true, force: true })
  const probes = new Map(
    scenario.conversations.flatMap(conversation => conversation.turns.flatMap(turn => (turn.probe === undefined ? [] : [[turn.probe.id, turn.probe]]))),
  )
  const entry = { probes, truth }
  scenarios.set(key, entry)
  return entry
}
const rescore = async (scenario, turn) => {
  const { probes, truth } = await scenarioProbes(scenario)
  const probe = probes.get(turn.probe.id)
  if (probe === undefined) return turn.probe
  const scored = scoreProbe({ answer: turn.answer, probe, truth })
  return turn.answerTruncated ? turn.probe : scored
}

const runs = []
for (const file of (await readdir(dir)).filter(name => /-[ABC]-r\d+\.json$/.test(name)).sort()) {
  const run = JSON.parse(await readFile(join(dir, file), 'utf8'))
  const journal = await readJsonl(join(dir, file.replace(/\.json$/, '.calls.jsonl')))
  const calls = journal.filter(call => call.kind !== 'model-info' && call.kind !== 'call-start')
  const ended = new Set(calls.map(call => call.seq))
  for (const start of journal.filter(call => call.kind === 'call-start' && !ended.has(call.seq)))
    calls.push({ ...start, kind: undefined, error: 'unfinished call; cost unknown', incomplete: true })
  const byKind = Object.groupBy(calls, callKind)
  const agentCalls = byKind.agent ?? []
  const probes = await Promise.all(run.turns.filter(turn => turn.probe !== undefined).map(turn => rescore(run, turn)))
  const tally = kind => {
    const matching = probes.filter(probe => probe.kind === kind)
    return { pass: matching.filter(probe => probe.pass).length, total: matching.length }
  }
  const mainTurns = run.turns.filter(turn => turn.conversation === 'main')
  const lastSteps = mainTurns.map(turn => turn.steps.at(-1)?.usage).filter(Boolean)
  const promptOf = usage => (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0)
  const sentBytes = agentCalls.map(call => call.sentBytes ?? call.messageBytes)
  const sentMessages = agentCalls.map(call => call.sentMessages ?? call.messages)
  const nativeCompactionEvents = Object.values(run.sessionEventCounts ?? {}).reduce(
    (total, counts) => total + Object.entries(counts).reduce((sum, [type, count]) => sum + (/^compaction\/end$/.test(type) ? count : 0), 0),
    0,
  )
  runs.push({
    runId: run.runId,
    scenario: run.scenario,
    arm: run.arm,
    rep: run.rep,
    provider: run.provider,
    model: run.model,
    runtimeHash: run.runtimeHash,
    sourceHash: run.sourceHash,
    finishedAt: run.finishedAt,
    turnEnds: run.turns.map(turn => turn.end),
    scenarioHash: run.scenarioHash,
    variant: run.variant,
    effort: run.effort,
    summaryEffort: run.summaryEffort,
    compactionPolicy: run.compaction,
    drain: run.drain,
    expectedTurns: run.expectedTurns,
    error: run.error?.split('\n')[0],
    turns: run.turns.length,
    agent: usageOf(agentCalls),
    nativeCompaction: usageOf(byKind['native-compaction'] ?? []),
    optmem: usageOf(byKind.optmem ?? []),
    title: usageOf(byKind.title ?? []),
    all: usageOf(calls),
    agentSteps: agentCalls.length,
    maxSentMessages: Math.max(0, ...sentMessages),
    lastSentMessages: sentMessages.at(-1) ?? 0,
    maxSentBytes: Math.max(0, ...sentBytes),
    meanSentBytes: sentBytes.length === 0 ? 0 : Math.round(sentBytes.reduce((a, b) => a + b, 0) / sentBytes.length),
    firstPrompt: lastSteps.length === 0 ? 0 : promptOf(lastSteps[0]),
    maxPrompt: Math.max(0, ...agentCalls.map(call => promptOf(call.usage ?? {}))),
    lastPrompt: lastSteps.length === 0 ? 0 : promptOf(lastSteps.at(-1)),
    promptCurve: mainTurns.map(turn => (turn.steps.length === 0 ? 0 : promptOf(turn.steps.at(-1).usage ?? {}))),
    wallSeconds: Math.round(run.turns.reduce((total, turn) => total + turn.wallMs, 0) / 1000),
    medianTurnSeconds: (() => {
      const sorted = run.turns.map(turn => turn.wallMs).sort((a, b) => a - b)
      return sorted.length === 0 ? 0 : Number((sorted[Math.floor(sorted.length / 2)] / 1000).toFixed(1))
    })(),
    meanFirstChunkMs: agentCalls.length === 0 ? 0 : Math.round(agentCalls.reduce((total, call) => total + (call.firstChunkMs ?? 0), 0) / agentCalls.length),
    nativeCompactionCalls: (byKind['native-compaction'] ?? []).length,
    nativeCompactionEvents,
    recall: tally('recall'),
    analysis: tally('analysis'),
    cross: tally('cross-session'),
    failedProbes: probes.filter(probe => !probe.pass).map(probe => probe.id),
    acceptance:
      run.acceptance === undefined ? undefined : { pass: run.acceptance.pass, total: run.acceptance.pass + run.acceptance.fail, failed: run.acceptance.failed },
    optmemNodes: run.optmemDb?.nodesByModel,
  })
}

const successfulRuns = runs.filter(
  run =>
    run.error === undefined &&
    run.finishedAt !== undefined &&
    run.turnEnds.every(end => end === 'completed') &&
    (run.expectedTurns === undefined || run.turns === run.expectedTurns) &&
    run.drain?.complete !== false,
)
const groups = Object.groupBy(successfulRuns, run => `${run.scenario}|${run.arm}`)
for (const [key, items] of Object.entries(groups)) {
  const policies = new Set(
    items.map(run =>
      JSON.stringify({
        provider: run.provider,
        model: run.model,
        runtimeHash: run.runtimeHash,
        sourceHash: run.sourceHash,
        variant: run.variant,
        effort: run.effort,
        summaryEffort: run.summaryEffort,
        compactionPolicy: run.compactionPolicy,
      }),
    ),
  )
  if (policies.size > 1) throw new Error(`refusing to average mixed benchmark policies for ${key}`)
}
for (const [key, items] of Object.entries(Object.groupBy(successfulRuns, run => `${run.scenario}|${run.rep}`))) {
  const pairedIdentities = new Set(
    items.map(run =>
      JSON.stringify({
        scenarioHash: run.scenarioHash,
        sourceHash: run.sourceHash,
        provider: run.provider,
        model: run.model,
        variant: run.variant,
        effort: run.effort,
        summaryEffort: run.summaryEffort,
        compactionPolicy: run.compactionPolicy,
      }),
    ),
  )
  if (pairedIdentities.size > 1) throw new Error(`refusing unpaired benchmark comparison for ${key}`)
}
const stat = (items, pick, digits = 0) => {
  const numbers = items.map(pick).filter(value => Number.isFinite(value))
  if (numbers.length === 0) return '–'
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length
  const format = value => (digits === 0 ? Math.round(value).toLocaleString('en-US') : value.toFixed(digits))
  return numbers.length === 1 || Math.min(...numbers) === Math.max(...numbers)
    ? format(mean)
    : `${format(mean)} (${format(Math.min(...numbers))}–${format(Math.max(...numbers))})`
}
const ratio = (items, pick) => {
  const pass = items.reduce((total, run) => total + pick(run).pass, 0)
  const total = items.reduce((total, run) => total + pick(run).total, 0)
  return total === 0 ? '–' : `${pass}/${total} (${Math.round((100 * pass) / total)}%)`
}

const lines = ['Successful runs only in performance tables; failed/partial runs remain in JSON evidence. Costs use list prices, not subscription billing.']
for (const run of runs.filter(run => !successfulRuns.includes(run)))
  lines.push(`- FAILED ${run.runId}: ${run.error ?? `${run.turns}/${run.expectedTurns} turns`}`)
for (const run of runs.filter(run => run.drain?.complete === false))
  lines.push(
    `- INCOMPLETE SUMMARY DRAIN ${run.runId}: cost excludes work after the deadline; ${run.drain.pendingLeaves} pending leaves, ${run.drain.pendingViews} pending views.`,
  )
for (const scenario of [...new Set(runs.map(run => run.scenario))]) {
  lines.push(`\n### ${scenario}\n`)
  lines.push(
    '| arm | runs | prompt tok, all calls | cached % | output tok | est. cost $ | agent steps | first → last turn prompt tok | max prompt tok | max msgs sent | max KB sent | native compactions | OptMem summary calls | wall s | median turn s |',
  )
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const arm of ['A', 'B', 'C']) {
    const items = groups[`${scenario}|${arm}`] ?? []
    if (items.length === 0) continue
    lines.push(
      `| ${ARM_NAMES[arm]} | ${items.length}${items.some(run => run.error) ? ' ⚠' : ''} | ${stat(items, run => run.all.prompt)} | ${stat(items, run => (100 * run.all.cacheRead) / Math.max(1, run.all.prompt), 1)} | ${stat(items, run => run.all.output)} | ${stat(items, run => run.all.cost, 4)} | ${stat(items, run => run.agentSteps)} | ${stat(items, run => run.firstPrompt)} → ${stat(items, run => run.lastPrompt)} | ${stat(items, run => run.maxPrompt)} | ${stat(items, run => run.maxSentMessages)} | ${stat(items, run => run.maxSentBytes / 1024, 1)} | ${stat(items, run => run.nativeCompactionCalls)} | ${stat(items, run => run.optmem.calls)} | ${stat(items, run => run.wallSeconds)} | ${stat(items, run => run.medianTurnSeconds, 1)} |`,
    )
  }
  const curveTurns = [1, 5, 10, 15, 20, 25].filter(turn => runs.some(run => run.scenario === scenario && run.promptCurve.length >= turn))
  lines.push(`\n| arm | ${curveTurns.map(turn => `t${turn}`).join(' | ')} | last |`)
  lines.push(`|---|${curveTurns.map(() => '---|').join('')}---|`)
  for (const arm of ['A', 'B', 'C']) {
    const items = groups[`${scenario}|${arm}`] ?? []
    if (items.length === 0) continue
    lines.push(
      `| ${ARM_NAMES[arm]} | ${curveTurns.map(turn => stat(items, run => run.promptCurve[turn - 1])).join(' | ')} | ${stat(items, run => run.promptCurve.at(-1))} |`,
    )
  }
  lines.push('\n| arm | recall probes | analysis probes | cross-session probes | acceptance tests | failed probes (per run) |')
  lines.push('|---|---|---|---|---|---|')
  for (const arm of ['A', 'B', 'C']) {
    const items = groups[`${scenario}|${arm}`] ?? []
    if (items.length === 0) continue
    const acceptance = items.some(run => run.acceptance !== undefined) ? ratio(items, run => run.acceptance ?? { pass: 0, total: 0 }) : '–'
    lines.push(
      `| ${ARM_NAMES[arm]} | ${ratio(items, run => run.recall)} | ${ratio(items, run => run.analysis)} | ${ratio(items, run => run.cross)} | ${acceptance} | ${items.map(run => `r${run.rep}: ${run.failedProbes.join(', ') || '—'}`).join('; ')} |`,
    )
  }
}
lines.push(
  '\n### Summary health and accounting\n',
  '| run | summary calls | capped | error finishes | usage coverage | summary output tokens | estimated summary cost | drained |',
  '|---|---:|---:|---:|---|---:|---:|---|',
)
for (const run of runs)
  lines.push(
    `| ${run.runId} | ${run.optmem.calls} | ${run.optmem.maxTokenFinishes} | ${run.optmem.errors} | ${run.all.callsWithUsage}/${run.all.calls} | ${run.optmem.output} | ${run.optmem.cost.toFixed(4)} | ${run.drain?.complete ?? 'n/a'} |`,
  )
console.log(lines.join('\n'))
if (values.json !== undefined) await writeFile(values.json, `${JSON.stringify(runs, null, 2)}\n`)
