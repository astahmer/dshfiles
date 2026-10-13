import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { scenarioGroundTruth } from '../long-scenarios.mjs'
import { taskAcceptanceChecks } from '../long-task-acceptance.mjs'

const names = ['infra-rollout', 'ingestion-incident', 'product-support']
const deliverableDirectory = () => {
  const project = process.env.BENCH_PROJECT
  assert.ok(project, 'BENCH_PROJECT must identify the scratch project')
  return resolve(project, 'deliverables')
}
const presentDeliverables = async () => {
  const directory = deliverableDirectory()
  const files = await readdir(directory)
  return names.filter(name => files.includes(`${name}.json`))
}
const readHandoff = async () => {
  const directory = deliverableDirectory()
  const present = await presentDeliverables()
  assert.equal(present.length, 1, 'exactly one scenario deliverable must exist')
  const name = present[0]
  return { name, actual: JSON.parse(await readFile(resolve(directory, `${name}.json`), 'utf8')) }
}

test('long scenario handoff produces exactly one recognized deliverable', async () => {
  const present = await presentDeliverables()
  assert.equal(present.length, 1, 'exactly one scenario deliverable must exist')
  assert.ok(names.includes(present[0]), 'handoff must identify a supported scenario')
})

for (const check of taskAcceptanceChecks)
  test(`long scenario handoff ${check.id}`, async () => {
    const { name, actual } = await readHandoff()
    check.assert({ name, actual, expected: scenarioGroundTruth({ name }) })
  })
