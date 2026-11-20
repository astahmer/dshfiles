import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VitestReport } from './vitest-report.js'

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('VitestReport.parse', () => {
  it('reads failing files, assertion diffs, code frames and timeouts from the default reporter', () => {
    const run = VitestReport.parse(`${fixture('vitest-default.txt')}\n[exit code: 1]`)
    expect(run?.testTally).toEqual({ passed: 5, failed: 2, skipped: 1, total: 8 })
    expect(run?.fileTally).toEqual({ passed: 1, failed: 2, skipped: 0, total: 3 })
    expect(run?.unlistedFiles).toBe(1)
    expect(run?.durationMs).toBe(4670)
    expect(run?.root).toBe('/repo/shop')
    expect(run?.files.map(file => [file.path, file.status, file.testCount, file.failedCount, file.skippedCount])).toEqual([
      ['src/cart/pricing.test.ts', 'failed', 4, 1, 1],
      ['src/cart/sync.test.ts', 'failed', 2, 1, 0],
    ])
    const coupon = run?.files[0]?.tests[0]
    expect(coupon?.suites).toEqual(['applyCoupon'])
    expect(coupon?.status).toBe('failed')
    expect(coupon?.durationMs).toBe(26)
    expect(coupon?.failure?.errorName).toBe('AssertionError')
    expect(coupon?.failure?.location).toEqual({ file: 'src/cart/pricing.test.ts', line: 9, column: 75 })
    expect(coupon?.failure?.diff.filter(line => line.kind !== 'context').map(line => `${line.kind} ${line.text.trim()}`)).toEqual([
      'expected "discount": 420,',
      'received "discount": 840,',
      'expected "total": 3780,',
      'received "total": 3360,',
    ])
    expect(coupon?.failure?.codeFrame.map(line => line.number)).toEqual([7, 8, 9, 10, 11])
    const timeout = run?.files[1]?.tests[0]
    expect(timeout?.status).toBe('timeout')
    expect(timeout?.failure?.message).toBe('Test timed out in 500ms.')
    expect(timeout?.failure?.hint).toMatch(/^If this is a long-running test/)
  })

  it('lists every test with its suites from the verbose reporter', () => {
    const run = VitestReport.parse(fixture('vitest-verbose.txt'))
    expect(run?.unlistedFiles).toBe(0)
    const pricing = run?.files.find(file => file.path === 'src/cart/pricing.test.ts')
    expect(pricing?.tests.map(test => `${test.status} ${[...test.suites, test.title].join(' > ')}`)).toEqual([
      'passed applyCoupon > takes 10% off the subtotal',
      'failed applyCoupon > applies a coupon only once',
      'skipped applyCoupon > stacks with gift cards',
      'passed formatTotal > rounds to the nearest cent',
    ])
    const money = run?.files.find(file => file.path === 'src/lib/money.test.ts')
    expect(money?.status).toBe('passed')
    expect(money?.tests.filter(test => VitestReport.isSlow(test)).map(test => test.title)).toEqual(['slow conversion'])
  })

  it('reads the coloured reporter a DSH shell gets, which indents every test without naming its describe blocks', () => {
    const run = VitestReport.parse(fixture('vitest-color.txt'))
    expect(run?.unlistedFiles).toBe(0)
    const pricing = run?.files.find(file => file.path === 'src/cart/pricing.test.ts')
    expect(pricing?.tests.map(test => [test.title, test.status, test.suitesKnown, test.suites.join(' > ')])).toEqual([
      ['takes 10% off the subtotal', 'passed', false, ''],
      ['applies a coupon only once', 'failed', true, 'applyCoupon'],
      ['stacks with gift cards', 'skipped', false, ''],
      ['rounds to the nearest cent', 'passed', false, ''],
    ])
    expect(run?.files.find(file => file.path === 'src/lib/money.test.ts')?.tests.map(test => test.title)).toEqual(['slow conversion'])
  })

  it('summarises an all-green run even though the default reporter lists no file', () => {
    const run = VitestReport.parse(fixture('vitest-pass.txt'))
    expect(run?.files).toEqual([])
    expect(run?.testTally).toEqual({ passed: 2, failed: 0, skipped: 0, total: 2 })
    expect(run?.unlistedFiles).toBe(1)
    expect(run && VitestReport.summaryLabel(run)).toBe('2 passed')
  })

  it('shows failed test files separately when their tests all passed', () => {
    const run = VitestReport.parse(` RUN  v3.0.0 /repo/shop\n\n Test Files  1 failed | 4 passed (5)\n      Tests  20 passed (20)\n   Duration  5.2s`)
    expect(run?.fileTally.failed).toBe(1)
    expect(run?.testTally.failed).toBe(0)
    expect(run && VitestReport.summaryLabel(run)).toBe('1 test file failed · 20 passed')
  })

  it('matches every failing block of a long failing file to its own test', () => {
    const count = 50
    const lines = [' RUN  v4.1.11 /repo/shop', '']
    for (let at = 0; at < count; at++) lines.push(` × src/mega.test.ts > suite > case ${at} ${at + 1}ms`)
    lines.push('', `⎯⎯⎯⎯ Failed Tests ${count} ⎯⎯⎯⎯`, '')
    for (let at = 0; at < count; at++) {
      lines.push(` FAIL  src/mega.test.ts > suite > case ${at}`, `AssertionError: expected ${at} to equal 0`, '', '⎯⎯⎯⎯', '')
    }
    lines.push(' Test Files  1 failed (1)', `      Tests  ${count} failed (${count})`, '   Duration  4.32s')

    const file = VitestReport.parse(lines.join('\n'))?.files[0]
    expect(file?.tests).toHaveLength(count)
    expect(file?.tests.map(test => [test.title, test.durationMs, test.failure?.message])).toEqual(
      Array.from({ length: count }, (_unused, at) => [`case ${at}`, at + 1, `expected ${at} to equal 0`]),
    )
  })

  it('leaves output that carries no Vitest summary to the native card', () => {
    expect(VitestReport.parse('total 0\ndrwxr-xr-x  2 me  staff  64 Oct 19 .\n[exit code: 0]')).toBeUndefined()
  })
})

