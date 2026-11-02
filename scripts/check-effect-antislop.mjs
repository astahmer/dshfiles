import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const effectDirectory = 'tooling/antislop/effect'
const fixtureConfig = `${effectDirectory}/oxlint.test.config.json`
const projectConfig = `${effectDirectory}/project-oxlint.config.json`
const baselinePath = `${repositoryRoot}${effectDirectory}/baseline.json`
const sourceRoots = ['plugins/@dshfiles', 'tooling/dshx/packages/dshx/src']
const effectRulePrefixes = ['effect-antislop(', 'effect-migration(']
const update = process.argv.includes('--update')

const runOxlint = args => {
  const result = spawnSync('pnpm', ['exec', 'oxlint', ...args, '--format', 'json'], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.error) throw result.error
  return JSON.parse(result.stdout).diagnostics.filter(diagnostic => effectRulePrefixes.some(prefix => diagnostic.code?.startsWith(prefix)))
}

const countByRuleAndFile = diagnostics => {
  const counts = {}
  for (const diagnostic of diagnostics) {
    counts[diagnostic.code] ??= {}
    counts[diagnostic.code][diagnostic.filename] = (counts[diagnostic.code][diagnostic.filename] ?? 0) + 1
  }
  return counts
}

const sorted = counts =>
  Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map(rule => [
        rule,
        Object.fromEntries(
          Object.keys(counts[rule])
            .sort()
            .map(file => [file, counts[rule][file]]),
        ),
      ]),
  )

const firstLine = diagnostic => diagnostic.labels?.[0]?.span?.line ?? 0

const checkSources = () => {
  const diagnostics = runOxlint([...sourceRoots, '--config', projectConfig])
  const current = countByRuleAndFile(diagnostics)
  if (update) {
    writeFileSync(baselinePath, `${JSON.stringify(sorted(current), null, 2)}\n`)
    console.log(`UPDATED ${effectDirectory}/baseline.json (${diagnostics.length} findings)`)
    return true
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  let passed = true
  let improvable = 0
  for (const rule of Object.keys(current).sort()) {
    for (const file of Object.keys(current[rule]).sort()) {
      const allowed = baseline[rule]?.[file] ?? 0
      if (current[rule][file] <= allowed) continue
      passed = false
      console.error(`${rule} ${file}: ${current[rule][file]} findings, baseline ${allowed}`)
      for (const diagnostic of diagnostics.filter(item => item.code === rule && item.filename === file)) {
        console.error(`  ${file}:${firstLine(diagnostic)} ${diagnostic.message}`)
      }
    }
  }
  for (const rule of Object.keys(baseline)) {
    for (const file of Object.keys(baseline[rule])) improvable += Math.max(0, baseline[rule][file] - (current[rule]?.[file] ?? 0))
  }
  console.log(`${passed ? 'PASS' : 'FAIL'} Effect anti-slop source scan: ${diagnostics.length} findings, ratchet baseline ${effectDirectory}/baseline.json`)
  if (improvable > 0) console.log(`  ${improvable} baseline findings are gone; run node scripts/check-effect-antislop.mjs --update to lower the baseline`)
  return passed
}

const repoFixture = name => ({ bad: `${effectDirectory}/repo-rules/fixtures/bad/${name}.ts`, good: `${effectDirectory}/repo-rules/fixtures/good/${name}.ts` })

const fixtures = [
  {
    bad: `${effectDirectory}/tests/oxlint/domain/invalid-run.ts`,
    good: `${effectDirectory}/tests/oxlint/adapters/valid-run.ts`,
    rule: 'effect-antislop(no-domain-effect-run)',
  },
  {
    bad: `${effectDirectory}/tests/oxlint/implementation/invalid-silent-error.ts`,
    good: `${effectDirectory}/tests/oxlint/implementation/valid-silent-error.ts`,
    rule: 'effect-antislop(no-silent-error-swallow)',
  },
  { ...repoFixture('promise-lift'), rule: 'effect-migration(no-effect-api-promise-lift)' },
  {
    bad: `${effectDirectory}/repo-rules/fixtures/bad/promise-lift-namespace.ts`,
    good: repoFixture('promise-lift').good,
    rule: 'effect-migration(no-effect-api-promise-lift)',
  },
  { ...repoFixture('try-catch'), rule: 'effect-migration(no-try-catch-around-effect)' },
  { ...repoFixture('tagged-error'), rule: 'effect-migration(require-curried-tagged-error)' },
  { ...repoFixture('raw-error'), rule: 'effect-migration(no-raw-error-in-effect)' },
  { ...repoFixture('timer'), rule: 'effect-migration(no-unscoped-plugin-timer)' },
  { bad: `${effectDirectory}/repo-rules/fixtures/bad/timer-release.ts`, good: repoFixture('timer').good, rule: 'effect-migration(no-unscoped-plugin-timer)' },
  { ...repoFixture('host-run'), rule: 'effect-migration(no-run-promise-in-host-handler)' },
  {
    bad: `${effectDirectory}/repo-rules/fixtures/bad/host-run-object.ts`,
    good: repoFixture('host-run').good,
    rule: 'effect-migration(no-run-promise-in-host-handler)',
  },
  { ...repoFixture('context-get'), rule: 'effect-migration(no-cordis-get-outside-root-layer)' },
  { ...repoFixture('cause-dropping-catch'), rule: 'effect-migration(no-cause-dropping-catch)', count: 3 },
  { ...repoFixture('empty-plugin-layer'), rule: 'effect-migration(no-empty-plugin-layer)', count: 2 },
  { ...repoFixture('gen-inside-fn'), rule: 'effect-migration(no-gen-inside-fn)', count: 2 },
  { ...repoFixture('repeat-uncaught'), rule: 'effect-migration(no-repeat-over-uncaught-effect)', count: 4 },
  { ...repoFixture('host-module-state'), rule: 'effect-migration(no-host-module-state)', count: 3 },
  { ...repoFixture('host-global-timer'), rule: 'effect-migration(no-host-global-timer)', count: 2 },
  { ...repoFixture('host-child-process'), rule: 'effect-migration(no-host-child-process)', count: 2 },
  { ...repoFixture('void-then'), rule: 'effect-migration(no-void-then)', count: 2 },
  { ...repoFixture('span-name'), rule: 'effect-migration(effect-span-name-format)', count: 3 },
  { ...repoFixture('unstable-import'), rule: 'effect-migration(no-effect-unstable-import)', count: 2 },
]

const checkFixtures = () => {
  const files = [...new Set(fixtures.flatMap(fixture => [fixture.bad, fixture.good]))]
  const diagnostics = runOxlint(['--config', fixtureConfig, ...files])
  const count = (file, rule) => diagnostics.filter(diagnostic => diagnostic.filename === file && diagnostic.code === rule).length
  let passed = true
  for (const fixture of fixtures) {
    const badCount = count(fixture.bad, fixture.rule)
    const badPassed = fixture.count === undefined ? badCount > 0 : badCount === fixture.count
    const goodCount = count(fixture.good, fixture.rule)
    console.log(
      `${badPassed ? 'PASS' : 'FAIL'} ${fixture.bad} ${fixture.rule}: ${badCount} findings${fixture.count === undefined ? '' : `, expected ${fixture.count}`}`,
    )
    console.log(`${goodCount === 0 ? 'PASS' : 'FAIL'} ${fixture.good} ${fixture.rule}: ${goodCount} findings`)
    passed &&= badPassed && goodCount === 0
  }
  return passed
}

const fixturesPassed = checkFixtures()
const sourcesPassed = checkSources()
if (!fixturesPassed || !sourcesPassed) process.exitCode = 1
