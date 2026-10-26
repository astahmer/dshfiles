import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('coverage builds scaffold exports before loading template invariant tests', () => {
  const source = readFileSync(resolve(root, '.github/workflows/plugin-e2e-coverage.yml'), 'utf8')
  const build = source.indexOf('- name: Build scaffold and SDK prerequisites')
  const invariantTests = source.indexOf('- name: Test feature catalog invariants')
  assert.ok(build > source.indexOf('- name: Install the DSHX workspace'))
  assert.ok(build < invariantTests)
  assert.match(source.slice(build, invariantTests), /run: pnpm run build/u)
})

for (const workflow of ['check.yml', 'plugin-e2e-coverage.yml']) {
  test(`${workflow} caches the committed workspace lock without nonexistent nested locks`, () => {
    const source = readFileSync(resolve(root, '.github/workflows', workflow), 'utf8')
    assert.match(source, /cache: pnpm/u)
    assert.match(source, /cache-dependency-path: pnpm-lock\.yaml\s*\n/u)
    assert.doesNotMatch(source, /(?:tooling\/dshx|plugins)\/pnpm-lock\.yaml/u)
    assert.equal(existsSync(resolve(root, 'pnpm-lock.yaml')), true)
  })
}
