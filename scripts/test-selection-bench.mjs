#!/usr/bin/env node
/**
 * Measures how much a change-based test selector is worth: it injects one-line mutations into a
 * package's source, records which test files the full suite really fails, then compares that ground
 * truth with the tests `vitest related` selects for the mutated file. Optionally asks Jev whether the
 * change breaks a test at all (`--jev`, needs JEV_API_KEY) to measure the LLM gate against the same
 * ground truth.
 *
 * Mutations that break no test are skipped, so the run costs one package suite per mutation attempt.
 * Timings are sequential on purpose: they compare the suite with the selector run on the same machine
 * state, not throughput.
 *
 *   node scripts/test-selection-bench.mjs
 *   node scripts/test-selection-bench.mjs --packages memory,backlog --mutations 2 --json /tmp/selection.json
 *   JEV_API_KEY=… node scripts/test-selection-bench.mjs --jev
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = mkdtempSync(join(tmpdir(), 'test-selection-bench-'))
let reportSequence = 0

const mutations = [
  { name: 'eq-flip', apply: text => (/ === /.test(text) ? text.replace(' === ', ' !== ') : / !== /.test(text) ? text.replace(' !== ', ' === ') : null) },
  { name: 'cmp-flip', apply: text => (/ >= /.test(text) ? text.replace(' >= ', ' < ') : / <= /.test(text) ? text.replace(' <= ', ' > ') : null) },
  { name: 'or-and', apply: text => (/ && /.test(text) ? text.replace(' && ', ' || ') : / \|\| /.test(text) ? text.replace(' || ', ' && ') : null) },
  {
    name: 'bool-flip',
    apply: text => (/\btrue\b/.test(text) ? text.replace(/\btrue\b/, 'false') : /\bfalse\b/.test(text) ? text.replace(/\bfalse\b/, 'true') : null),
  },
  {
    name: 'number-bump',
    apply: text => {
      const bumped = text.replace(/(?<![\w.$])(\d+)(?![\w.])/, (match, digits) => String(Number(digits) + 1))
      return bumped === text ? null : bumped
    },
  },
]

const isMutableLine = text =>
  text.trim().length > 0 &&
  text.length < 240 &&
  !/^\s*(\/\/|\*|\/\*|import |export .* from|export \{|type |interface )/.test(text) &&
  !/\b(expect|describe|it|test)\(/.test(text) &&
  !text.includes('.test.')

const walk = dir => {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|d)\.tsx?$/.test(entry.name)) files.push(path)
  }
  return files
}

const runVitest = (cwd, args) => {
  const outputFile = join(scratch, `report-${reportSequence++}.json`)
  const result = spawnSync('pnpm', ['exec', 'vitest', ...args, '--reporter=json', `--outputFile=${outputFile}`, '--passWithNoTests'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  })
  try {
    const report = JSON.parse(readFileSync(outputFile, 'utf8'))
    return {
      testFiles: report.testResults.map(testResult => relative(cwd, testResult.name)).sort(),
      failing: report.testResults
        .filter(testResult => testResult.status === 'failed')
        .map(testResult => relative(cwd, testResult.name))
        .sort(),
      error: null,
      status: result.status,
    }
  } catch (error) {
    return { testFiles: [], failing: [], error: String(error.message).slice(0, 200), status: result.status, stderr: (result.stderr ?? '').slice(-400) }
  }
}

const askJev = async ({ content, instructions, criteria }) => {
  const started = Date.now()
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.JEV_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: { role: 'user', content }, questions: { verdict: { type: 'noul', instructions, criteria } } }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) return { ok: false, status: response.status, latencyMs: Date.now() - started }
  return { ok: true, latencyMs: Date.now() - started, probability: body.answers?.verdict?.noul, inputTokens: body.usage?.input_tokens ?? null }
}

const priorityOf = text => {
  if (/[!=]==? ?(undefined|null)\b/.test(text)) return 4
  if (/[!=]==? /.test(text)) return 3
  if (/[<>]=? /.test(text)) return 2
  if (/\b(true|false)\b/.test(text)) return 1
  return 0
}

const candidatesFor = (packageDir, limit) => {
  const candidates = []
  for (const file of walk(join(packageDir, 'src'))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    let best = null
    for (let index = 0; index < lines.length; index++) {
      const text = lines[index]
      if (!isMutableLine(text)) continue
      const mutation = mutations.find(entry => entry.apply(text) !== null)
      if (!mutation) continue
      const priority = priorityOf(text)
      if (best === null || priority > best.priority) best = { file, lineNumber: index + 1, text, mutation, priority }
    }
    if (best !== null) candidates.push(best)
    if (candidates.length >= limit) break
  }
  return candidates.sort((left, right) => right.priority - left.priority)
}

const benchmarkPackage = async ({ packageName, mutationBudget, useJev }) => {
  const packageDir = join(repositoryRoot, 'plugins/@dshfiles', packageName)
  if (!existsSync(join(packageDir, 'package.json'))) throw new Error(`Unknown package @dshfiles/${packageName}`)
  const baseline = runVitest(packageDir, ['run'])
  const baselineFailing = new Set(baseline.failing)
  const candidates = candidatesFor(packageDir, mutationBudget * 4)
  const results = []
  let applied = 0
  for (const candidate of candidates) {
    if (applied >= mutationBudget) break
    const original = readFileSync(candidate.file, 'utf8')
    const lines = original.split('\n')
    const mutatedLine = candidate.mutation.apply(lines[candidate.lineNumber - 1])
    if (mutatedLine === null || mutatedLine === lines[candidate.lineNumber - 1]) continue
    lines[candidate.lineNumber - 1] = mutatedLine
    const mutatedSource = lines.join('\n')
    const relativeFile = relative(packageDir, candidate.file)
    try {
      writeFileSync(candidate.file, mutatedSource)
      const suiteStarted = Date.now()
      const suite = runVitest(packageDir, ['run'])
      const suiteMs = Date.now() - suiteStarted
      const failing = suite.failing.filter(testFile => !baselineFailing.has(testFile))
      const record = {
        packageName,
        file: relative(repositoryRoot, candidate.file),
        lineNumber: candidate.lineNumber,
        mutation: candidate.mutation.name,
        before: candidate.text.trim(),
        after: mutatedLine.trim(),
        suiteMs,
        failing: failing.length,
        missedFailing: [],
        jev: null,
      }
      if (useJev) {
        const content = [
          `Package: @dshfiles/${packageName}`,
          `Test files in the package: ${baseline.testFiles.join(', ')}`,
          'Change:',
          `--- a/${record.file}`,
          `+++ b/${record.file}`,
          `@@ -${candidate.lineNumber},1 +${candidate.lineNumber},1 @@`,
          `-${record.before}`,
          `+${record.after}`,
        ].join('\n')
        record.jev = await askJev({
          content,
          instructions: 'Decide whether this source change makes any existing test in the package fail.',
          criteria: { true: 'At least one test asserts the changed behavior', false: 'No test asserts the changed behavior' },
        })
      }
      if (failing.length > 0) {
        applied++
        const relatedStarted = Date.now()
        const related = runVitest(packageDir, ['related', '--run', relativeFile])
        record.relatedMs = Date.now() - relatedStarted
        record.relatedSelected = related.testFiles.length
        record.missedFailing = failing.filter(testFile => !related.testFiles.includes(testFile))
        record.relatedError = related.error
      }
      results.push(record)
      console.log(
        `${packageName} ${relativeFile}:${candidate.lineNumber} ${record.mutation} → suite ${suiteMs}ms/${record.failing} failing${
          record.relatedMs === undefined ? '' : `, related ${record.relatedMs}ms/${record.relatedSelected} files, missed ${record.missedFailing.length}`
        }${record.jev ? `, jev ${record.jev.ok ? record.jev.probability.toFixed(2) : 'error'}` : ''}`,
      )
    } finally {
      writeFileSync(candidate.file, original)
    }
  }
  return { packageName, baselineFailing: [...baselineFailing], results }
}

const summarize = packages => {
  const results = packages.flatMap(packageResult => packageResult.results)
  const faultRevealing = results.filter(record => record.failing > 0)
  const missed = faultRevealing.reduce((sum, record) => sum + record.missedFailing.length, 0)
  const median = values => (values.length === 0 ? null : values.sort((left, right) => left - right)[Math.floor(values.length / 2)])
  const jevRecords = results.filter(record => record.jev?.ok)
  const jevAccuracy =
    jevRecords.length === 0 ? null : jevRecords.filter(record => record.jev.probability >= 0.5 === record.failing > 0).length / jevRecords.length
  const jevBaseline =
    jevRecords.length === 0
      ? null
      : Math.max(jevRecords.filter(record => record.failing > 0).length, jevRecords.filter(record => record.failing === 0).length) / jevRecords.length
  return {
    packages: packages.map(packageResult => ({
      packageName: packageResult.packageName,
      attempts: packageResult.results.length,
      faultRevealing: packageResult.results.filter(record => record.failing > 0).length,
      failingTests: packageResult.results.reduce((sum, record) => sum + record.failing, 0),
      missedFailingTests: packageResult.results.reduce((sum, record) => sum + record.missedFailing.length, 0),
    })),
    attempts: results.length,
    faultRevealing: faultRevealing.length,
    missedFailingTests: missed,
    medianSuiteMs: median(results.map(record => record.suiteMs)),
    medianRelatedMs: median(faultRevealing.map(record => record.relatedMs)),
    jev:
      jevRecords.length === 0
        ? null
        : {
            calls: jevRecords.length,
            accuracyAtHalf: jevAccuracy,
            majorityBaseline: jevBaseline,
            medianLatencyMs: median(jevRecords.map(record => record.jev.latencyMs)),
          },
  }
}

const main = async () => {
  const { values } = parseArgs({
    options: {
      packages: { type: 'string', default: 'shared-streams,memory,backlog,plugin-ui,usage,command-palette' },
      mutations: { type: 'string', default: '3' },
      json: { type: 'string' },
      jev: { type: 'boolean', default: false },
    },
  })
  if (values.jev && !process.env.JEV_API_KEY) throw new Error('--jev needs JEV_API_KEY in the environment.')
  const packageNames = values.packages
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
  const mutationBudget = Number(values.mutations)
  const report = []
  for (const packageName of packageNames) report.push(await benchmarkPackage({ packageName, mutationBudget, useJev: values.jev }))
  const summary = summarize(report)
  console.log(JSON.stringify(summary, null, 2))
  if (values.json) writeFileSync(values.json, JSON.stringify({ summary, packages: report }, null, 1))
}

await main().finally(() => rmSync(scratch, { recursive: true, force: true }))
