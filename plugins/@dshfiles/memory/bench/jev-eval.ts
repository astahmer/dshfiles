// Offline check of the optional Jev decisions on the benchmark scenarios' user messages.
// Usage: TYPESAFE_API_KEY=... node bench/jev-eval.ts [--json out.json]
// Recall gate: a thread's first message should need memory exactly when it is not the scenario's first thread.
// Signals: Jev's verdicts are compared with the phrasing heuristics (no ground truth; agreement and volume only).
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

import { flagSignal } from '../src/digest.ts'
import { JevClassifier } from '../src/jev.ts'

const { values } = parseArgs({ options: { json: { type: 'string' } } })
const apiKey = process.env['TYPESAFE_API_KEY']
if (apiKey === undefined || apiKey.length === 0) throw new Error('TYPESAFE_API_KEY is not set')
const optmemBench = resolve(import.meta.dirname, '../../optmem/bench')
const { loadScenario } = await import(pathToFileURL(join(optmemBench, 'scenario-loader.mjs')).href)

const pricePerMillion = 0.042
let inputTokens = 0
const latencies: number[] = []
const ask = async (question: 'signal' | 'recall', text: string): Promise<number> => {
  const started = performance.now()
  const verdict = await JevClassifier.ask({ question, text, apiKey, timeoutMs: 10_000 })
  latencies.push(performance.now() - started)
  inputTokens += verdict.inputTokens
  return verdict.probability
}

const gate = { truePositive: 0, falseNegative: 0, trueNegative: 0, falsePositive: 0 }
const signals = { messages: 0, jev: 0, heuristics: 0, both: 0 }
const paths = ['support.json', 'logs.json', 'infra-rollout.mjs', 'product-support.mjs'].map(name => join(optmemBench, 'scenarios', name))
paths.push(resolve(import.meta.dirname, 'scenarios/live-check.json'))
for (const path of paths) {
  const { scenario } = await loadScenario({ path, rep: 1, variant: 'long' })
  for (const [index, conversation] of scenario.conversations.entries()) {
    const first = conversation.turns[0]?.prompt ?? ''
    const needs = (await ask('recall', first)) >= 0.5
    const expected = index > 0
    if (expected && needs) gate.truePositive++
    if (expected && !needs) gate.falseNegative++
    if (!expected && !needs) gate.trueNegative++
    if (!expected && needs) gate.falsePositive++
    for (const turn of conversation.turns) {
      // The digest only classifies short messages: long pastes are material, not something the user said to the agent.
      if (Buffer.byteLength(turn.prompt) > 1_500 || turn.prompt.includes('{{')) continue
      signals.messages++
      const byJev = (await ask('signal', turn.prompt)) >= 0.5
      const byRules = flagSignal(turn.prompt) !== undefined
      if (byJev) signals.jev++
      if (byRules) signals.heuristics++
      if (byJev && byRules) signals.both++
    }
  }
}
latencies.sort((left, right) => left - right)
const result = {
  recallGate: gate,
  signals,
  calls: latencies.length,
  inputTokens,
  costUsd: Number(((inputTokens * pricePerMillion) / 1e6).toFixed(5)),
  latencyMsP50: Math.round(latencies[Math.floor(latencies.length / 2)] ?? 0),
  latencyMsP90: Math.round(latencies[Math.floor(latencies.length * 0.9)] ?? 0),
}
console.log(JSON.stringify(result, null, 2))
if (values.json !== undefined) await writeFile(values.json, `${JSON.stringify(result, null, 2)}\n`)
