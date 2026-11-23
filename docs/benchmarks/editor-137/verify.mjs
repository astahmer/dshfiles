import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const data = name => {
  const input = readFileSync(new URL(`samples/${name}.jsonl`, import.meta.url), 'utf8').trim()
  assert(!/https?:|\/Users\/|token[=:]|session-/i.test(input), 'Sample file contains a URL, personal path, or session identifier.')
  return input.split('\n').map(JSON.parse)
}
const doc = readFileSync(new URL('../../performance.md', import.meta.url), 'utf8')
const range = values => {
  const sorted = values.toSorted((a, b) => a - b)
  return `${sorted[Math.floor(sorted.length / 2)]} [${sorted[0]}–${sorted.at(-1)}]`
}
const desktop = data('editor-desktop')
assert.equal(desktop.length, 30)
for (const [mode, name] of [
  ['current', 'Current 0.57.0'],
  ['modern-core', 'Modern 0.4.2 `core`'],
  ['modern-full', 'Modern 0.4.2 full'],
]) {
  const subset = cache => desktop.filter(row => row.mode === mode && row.cache === cache)
  const cold = subset('cold')
  const warm = subset('warm')
  assert.equal(cold.length, 5)
  assert.equal(warm.length, 5)
  assert(warm.every(row => row.open.gzip === 0 && row.open.requests === 0))
  assert(cold.concat(warm).every(row => row.undoSaveRevealSwitch === 'pass' && row.external.length === 0))
  const { raw, gzip, requests } = cold[0].open
  assert(cold.every(row => row.open.raw === raw && row.open.gzip === gzip && row.open.requests === requests))
  const times = [cold, warm].flatMap(rows => ['sourceDomMs', 'typedMs'].map(key => range(rows.map(row => row[key]))))
  assert(doc.includes(`| ${name} | ${(raw / 1e6).toFixed(2)} / ${(gzip / 1e6).toFixed(2)} (${requests}) | ${times.join(' | ')} |`))
}
const native = data('native-desktop')
assert.equal(native.length, 10)
for (const file of ['sample.ts', 'second.ts']) {
  const rows = native.filter(row => row.file === file)
  assert.equal(rows.length, 5)
  assert(doc.includes(range(rows.map(row => row.phase.ms))))
  assert(rows.every(row => row.phase.response.every(response => ['read', 'stat', 'canOpenWorkspacePath'].includes(response.file))))
}
assert.equal(data('native-webkit').length, 2)
assert.equal(data('editor-webkit').length, 5)
const rerun = data('editor-webkit-rerun')
assert.equal(rerun.length, 6)
assert(rerun.filter(row => row.mode === 'current').every(row => row.undoSaveRevealSwitch === 'pass'))
const rejected = rerun.find(row => row.mode === 'modern-full' && row.cache === 'warm')
assert(rejected?.outcome === 'failed' && rejected.step === 'exact first edit' && rejected.errors.includes('Model is disposed!'))
console.log('Verified 3 editor rows, 2 native timing ranges, and sanitized WebKit and network sample rows.')
