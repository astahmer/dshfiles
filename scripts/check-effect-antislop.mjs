import { spawnSync } from 'node:child_process'
import process from 'node:process'

const config = 'tooling/antislop/effect/oxlint.test.config.json'
const fixtures = [
  {
    file: 'tooling/antislop/effect/tests/oxlint/domain/invalid-run.ts',
    shouldFail: true,
  },
  {
    file: 'tooling/antislop/effect/tests/oxlint/adapters/valid-run.ts',
    shouldFail: false,
  },
]

let failed = false
for (const fixture of fixtures) {
  const result = spawnSync('pnpm', ['exec', 'oxlint', '--config', config, fixture.file], { encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const passed = fixture.shouldFail
    ? result.status !== 0 && output.includes('effect-antislop(no-domain-effect-run)')
    : result.status === 0
  console.log(`${passed ? 'PASS' : 'FAIL'} ${fixture.file}`)
  if (!passed) {
    failed = true
    process.stderr.write(output)
  }
}

if (failed) process.exitCode = 1
