import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const script = join(import.meta.dirname, 'pack-docs.ts')
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

test('the committed pack pages are up to date', () => {
  const result = run('--check')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /9 pages up to date/)
})

test('a hand edit, a missing page and a page no pack generates fail the check', t => {
  const out = mkdtempSync(join(tmpdir(), 'pack-docs-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  assert.equal(run('--out', out).status, 0)
  assert.deepEqual(readdirSync(out).sort(), [
    'README.md',
    'accounts.md',
    'agents.md',
    'core.md',
    'github.md',
    'knowledge.md',
    'observe.md',
    'planning.md',
    'versioning.md',
  ])
  assert.equal(run('--check', '--out', out).status, 0)

  appendFileSync(join(out, 'versioning.md'), '\nA hand edit.\n')
  const edited = run('--check', '--out', out)
  assert.equal(edited.status, 1)
  assert.match(edited.stderr, /versioning\.md is missing or stale/)
  assert.match(edited.stderr, /run `node scripts\/pack-docs\.ts`/)

  rmSync(join(out, 'core.md'))
  writeFileSync(join(out, 'retired.md'), '# Retired\n')
  const drifted = run('--check', '--out', out)
  assert.match(drifted.stderr, /core\.md is missing or stale/)
  assert.match(drifted.stderr, /retired\.md is not generated from any pack/)

  assert.equal(run('--out', out).status, 0)
  assert.equal(run('--check', '--out', out).status, 0)
  assert.equal(readdirSync(out).includes('retired.md'), false)
})
