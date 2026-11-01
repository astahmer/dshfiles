#!/usr/bin/env node
import { resolve } from 'node:path'

const fixturePath = process.argv[2]
if (!fixturePath) {
  console.error('Usage: node scripts/effect-schema-parity.mjs <fixture-module>')
  process.exit(2)
}
const fixtureModule = await import(`${new URL(`file://${resolve(process.cwd(), fixturePath)}`).href}?run=${Date.now()}`)
if (!Array.isArray(fixtureModule.fixtures)) throw new Error('Fixture module must export fixtures')
const normalize = value => {
  if (Array.isArray(value)) return value.map(normalize)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value).filter(
    ([key, child]) => key !== '$schema' && !(key === 'definitions' && Object.keys(child).length === 0) && key !== 'dialect',
  )
  const normalized = Object.fromEntries(entries.map(([key, child]) => [key, normalize(child)]))
  if ('const' in normalized) {
    const constant = normalized.const
    delete normalized.const
    normalized.enum = [constant]
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)))
}
const differences = (left, right, path = '$') => {
  if (JSON.stringify(left) === JSON.stringify(right)) return []
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    return keys.flatMap(key =>
      key in left && key in right ? differences(left[key], right[key], `${path}.${key}`) : [{ path: `${path}.${key}`, left: left[key], right: right[key] }],
    )
  }
  return [{ path, left, right }]
}
const results = fixtureModule.fixtures.map(fixture => {
  const effectDocument = fixtureModule.Schema.toJsonSchemaDocument(fixture.effect, { additionalProperties: false }).schema
  const expectedSchema = normalize(fixture.expectedSchema)
  const effectSchema = normalize(effectDocument)
  const diff = differences(expectedSchema, effectSchema)
  const effectResult = fixtureModule.Schema.decodeUnknownOption(fixture.effect)(fixture.input)
  const roundTrip = effectResult._tag === 'Some' && JSON.stringify(fixture.expectedOutput) === JSON.stringify(effectResult.value)
  return { name: fixture.name, equal: diff.length === 0, roundTrip, diff }
})
const report = {
  fixtures: results.length,
  mismatches: results.filter(result => !result.equal).length,
  roundTripFailures: results.filter(result => !result.roundTrip).length,
  results,
}
console.log(JSON.stringify(report, null, 2))
if (report.fixtures === 0 || report.mismatches > 0 || report.roundTripFailures > 0) process.exitCode = 1