describe('the card headline and filters', () => {
  const run = (failed: number, passed: number, skipped = 0, failedFiles = 0) => ({
    testTally: { passed, failed, skipped, total: passed + failed + skipped },
    fileTally: { passed: 1, failed: failedFiles, skipped: 0, total: 1 + failedFiles },
  })

  it('marks only the failed count as a failure, never "4 passed"', () => {
    expect(VitestReport.summaryParts(run(1, 4))).toEqual([
      { text: '1 failed', failed: true },
      { text: '4 passed', failed: false },
    ])
    expect(VitestReport.summaryParts(run(0, 5, 2))).toEqual([
      { text: '5 passed', failed: false },
      { text: '2 skipped', failed: false },
    ])
    expect(VitestReport.summaryParts(run(0, 3, 0, 1))[0]).toEqual({ text: '1 test file failed', failed: true })
  })

  it('reads the same as the one-string label', () => {
    for (const sample of [run(1, 4), run(0, 5, 2), run(0, 3, 0, 2), run(2, 0, 1)]) {
      expect(
        VitestReport.summaryParts(sample)
          .map(part => part.text)
          .join(' · '),
      ).toBe(VitestReport.summaryLabel(sample))
    }
  })

  it('offers no filter that would match nothing', () => {
    const filters = ['all', 'failed', 'skipped', 'slow'] as const
    expect(VitestReport.shownFilters(filters, { all: 5, failed: 1, skipped: 0, slow: 0 }, 'all')).toEqual(['all', 'failed'])
    expect(VitestReport.shownFilters(filters, { all: 5, failed: 0, skipped: 0, slow: 0 }, 'all')).toEqual(['all'])
    // The selected filter stays while it is selected, so the list never loses its own control.
    expect(VitestReport.shownFilters(filters, { all: 5, failed: 0, skipped: 0, slow: 0 }, 'slow')).toEqual(['all', 'slow'])
  })
})
