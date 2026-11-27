import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SecretRefs } from './check-secret-refs.mjs'

test('collects distinct secret references with their environment and ignores plain text', () => {
  const text = [
    'apiKey: secret:brave-api-key',
    'jevSecret: secret:DSH_JEV_MEMORY',
    'spare: secret:brave-api-key@dev',
    'same: secret:brave-api-key',
    'docs: "write secret:ALIAS in a field"',
  ].join('\n')
  assert.deepEqual(SecretRefs.collect(text), [
    { alias: 'brave-api-key', environment: 'prod' },
    { alias: 'DSH_JEV_MEMORY', environment: 'prod' },
    { alias: 'brave-api-key', environment: 'dev' },
    { alias: 'ALIAS', environment: 'prod' },
  ])
})

test('separates an alias that never resolves from one only a non-global scope offers', () => {
  const inventory = [
    { alias: 'DSH_JEV_MEMORY', env: 'prod', scope: 'global' },
    { alias: 'project-only', env: 'prod', scope: 'project' },
  ]
  const { missing, narrow } = SecretRefs.check(
    [
      { alias: 'DSH_JEV_MEMORY', environment: 'prod' },
      { alias: 'project-only', environment: 'prod' },
      { alias: 'brave-api-key', environment: 'prod' },
      { alias: 'DSH_JEV_MEMORY', environment: 'dev' },
    ],
    inventory,
  )
  assert.deepEqual(
    missing.map(reference => reference.alias),
    ['brave-api-key', 'DSH_JEV_MEMORY'],
  )
  assert.deepEqual(narrow, [{ alias: 'project-only', environment: 'prod', scopes: ['project'] }])
})

test('reads the config files of each profile directory, not the whole profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'secret-refs-'))
  mkdirSync(join(root, 'web'))
  mkdirSync(join(root, 'probe'))
  writeFileSync(join(root, 'web', 'cordis.patch.yml'), 'apiKey: secret:brave-api-key\n')
  writeFileSync(join(root, 'web', 'README.md'), 'secret:not-a-config\n')
  assert.deepEqual(SecretRefs.configFiles(root), [join(root, 'web', 'cordis.patch.yml')])
  assert.deepEqual(SecretRefs.configFiles(join(root, 'absent')), [])
})
