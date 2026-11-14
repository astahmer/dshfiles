import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BEGIN, derive, END, OVERRIDES, SEED, withDerived } from './standard-preset.mjs'

test('the seed preset-standard row is the one the pinned core derives', () => {
  const seed = readFileSync(SEED, 'utf8')
  assert.equal(
    withDerived(seed, derive()),
    seed,
    'preset-standard no longer matches the installed @deepseek-ai/dsh-web-app standard preset: run node scripts/dsh-compat/standard-preset.mjs --write and review the diff',
  )
})

test('the derived row sits inside the managed region, once', () => {
  const seed = readFileSync(SEED, 'utf8')
  const region = seed.slice(seed.indexOf('# BEGIN NIX-MANAGED DSH PLUGINS'), seed.indexOf('# END NIX-MANAGED DSH PLUGINS'))
  assert.ok(region.includes(BEGIN) && region.includes(END), 'profile-sync only reconciles the managed region into existing profiles')
  assert.equal(seed.split('- id: preset-standard').length - 1, 1, 'a second preset-standard row would silently override or be overridden')
})

test('every override applies to the derived row', () => {
  const block = derive()
  for (const override of OVERRIDES) {
    assert.match(block, new RegExp(`- id: ${override.id}\\n`), override.id)
    if (override.name !== undefined) assert.match(block, new RegExp(`- id: ${override.id}\\n\\s+name: '${override.name}'`), override.id)
  }
  const body = block.slice(block.indexOf('- id: preset-standard'))
  assert.doesNotMatch(body, /customSkillDirs/)
  assert.doesNotMatch(body, /list-agents|modelSelectionSettings/)
})
