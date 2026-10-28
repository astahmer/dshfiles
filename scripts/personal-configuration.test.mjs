import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { parseDocument } from 'yaml'

const root = resolve(import.meta.dirname, '..')
test('shared web seed contains no account/model/persona selection', () => {
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'profiles/web/ai-accounts.json'), 'utf8')), { accounts: [] })
  const text = readFileSync(join(root, 'profiles/web/cordis.patch.yml'), 'utf8')
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
  assert.equal(document.errors.length, 0)
  const rows = document.toJSON()
  assert.equal(
    rows.some(row => row.id === 'agent-default-model'),
    false,
  )
  assert.doesNotMatch(text, /secret:|codex-alex|codex-emialex|\/home\//)
  assert.ok(rows.some(row => row.id === 'preset-standard'))
  assert.ok(rows.some(row => row.id === 'web'))
})

test('real web reconciler seeds no accounts and preserves existing user choices byte-for-byte', t => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-personal-seed-'))
  t.after(() => {
    assert.equal(dirname(home), tmpdir())
    rmSync(home, { recursive: true, force: true })
  })
  const bin = join(home, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }
  const dsh = join(home, 'dsh')
  const run = () =>
    spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'scripts/profile-sync.ts'), '--profile', 'web', '--home', dsh], {
      env,
      encoding: 'utf8',
    })
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  const accountFile = join(dsh, 'plugins/ai-accounts/accounts.json')
  assert.deepEqual(JSON.parse(readFileSync(accountFile, 'utf8')), { accounts: [] })
  const patchFile = join(dsh, 'profiles/web/cordis.patch.yml')
  const patch = readFileSync(patchFile, 'utf8')
  const localPatch = `# Local settings stay local\n- id: agent-default-model\n  config:\n    provider: fixture-choice\n    model: fixture-model\n${patch}`
  const accounts = '{"accounts":[{"instanceId":"fixture-choice","displayName":"My local choice"}]}\n'
  writeFileSync(accountFile, accounts)
  writeFileSync(patchFile, localPatch)
  const second = run()
  assert.equal(second.status, 0, second.stderr)
  assert.equal(readFileSync(accountFile, 'utf8'), accounts)
  assert.equal(readFileSync(patchFile, 'utf8'), localPatch)
})
