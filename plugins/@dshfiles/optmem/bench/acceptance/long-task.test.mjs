import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { assertTaskAcceptance } from '../long-task-acceptance.mjs'

const names = ['infra-rollout', 'ingestion-incident', 'product-support']

test('long scenario handoff preserves corrected facts, scope, gates, dependency order, and rollback', async () => {
  const project = process.env.BENCH_PROJECT
  assert.ok(project, 'BENCH_PROJECT must identify the scratch project')
  const directory = resolve(project, 'deliverables')
  const files = await readdir(directory)
  const present = names.filter(name => files.includes(`${name}.json`))
  assert.equal(present.length, 1, 'exactly one scenario deliverable must exist')
  const name = present[0]
  const actual = JSON.parse(await readFile(resolve(directory, `${name}.json`), 'utf8'))
  assertTaskAcceptance({ name, actual })
})
