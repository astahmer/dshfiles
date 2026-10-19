export type TestStatus = 'passed' | 'failed' | 'skipped' | 'timeout'

export interface DiffLine {
  readonly kind: 'expected' | 'received' | 'context'
  readonly text: string
}

export interface CodeFrameLine {
  readonly number: number
  readonly text: string
}

export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

export interface TestFailure {
  readonly errorName: string
  readonly message: string
  readonly hint: string | undefined
  readonly diff: readonly DiffLine[]
  readonly location: SourceLocation | undefined
  readonly codeFrame: readonly CodeFrameLine[]
  readonly frames: readonly SourceLocation[]
  readonly raw: string
}

export interface TestCase {
  readonly suites: readonly string[]
  /** The default reporter indents a test inside its describe blocks without naming them; only a FAIL block or the verbose reporter names them. */
  readonly suitesKnown: boolean
  readonly title: string
  readonly status: TestStatus
  readonly durationMs: number | undefined
  readonly failure: TestFailure | undefined
}

export interface TestFile {
  readonly path: string
  readonly status: 'passed' | 'failed' | 'skipped'
  readonly testCount: number | undefined
  readonly failedCount: number
  readonly skippedCount: number
  readonly durationMs: number | undefined
  readonly tests: readonly TestCase[]
  readonly error: TestFailure | undefined
}

export interface Tally {
  readonly passed: number
  readonly failed: number
  readonly skipped: number
  readonly total: number
}

export interface TestRun {
  readonly files: readonly TestFile[]
  readonly fileTally: Tally
  readonly testTally: Tally
  readonly durationMs: number | undefined
  /** The default reporter prints only files with failures; this many passing files never reached the output. */
  readonly unlistedFiles: number
}

interface MutableFile {
  path: string
  status: TestFile['status']
  testCount: number | undefined
  failedCount: number
  skippedCount: number
  durationMs: number | undefined
  tests: TestCase[]
  error: TestFailure | undefined
}

// oxlint-disable-next-line no-control-regex -- terminal colour codes are exactly what this strips
const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/g
const FILE_LINE = /^ ([✓❯×↓]) (\S+) \((\d+) tests?((?: \| \d+ \w+)*)\)(?: (\d+(?:\.\d+)?)(ms|s))?$/
const VERBOSE_TEST_LINE = /^ ([✓×↓]) (\S+\.\w+) > (.+?)(?: (\d+(?:\.\d+)?)(ms|s))?$/
const NESTED_TEST_LINE = /^ {3,}([✓×↓]) (.+?)(?: (\d+(?:\.\d+)?)(ms|s))?$/
const FAIL_HEADER = /^ FAIL {2}(\S+)(?: > (.+))?$/
const SECTION_RULE = /^⎯{3,}/
const LOCATION_LINE = /^ {0,4}❯ (\S+?):(\d+):(\d+)$/
const CODE_FRAME_LINE = /^ +(\d+)\| ?(.*)$/
const CARET_LINE = /^ +\| +\^/
const ERROR_LINE = /^(\w*(?:Error|Exception)\w*|Error): ?(.*)$/
const TIMEOUT_MESSAGE = /^Test timed out in (\d+)ms\.?$/
const SUMMARY_LINE = /^ +(Test Files|Tests) {2}(.+) \((\d+)\)$/
const DURATION_LINE = /^ +Duration {2}(\d+(?:\.\d+)?)(ms|s)\b/
const DSH_EXIT_FOOTER = /\n\[(?:exit code: -?\d+|exit code: null|killed by signal: [^\]\n]+)\]$/

/** Reads Vitest's default and verbose text reporters, as they land in a shell tool result. */
export class VitestReport {
  /** Vitest's own `slowTestThreshold` default. */
  static readonly slowThresholdMs = 300

