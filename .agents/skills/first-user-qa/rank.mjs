import { readFileSync } from 'node:fs'

const personas = new Set(['impatient', 'careful', 'mobile', 'literal', 'breaker'])

try {
  const findings = JSON.parse(readFileSync(0, 'utf8'))
  if (!Array.isArray(findings)) throw new Error('expected an array of normalized findings')

  const ids = new Set()
  const ranked = findings.map(finding => {
    if (typeof finding?.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(finding.id) || ids.has(finding.id))
      throw new Error('each normalized finding needs a unique lowercase slug id')
    ids.add(finding.id)
    if (!Array.isArray(finding.observations) || finding.observations.length === 0) throw new Error(`${finding.id}: expected at least one observation`)
    const seen = new Set()
    for (const observation of finding.observations) {
      if (!personas.has(observation?.persona)) throw new Error(`${finding.id}: unknown persona`)
      seen.add(observation.persona)
    }
    return { ...finding, count: seen.size }
  })

  ranked.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id, 'en'))
  process.stdout.write(`${JSON.stringify(ranked, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`first-user-qa: ${error.message}\n`)
  process.exitCode = 1
}
