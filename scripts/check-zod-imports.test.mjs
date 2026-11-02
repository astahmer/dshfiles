import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = join(import.meta.dirname, 'check-zod-imports.mjs')

const runGate = (arguments_ = []) => spawnSync(process.execPath, [script, ...arguments_], { cwd: import.meta.dirname, encoding: 'utf8' })

test('the zod import gate lists its recorded bridges', () => {
  const result = runGate(['--list'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /tooling\/dshx\/packages\/dshx\/src\/api\/zod-view\.ts — Effect → zod bridge/u)
})

test('the zod import gate holds no stale entry', () => {
  const result = runGate()
  assert.doesNotMatch(result.stderr, /imports no zod; drop the entry/u)
  assert.doesNotMatch(result.stderr, /imports zod; use effect\/Schema/u)
})

test('a scratch tree is scanned for zod imports, including subpaths and exports', () => {
  const root = mkdtempSync(join(tmpdir(), 'zod-imports-'))
  const directory = join(root, 'plugins', 'demo', 'src')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'owned.ts'), "export { z } from 'zod/mini'\n")
  const result = spawnSync(process.execPath, [script, '--root', root], { cwd: import.meta.dirname, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /plugins\/demo\/src\/owned\.ts: imports zod/u)
})
