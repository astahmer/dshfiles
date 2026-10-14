// Native vs @dshfiles/memory vs OptMem compat, from the summary JSON of optmem/bench/report.mjs.
// Usage: node ../optmem/bench/report.mjs <results> --json summary.json && node bench/compare.mjs summary.json <results>
// With <results>, agent cost is also split into the scenario's first thread (memory is empty there, so any difference
// from native is run-to-run noise) and the later threads (where the start block and the tools act).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const runs = JSON.parse(await readFile(process.argv[2], 'utf8')).filter(run => run.error === undefined && run.turnEnds.every(end => end === 'completed'))
const arms = [
  ['A', 'native'],
  ['M', 'memory'],
  ['B', 'compat'],
]
const mean = values => (values.length === 0 ? NaN : values.reduce((total, value) => total + value, 0) / values.length)
const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0)
const tally = (items, key) => `${sum(items, run => run[key].pass)}/${sum(items, run => run[key].total)}`
const costOf = run => run.all.cost
const resultsDir = process.argv[3]
// The report zeroes acceptance for a run whose test file did not pass entirely; the raw counts say how close it came.
const rawAcceptance = new Map()
if (resultsDir !== undefined)
  for (const run of runs) {
    const evidence = JSON.parse(await readFile(join(resultsDir, `${run.runId}.json`), 'utf8'))
    if (evidence.acceptance !== undefined)
      rawAcceptance.set(run.runId, { pass: evidence.acceptance.pass, total: evidence.acceptance.pass + evidence.acceptance.fail })
  }
const acceptanceOf = run => rawAcceptance.get(run.runId) ?? run.acceptance
const lines = [
  '| scenario | arm | runs | $ per run | vs native | agent | digest / summary | Jev | agent cache-read | cross-session | same-session | analysis | acceptance | block in system only |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
]
const pooled = new Map()
for (const scenario of [...new Set(runs.map(run => run.scenario))]) {
  const native = mean(runs.filter(run => run.scenario === scenario && run.arm === 'A').map(costOf))
  for (const [arm, name] of arms) {
    const items = runs.filter(run => run.scenario === scenario && run.arm === arm)
    if (items.length === 0) continue
    const total = mean(items.map(costOf))
    const agent = mean(items.map(run => run.agent.cost))
    const side = mean(items.map(run => (arm === 'M' ? run.memoryDigest.cost : arm === 'B' ? run.optmem.cost : 0)))
    const acceptance = items.some(run => acceptanceOf(run) !== undefined)
      ? `${sum(items, run => acceptanceOf(run)?.pass ?? 0)}/${sum(items, run => acceptanceOf(run)?.total ?? 0)}`
      : '–'
    const block =
      arm === 'M'
        ? `${sum(items, run => run.memoryBlock.withBlock)}/${sum(items, run => run.memoryBlock.agentCalls)} calls carry it; ${sum(items, run => run.memoryBlock.outsideSystem)} outside system, ${sum(items, run => run.memoryBlock.repeated)} repeated`
        : '–'
    lines.push(
      `| ${scenario} | ${name} | ${items.length} | ${total.toFixed(3)} | ${(total / native).toFixed(2)} | ${(agent / native).toFixed(2)} | ${(side / native).toFixed(3)} | 0 | ${(100 * mean(items.map(run => run.agentCacheShare))).toFixed(1)}% | ${tally(items, 'cross')} | ${tally(items, 'recall')} | ${tally(items, 'analysis')} | ${acceptance} | ${block} |`,
    )
    const entry = pooled.get(name) ?? { ratios: [], agent: [], side: [], cache: [], items: [] }
    entry.ratios.push(total / native)
    entry.agent.push(agent / native)
    entry.side.push(side / native)
    entry.cache.push(...items.map(run => run.agentCacheShare))
    entry.items.push(...items)
    pooled.set(name, entry)
  }
}
lines.push(
  '',
  '| arm | if native costs $1 | agent | digest / summary | Jev | agent cache-read | cross-session | same-session |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
)
for (const [name, entry] of pooled)
  lines.push(
    `| ${name} | $${mean(entry.ratios).toFixed(2)} | $${mean(entry.agent).toFixed(2)} | $${mean(entry.side).toFixed(3)} | $0 | ${(100 * mean(entry.cache)).toFixed(1)}% | ${tally(entry.items, 'cross')} | ${tally(entry.items, 'recall')} |`,
  )
if (resultsDir !== undefined) {
  const price = { input: 0.15, cacheRead: 0.003, output: 0.6 }
  lines.push('', '| scenario | arm | agent $ first thread | agent $ later threads | agent cache-read, later threads |', '|---|---|---:|---:|---:|')
  for (const scenario of [...new Set(runs.map(run => run.scenario))])
    for (const [arm, name] of arms) {
      const items = runs.filter(run => run.scenario === scenario && run.arm === arm)
      if (items.length === 0) continue
      const split = await Promise.all(
        items.map(async run => {
          const evidence = JSON.parse(await readFile(join(resultsDir, `${run.runId}.json`), 'utf8'))
          const firstConversation = evidence.turns[0]?.conversation
          const conversationOf = new Map(evidence.turns.map(turn => [turn.session, turn.conversation]))
          const calls = (await readFile(join(resultsDir, `${run.runId}.calls.jsonl`), 'utf8'))
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line))
            .filter(call => call.purpose === 'agent' && call.usage !== undefined && call.kind !== 'call-start')
          const cost = call =>
            ((call.usage.inputTokens ?? 0) * price.input +
              (call.usage.cacheReadTokens ?? 0) * price.cacheRead +
              (call.usage.outputTokens ?? 0) * price.output) /
            1e6
          const first = calls.filter(call => conversationOf.get(call.sessionId) === firstConversation)
          const later = calls.filter(call => conversationOf.get(call.sessionId) !== firstConversation)
          const prompt = later.reduce((total, call) => total + (call.usage.inputTokens ?? 0) + (call.usage.cacheReadTokens ?? 0), 0)
          return { first: sum(first, cost), later: sum(later, cost), cache: prompt === 0 ? 0 : sum(later, call => call.usage.cacheReadTokens ?? 0) / prompt }
        }),
      )
      lines.push(
        `| ${scenario} | ${name} | ${mean(split.map(item => item.first)).toFixed(4)} | ${mean(split.map(item => item.later)).toFixed(4)} | ${(100 * mean(split.map(item => item.cache))).toFixed(1)}% |`,
      )
    }
}
console.log(lines.join('\n'))
