import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { bootWithRetry } from './ci/boot-retry.mjs'

const forcedBoots = codes => {
  const runs = []
  const boot = async () => {
    const code = codes[runs.length] ?? 0
    runs.push(spawnSync(process.execPath, ['-e', `process.exit(${String(code)})`]).status)
    return runs.at(-1)
  }
  return { boot, runs }
}

test('a CI shard that fails once boots its owners again and passes', async () => {
  const { boot, runs } = forcedBoots([1, 0])
  const logged = []
  assert.equal(await bootWithRetry({ boot, ci: true, log: message => logged.push(message) }), 0)
  assert.deepEqual(runs, [1, 0])
  assert.deepEqual(logged, ['retrying the owners that failed once'])
})

test('a CI shard that fails twice still fails with the second exit code', async () => {
  const { boot, runs } = forcedBoots([1, 3])
  assert.equal(await bootWithRetry({ boot, ci: true, log: () => {} }), 3)
  assert.deepEqual(runs, [1, 3])
})

test('a local failure is reported without a retry', async () => {
  const { boot, runs } = forcedBoots([1, 0])
  assert.equal(await bootWithRetry({ boot, ci: false, log: () => assert.fail('no retry outside CI') }), 1)
  assert.deepEqual(runs, [1])
})

test('a passing shard boots once', async () => {
  const { boot, runs } = forcedBoots([0])
  assert.equal(await bootWithRetry({ boot, ci: true, log: () => assert.fail('no retry after a pass') }), 0)
  assert.deepEqual(runs, [0])
})
