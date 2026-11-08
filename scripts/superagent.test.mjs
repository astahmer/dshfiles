import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Superagent } from './superagent.mjs'

const { assertDedicatedProfile, fetchSteps, installSteps, loadPin, mergePatch, renderPatch, resolveOptions } = Superagent

const options = { stateDir: '/srv/agent/state', port: 3082 }

test('the checked-in pin names the upstream repository at a full commit', () => {
  const pin = loadPin()
  assert.equal(pin.repository, 'https://github.com/deepseek-ai/dsh-superagent-prototype')
  assert.match(pin.commit, /^[0-9a-f]{40}$/)
  assert.equal(pin.license, 'MIT')
})

test('a pin with an abbreviated commit or another host fails closed', t => {
  const directory = mkdtempSync(join(tmpdir(), 'superagent-pin-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'pin.json')
  writeFileSync(path, JSON.stringify({ repository: 'https://github.com/deepseek-ai/dsh-superagent-prototype', commit: '8c32a9d', package: 'dsh-superagent' }))
  assert.throws(() => loadPin(path), /full 40-character commit/)
  writeFileSync(path, JSON.stringify({ repository: 'https://example.com/x/y', commit: 'a'.repeat(40), package: 'dsh-superagent' }))
  assert.throws(() => loadPin(path), /github\.com/)
})

test('options default to a machine-local checkout and a stateDir under DSH_HOME', () => {
  const resolved = resolveOptions(['plan'], { HOME: '/home/me' })
  assert.equal(resolved.profile, 'superagent')
  assert.equal(resolved.source, '/home/me/.local/share/dshfiles/dsh-superagent')
  assert.equal(resolved.stateDir, '/home/me/.dsh/state/superagent')
  assert.equal(resolved.port, 3082)
  const custom = resolveOptions(['install', '--profile', 'agent-2', '--port', '3090'], {
    HOME: '/home/me',
    DSH_HOME: '/data/dsh',
    DSH_SUPERAGENT_SOURCE: '/opt/sa',
  })
  assert.deepEqual([custom.source, custom.stateDir, custom.port], ['/opt/sa', '/data/dsh/state/agent-2', 3090])
})

test('options refuse a relative stateDir, a bad port, a bad profile name and an unknown command', () => {
  assert.throws(() => resolveOptions(['install', '--state-dir', 'state'], { HOME: '/h' }), /absolute/)
  assert.throws(() => resolveOptions(['install', '--port', '70000'], { HOME: '/h' }), /--port/)
  assert.throws(() => resolveOptions(['install', '--profile', '../web'], { HOME: '/h' }), /Profile name/)
  assert.throws(() => resolveOptions(['deploy'], { HOME: '/h' }), /Unknown command/)
})

test('the web profile and any seeded profile are refused', () => {
  assert.throws(() => assertDedicatedProfile('web'), /dedicated profile/)
  assert.doesNotThrow(() => assertDedicatedProfile('superagent'))
})

test('fetch clones only when the checkout is missing and always detaches at the pin', () => {
  const pin = { repository: 'https://github.com/deepseek-ai/dsh-superagent-prototype', commit: 'a'.repeat(40) }
  assert.deepEqual(
    fetchSteps(pin, '/src/sa', false).map(step => (step.argv[1] === '-C' ? step.argv.slice(3) : step.argv.slice(0, 2))),
    [
      ['git', 'clone'],
      ['fetch', '--no-tags', 'origin', pin.commit],
      ['checkout', '--detach', pin.commit],
    ],
  )
  assert.equal(fetchSteps(pin, '/src/sa', true).length, 2)
})

test('install creates the profile and links the bundle only when missing', () => {
  const base = { dsh: 'dsh', profile: 'superagent', source: '/src/sa' }
  assert.deepEqual(
    installSteps(base, false, false).map(step => step.argv),
    [
      ['dsh', 'superagent', '--from-default-profile', 'web', '--dump-config'],
      ['dsh', 'plugin', '--profile', 'superagent', 'add', 'link:/src/sa'],
    ],
  )
  assert.deepEqual(installSteps(base, true, true), [])
})

test('the rows replace the template empty list and are added once', () => {
  const template = '# Your patch layer for this dsh profile.\n[]\n'
  const first = mergePatch(template, options)
  assert.equal(first.changed, true)
  assert.doesNotMatch(first.text, /^\[\]$/m)
  assert.match(first.text, /^# Your patch layer/)
  assert.match(first.text, /stateDir: "\/srv\/agent\/state"/)
  assert.deepEqual(mergePatch(first.text, options), { text: first.text, changed: false })
  assert.equal(mergePatch(undefined, options).text, renderPatch(options))
})

test('an operator webserver row is kept and not duplicated', () => {
  const merged = mergePatch('- id: webserver\n  config:\n    port: 4000\n', options)
  assert.equal(merged.keptWebserver, true)
  assert.equal(merged.text.match(/id: webserver/g)?.length, 1)
  assert.match(merged.text, /- id: dsh-superagent\n/)
})
