import { spawnSync } from 'node:child_process'
import process from 'node:process'

const config = 'tooling/antislop/effect/oxlint.test.config.json'
const projectConfig = 'tooling/antislop/effect/project-oxlint.config.json'
const sourceCheck = spawnSync('pnpm', ['exec', 'oxlint', 'plugins/@dshfiles', 'tooling/dshx/packages/dshx/src/effect', '--config', projectConfig], {
  encoding: 'utf8',
})
const sourceOutput = `${sourceCheck.stdout ?? ''}${sourceCheck.stderr ?? ''}`
console.log(`${sourceCheck.status === 0 ? 'PASS' : 'FAIL'} Effect anti-slop source scan`)
if (sourceCheck.status !== 0) {
  process.stderr.write(sourceOutput)
  process.exitCode = 1
}

const fixtures = [
  {
    bad: 'tooling/antislop/effect/tests/oxlint/domain/invalid-run.ts',
    good: 'tooling/antislop/effect/tests/oxlint/adapters/valid-run.ts',
    rule: 'effect-antislop(no-domain-effect-run)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/promise-lift.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/promise-lift.ts',
    rule: 'effect-migration(no-effect-api-promise-lift)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/promise-lift-namespace.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/promise-lift.ts',
    rule: 'effect-migration(no-effect-api-promise-lift)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/try-catch.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/try-catch.ts',
    rule: 'effect-migration(no-try-catch-around-effect)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/tagged-error.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/tagged-error.ts',
    rule: 'effect-migration(require-curried-tagged-error)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/raw-error.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/raw-error.ts',
    rule: 'effect-migration(no-raw-error-in-effect)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/timer.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/timer.ts',
    rule: 'effect-migration(no-unscoped-plugin-timer)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/timer-release.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/timer.ts',
    rule: 'effect-migration(no-unscoped-plugin-timer)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/host-run.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/host-run.ts',
    rule: 'effect-migration(no-run-promise-in-host-handler)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/host-run-object.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/host-run.ts',
    rule: 'effect-migration(no-run-promise-in-host-handler)',
  },
  {
    bad: 'tooling/antislop/effect/repo-rules/fixtures/bad/context-get.ts',
    good: 'tooling/antislop/effect/repo-rules/fixtures/good/context-get.ts',
    rule: 'effect-migration(no-cordis-get-outside-root-layer)',
  },
]

let failed = false
for (const fixture of fixtures) {
  for (const [kind, file] of [
    ['bad', fixture.bad],
    ['good', fixture.good],
  ]) {
    const result = spawnSync('pnpm', ['exec', 'oxlint', '--config', config, file], { encoding: 'utf8' })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    const passed = kind === 'bad' ? result.status !== 0 && output.includes(fixture.rule) : result.status === 0
    console.log(`${passed ? 'PASS' : 'FAIL'} ${file}`)
    if (!passed) {
      failed = true
      process.stderr.write(output)
    }
  }
}

if (failed) process.exitCode = 1
