import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { healthCheck } from './cli.mjs'

/**
 * The property that matters: an incomplete candidate is refused rather than
 * promoted. These cases fail before any process is spawned, so they are cheap
 * and they cover the exact bug the first real snapshot had — a payload that
 * booted but silently skipped every plugin bundle.
 */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-lkg-test-'))
  mkdirSync(join(root, 'runtime'), { recursive: true })
  return root
}

test('refuses a snapshot whose recorded node is gone', async () => {
  const root = fixture()
  try {
    writeFileSync(join(root, 'runtime', 'node-path'), '/nonexistent/node\n')
    const health = await healthCheck(root)
    assert.equal(health.healthy, false)
    assert.equal(health.checks[0].name, 'node')
    assert.equal(health.checks[0].ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses a snapshot whose core entry is missing', async () => {
  const root = fixture()
  try {
    writeFileSync(join(root, 'runtime', 'node-path'), `${process.execPath}\n`)
    const health = await healthCheck(root)
    assert.equal(health.healthy, false)
    assert.equal(health.checks.at(-1).name, 'core')
    assert.equal(health.checks.at(-1).ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the launcher refuses a store without a current snapshot', () => {
  const launcher = readFileSync(new URL('./dsh-recover', import.meta.url), 'utf8')
  assert.match(launcher, /no last known good snapshot/)
  assert.match(launcher, /DSH_LKG_HOME/)
  assert.match(launcher, /readlink/)
})
