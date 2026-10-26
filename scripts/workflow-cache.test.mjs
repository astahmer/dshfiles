import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

for (const workflow of ['check.yml', 'plugin-e2e-coverage.yml']) {
  test(`${workflow} caches the committed workspace lock without nonexistent nested locks`, () => {
    const source = readFileSync(resolve(root, '.github/workflows', workflow), 'utf8')
    assert.match(source, /cache: pnpm/u)
    assert.match(source, /cache-dependency-path: pnpm-lock\.yaml\s*\n/u)
    assert.doesNotMatch(source, /(?:tooling\/dshx|plugins)\/pnpm-lock\.yaml/u)
    assert.equal(existsSync(resolve(root, 'pnpm-lock.yaml')), true)
  })
}
