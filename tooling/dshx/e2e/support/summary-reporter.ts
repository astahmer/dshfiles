import { basename } from 'node:path'
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

interface FeatureTally {
  passed: number
  failed: number
  durationMs: number
}

interface ScenarioFailure {
  readonly feature: string
  readonly scenario: string
  readonly reason: string
}

const featureName = (test: TestCase): string => basename(test.location.file).replace(/\.feature\.spec\.js$/, '')

const scenarioTitle = (test: TestCase): string => test.title.replace(/\s+@scenario:\S+/g, '').trim()

// The first message line plus its locator: "toBeVisible() failed" alone does not say what was missing. The full
// message stays in the list reporter above and in the evidence receipt.
const failureReason = (result: TestResult): string => {
  const message = result.errors[0]?.message ?? `ended ${result.status}`
  const lines = message
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
  const locator = lines.find(line => line.startsWith('Locator:'))
  return [lines[0] ?? message, locator]
    .filter(line => line !== undefined)
    .join(' · ')
    .slice(0, 300)
}

const seconds = (durationMs: number): string => `${(durationMs / 1000).toFixed(0)}s`

/** Prints a compact end-of-run summary: totals, wall time, failures and the slowest feature files. */
export default class SummaryReporter implements Reporter {
  private readonly features = new Map<string, FeatureTally>()
  private readonly finalResults = new Map<TestCase, TestResult>()

  onTestEnd(test: TestCase, result: TestResult): void {
    this.finalResults.set(test, result)
  }

  onEnd(result: FullResult): void {
    const failures: ScenarioFailure[] = []
    let skipped = 0
    for (const [test, testResult] of this.finalResults) {
      if (testResult.status === 'skipped') {
        skipped += 1
        continue
      }
      const feature = featureName(test)
      const tally = this.features.get(feature) ?? { passed: 0, failed: 0, durationMs: 0 }
      tally.durationMs += testResult.duration
      if (test.outcome() === 'expected' || test.outcome() === 'flaky') tally.passed += 1
      else {
        tally.failed += 1
        failures.push({ feature, scenario: scenarioTitle(test), reason: failureReason(testResult) })
      }
      this.features.set(feature, tally)
    }
    const passed = [...this.features.values()].reduce((sum, tally) => sum + tally.passed, 0)
    const slowest = [...this.features.entries()].sort(([, left], [, right]) => right.durationMs - left.durationMs).slice(0, 5)
    const lines = [
      '',
      `check:e2e ${result.status}: ${String(passed)} passed, ${String(failures.length)} failed, ${String(skipped)} skipped in ${seconds(result.duration)}`,
      ...failures.map(failure => `  FAIL ${failure.feature} › ${failure.scenario}\n       ${failure.reason}`),
      `  slowest: ${slowest.map(([feature, tally]) => `${feature} ${seconds(tally.durationMs)}`).join(', ')}`,
      '',
    ]
    process.stdout.write(`${lines.join('\n')}\n`)
  }

  printsToStdio(): boolean {
    return true
  }
}