  static parse(output: string): TestRun | undefined {
    const lines = output.replace(DSH_EXIT_FOOTER, '').replace(ANSI_PATTERN, '').split(/\r?\n/)
    const summary = VitestReport.summary(lines)
    if (summary === undefined) return undefined
    const files = new Map<string, MutableFile>()
    const fileFor = (path: string): MutableFile => {
      const existing = files.get(path)
      if (existing !== undefined) return existing
      const created: MutableFile = {
        path,
        status: 'passed',
        testCount: undefined,
        failedCount: 0,
        skippedCount: 0,
        durationMs: undefined,
        tests: [],
        error: undefined,
      }
      files.set(path, created)
      return created
    }
    let currentFile: MutableFile | undefined
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? ''
      const fileMatch = FILE_LINE.exec(line)
      if (fileMatch !== null) {
        currentFile = fileFor(fileMatch[2] ?? '')
        const counts = VitestReport.counts(fileMatch[4] ?? '')
        currentFile.testCount = Number(fileMatch[3])
        currentFile.failedCount = counts.failed
        currentFile.skippedCount = counts.skipped
        currentFile.durationMs = VitestReport.milliseconds(fileMatch[5], fileMatch[6])
        currentFile.status = counts.failed > 0 || fileMatch[1] === '×' ? 'failed' : fileMatch[1] === '↓' ? 'skipped' : 'passed'
        continue
      }
      const verboseMatch = VERBOSE_TEST_LINE.exec(line)
      if (verboseMatch !== null) {
        currentFile = undefined
        const names = (verboseMatch[3] ?? '').split(' > ')
        fileFor(verboseMatch[2] ?? '').tests.push({
          suites: names.slice(0, -1),
          suitesKnown: true,
          title: (names.at(-1) ?? '').trim(),
          status: VitestReport.statusOf(verboseMatch[1]),
          durationMs: VitestReport.milliseconds(verboseMatch[4], verboseMatch[5]),
          failure: undefined,
        })
        continue
      }
      const nestedMatch = currentFile === undefined ? null : NESTED_TEST_LINE.exec(line)
      if (nestedMatch !== null && currentFile !== undefined) {
        currentFile.tests.push({
          suites: [],
          suitesKnown: false,
          title: (nestedMatch[2] ?? '').trim(),
          status: VitestReport.statusOf(nestedMatch[1]),
          durationMs: VitestReport.milliseconds(nestedMatch[3], nestedMatch[4]),
          failure: undefined,
        })
        continue
      }
      const failMatch = FAIL_HEADER.exec(line)
      if (failMatch === null) continue
      currentFile = undefined
      const blockEnd = lines.findIndex((candidate, at) => at > index && (SECTION_RULE.test(candidate) || FAIL_HEADER.test(candidate)))
      const block = lines.slice(index + 1, blockEnd === -1 ? lines.length : blockEnd)
      index = (blockEnd === -1 ? lines.length : blockEnd) - 1
      const file = fileFor(failMatch[1] ?? '')
      file.status = 'failed'
      const failure = VitestReport.failure(block)
      if (failMatch[2] === undefined) {
        file.error = failure
        continue
      }
      const names = failMatch[2].split(' > ')
      const title = names.at(-1) ?? ''
      const suites = names.slice(0, -1)
      const status: TestStatus = TIMEOUT_MESSAGE.test(failure.message) ? 'timeout' : 'failed'
      const existing = file.tests.findIndex(
        test => test.title === title && test.status !== 'passed' && (!test.suitesKnown || test.suites.join(' > ') === suites.join(' > ')),
      )
      if (existing === -1) {
        file.tests.push({ suites, suitesKnown: true, title, status, durationMs: undefined, failure })
        continue
      }
      const previous = file.tests[existing]
      file.tests[existing] = { suites, suitesKnown: true, title, status, durationMs: previous?.durationMs, failure }
    }
    const listed = [...files.values()].map(file => ({
      ...file,
      failedCount: Math.max(file.failedCount, file.tests.filter(test => test.status === 'failed' || test.status === 'timeout').length),
      skippedCount: Math.max(file.skippedCount, file.tests.filter(test => test.status === 'skipped').length),
      testCount: file.testCount ?? (file.tests.length > 0 ? file.tests.length : undefined),
    }))
    return {
      files: listed.toSorted((left, right) => Number(right.status === 'failed') - Number(left.status === 'failed')),
      fileTally: summary.files,
      testTally: summary.tests,
      durationMs: summary.durationMs,
      unlistedFiles: Math.max(0, summary.files.total - listed.length),
    }
  }

  static isSlow(test: TestCase): boolean {
    return test.durationMs !== undefined && test.durationMs >= VitestReport.slowThresholdMs
  }

  static fixPrompt(input: { readonly file: string; readonly test: TestCase }): string {
    const name = [...input.test.suites, input.test.title].join(' > ')
    return [`Fix the failing test \`${name}\` in \`${input.file}\`.`, '', '```', input.test.failure?.raw ?? '', '```'].join('\n')
  }

  static rerunPrompt(input: { readonly file: string; readonly test: TestCase }): string {
    return `Rerun only \`${[...input.test.suites, input.test.title].join(' > ')}\` in \`${input.file}\` and report the result.`
  }

  private static summary(lines: readonly string[]): { files: Tally; tests: Tally; durationMs: number | undefined } | undefined {
    let files: Tally | undefined
    let tests: Tally | undefined
    let durationMs: number | undefined
    for (const line of lines) {
      const summaryMatch = SUMMARY_LINE.exec(line)
      if (summaryMatch !== null) {
        const tally = { ...VitestReport.counts(summaryMatch[2] ?? ''), total: Number(summaryMatch[3]) }
        if (summaryMatch[1] === 'Tests') tests = tally
        else files = tally
        continue
      }
      const durationMatch = DURATION_LINE.exec(line)
      if (durationMatch !== null) durationMs = VitestReport.milliseconds(durationMatch[1], durationMatch[2])
    }
    if (files === undefined || tests === undefined) return undefined
    return { files, tests, durationMs }
  }

  private static counts(text: string): Omit<Tally, 'total'> {
    const count = (label: string): number => Number(new RegExp(`(\\d+) ${label}`).exec(text)?.[1] ?? 0)
    return { passed: count('passed'), failed: count('failed'), skipped: count('skipped') + count('todo') }
  }

  private static statusOf(mark: string | undefined): TestStatus {
    if (mark === '×') return 'failed'
    if (mark === '↓') return 'skipped'
    return 'passed'
  }

  private static milliseconds(value: string | undefined, unit: string | undefined): number | undefined {
    if (value === undefined) return undefined
    return unit === 's' ? Number(value) * 1000 : Number(value)
  }

  private static failure(block: readonly string[]): TestFailure {
    const lines = [...block]
    while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop()
    const errorIndex = lines.findIndex(line => ERROR_LINE.test(line))
    const errorMatch = errorIndex === -1 ? null : ERROR_LINE.exec(lines[errorIndex] ?? '')
    const diffStart = lines.findIndex(line => line === '- Expected')
    const firstLocation = lines.findIndex(line => LOCATION_LINE.test(line))
    const messageEnd = [diffStart, firstLocation].filter(at => at > errorIndex).reduce((earliest, at) => Math.min(earliest, at), lines.length)
    const messageLines = lines.slice(errorIndex + 1, messageEnd)
    while (messageLines.length > 0 && messageLines.at(-1)?.trim() === '') messageLines.pop()
    const diff: DiffLine[] = []
    if (diffStart !== -1) {
      const bodyStart = lines.findIndex((line, at) => at > diffStart + 1 && line.trim() === '') + 1
      for (const line of lines.slice(bodyStart)) {
        if (line.trim() === '' || LOCATION_LINE.test(line)) break
        if (line.startsWith('- ')) diff.push({ kind: 'expected', text: line.slice(2) })
        else if (line.startsWith('+ ')) diff.push({ kind: 'received', text: line.slice(2) })
        else diff.push({ kind: 'context', text: line.slice(2) })
      }
    }
    const locations = lines.flatMap(line => {
      const match = LOCATION_LINE.exec(line)
      return match === null ? [] : [{ file: match[1] ?? '', line: Number(match[2]), column: Number(match[3]) }]
    })
    const codeFrame = lines.flatMap(line => {
      if (CARET_LINE.test(line)) return []
      const match = CODE_FRAME_LINE.exec(line)
      return match === null ? [] : [{ number: Number(match[1]), text: match[2] ?? '' }]
    })
    const firstMessage = errorMatch?.[2] ?? lines[0] ?? ''
    return {
      errorName: errorMatch?.[1] ?? 'Error',
      message: firstMessage,
      hint: messageLines.length > 0 ? messageLines.join('\n') : undefined,
      diff,
      location: locations[0],
      codeFrame,
      frames: locations.slice(1),
      raw: lines.join('\n'),
    }
  }
}
