#!/usr/bin/env node
// Summarizes the compaction replay matrix (tests/compaction-replay.spec.ts, COMPACTION_REPLAY=<file>) as Markdown tables:
// medians over repeats, with min–max where runs differ.
import { readFileSync } from 'node:fs'

const runs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const median = values => {
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 0) return Number.NaN
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const spread = (values, format) => {
  const low = Math.min(...values)
  const high = Math.max(...values)
  return low === high ? format(low) : `${format(median(values))} (${format(low)}–${format(high)})`
}
const integer = value => (Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '–')
const thousands = value => (Number.isFinite(value) ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k` : '–')
const percent = value => (Number.isFinite(value) ? `${(value * 100).toFixed(1)} %` : '–')
const ratio = (part, whole) => (whole === 0 ? Number.NaN : part / whole)
const sum = values => values.reduce((total, value) => total + value, 0)

const groups = new Map()
for (const run of runs) {
  const key = `${run.label}|${run.setup}|${run.loadedSkills}`
  groups.set(key, [...(groups.get(key) ?? []), run])
}

const header = [
  'Scenario',
  'Setup',
  'Skills',
  'Compactions ok / failed',
  'By ours / stock',
  'Pruned',
  'Peak tokens',
  'Total tokens',
  'Prefix reuse',
  'Uncached tokens',
  'Summary input',
  'Overflows / failed turns / skipped',
  'Wall ms per compaction',
  'Skills kept',
  'Recent results kept (whole)',
  'Last todo kept',
]
console.log(`| ${header.join(' | ')} |`)
console.log(`| ${header.map(() => '---').join(' | ')} |`)
for (const [key, group] of groups) {
  const [label, setup, skills] = key.split('|')
  const first = group[0]
  const survival = first.survival
  const skillsKept = ratio(sum(survival.map(entry => entry.skillsVisible)), sum(survival.map(entry => entry.skillsLoaded)))
  const recentKept = ratio(sum(survival.map(entry => entry.recentResultsVisible)), sum(survival.map(entry => entry.recentResults)))
  const recentWhole = ratio(sum(survival.map(entry => entry.recentResultsWhole)), sum(survival.map(entry => entry.recentResults)))
  const todos = survival.filter(entry => entry.todoVisible !== null)
  const todoKept = ratio(todos.filter(entry => entry.todoVisible).length, todos.length)
  const wall = group.map(run => median(run.compactionWallMs))
  console.log(
    `| ${[
      label,
      setup,
      skills,
      `${spread(
        group.map(run => run.compactionsSucceeded),
        integer,
      )} / ${spread(
        group.map(run => run.compactionsFailed),
        integer,
      )}`,
      `${integer(first.checkpointsByOurs)} / ${integer(first.checkpointsByStock)}`,
      integer(first.prunedResults),
      thousands(first.peakRequestTokens),
      `${(first.totalRequestTokens / 1e6).toFixed(1)}M`,
      percent(first.prefixReuse),
      `${((first.totalRequestTokens * (1 - first.prefixReuse)) / 1e6).toFixed(2)}M`,
      `${(first.summaryInputTokens / 1e6).toFixed(1)}M in ${integer(first.summaryRequests)}`,
      `${integer(first.overflows)} / ${integer(first.failedTurns)} / ${integer(first.skippedSteps)}`,
      spread(wall, integer),
      percent(skillsKept),
      `${percent(recentKept)} (${percent(recentWhole)})`,
      percent(todoKept),
    ].join(' | ')} |`,
  )
}
const deterministic = [...groups.values()].every(group =>
  group.every(run => run.compactionsSucceeded === group[0].compactionsSucceeded && run.totalRequestTokens === group[0].totalRequestTokens),
)
console.log(`\n${String(runs.length)} runs; counts and tokens identical across repeats: ${String(deterministic)}`)
