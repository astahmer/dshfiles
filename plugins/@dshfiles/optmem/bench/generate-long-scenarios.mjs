import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createLongScenario, scenarioGroundTruth } from './long-scenarios.mjs'

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    rep: { type: 'string', default: '1' },
    variant: { type: 'string', default: 'long' },
  },
})
if (values.out === undefined) throw new Error('usage: node generate-long-scenarios.mjs --out <offline-output-directory> [--rep 1] [--variant pilot|long]')
const directory = resolve(values.out)
const scenarios = ['infra-rollout', 'ingestion-incident', 'product-support'].map(name =>
  createLongScenario({ name, rep: Number(values.rep), variant: values.variant }),
)
await mkdir(directory, { recursive: true })
for (const scenario of scenarios) {
  await writeFile(resolve(directory, `${scenario.name}.json`), `${JSON.stringify(scenario, null, 2)}\n`)
  const probes = scenario.conversations.flatMap(conversation => conversation.turns).flatMap(turn => (turn.probe === undefined ? [] : [turn.probe]))
  await writeFile(
    resolve(directory, `${scenario.name}.ground-truth.json`),
    `${JSON.stringify({ metadata: scenario.metadata, probes, handoff: scenarioGroundTruth({ name: scenario.name }) }, null, 2)}\n`,
  )
}
process.stdout.write(
  `${JSON.stringify(
    scenarios.map(scenario => ({ name: scenario.name, ...scenario.metadata })),
    null,
    2,
  )}\n`,
)
