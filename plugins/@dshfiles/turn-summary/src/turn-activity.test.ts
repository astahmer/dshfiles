import { describe, expect, it } from 'vitest'
import { TurnActivity } from './turn-activity.js'

interface CallArguments {
  readonly command?: string
  readonly description?: string
  readonly file_path?: string
  readonly pattern?: string
}

const call = (callId: string, name: string, args: CallArguments) => ({ callId, name, arguments: JSON.stringify(args) })

describe('TurnActivity.summarize', () => {
  it('counts commands and names the ones that exited non-zero, were killed or were rejected', () => {
    const summary = TurnActivity.summarize({
      calls: [
        call('a', 'bash', { command: 'pnpm test', description: 'Run the suite' }),
        call('b', 'bash', { command: 'ls' }),
        call('c', 'bash', { command: 'sleep 99\necho done' }),
        call('d', 'bash', { command: 'rm -rf /' }),
      ],
      results: [
        { callId: 'a', isError: false, text: 'FAIL\n[exit code: 1]' },
        { callId: 'b', isError: false, text: 'README.md' },
        { callId: 'c', isError: false, text: '\n[killed by signal: SIGKILL]' },
        { callId: 'd', isError: true, text: 'denied' },
      ],
    })
    expect(summary.commands).toBe(4)
    expect(summary.failedCommands).toEqual([
      { callId: 'a', label: 'Run the suite', outcome: 'exit 1' },
      { callId: 'c', label: 'sleep 99', outcome: 'signal SIGKILL' },
      { callId: 'd', label: 'rm -rf /', outcome: 'error' },
    ])
  })

  it('lists each successfully edited file once and leaves a still-running command unjudged', () => {
    const summary = TurnActivity.summarize({
      calls: [
        call('a', 'edit', { file_path: 'src/cart/pricing.ts' }),
        call('b', 'write', { file_path: 'src/cart/pricing.ts' }),
        call('c', 'edit', { file_path: 'src/broken.ts' }),
        call('d', 'bash', { command: 'pnpm build' }),
        call('e', 'read', { file_path: 'a.ts' }),
        call('f', 'grep', { pattern: 'x' }),
        call('g', 'subagent', {}),
      ],
      results: [
        { callId: 'a', isError: false, text: undefined },
        { callId: 'b', isError: false, text: undefined },
        { callId: 'c', isError: true, text: 'file has not been read' },
        { callId: 'g', isError: true, text: 'cancelled' },
      ],
    })
    expect(summary.editedFiles).toEqual(['src/cart/pricing.ts'])
    expect(summary.failedCommands).toEqual([])
    expect([summary.readFiles, summary.searches, summary.otherCalls, summary.failedOtherCalls]).toEqual([1, 1, 1, 1])
    expect(TurnActivity.parts(summary, { includeReads: true })).toEqual(['ran 1 command', 'edited 1 file', 'read 1 file', '1 search'])
    expect(TurnActivity.parts(summary, { includeReads: false })).toEqual(['ran 1 command', 'edited 1 file'])
  })

  it('counts edited lines per file and reads the last test summary into the footer segments', () => {
    const summary = TurnActivity.summarize({
      calls: [
        { callId: 'a', name: 'edit', arguments: JSON.stringify({ file_path: 'a.ts', old_string: 'one\ntwo\nthree', new_string: 'one\n2\n2b\nthree' }) },
        { callId: 'b', name: 'write', arguments: JSON.stringify({ file_path: 'b.ts', content: 'x\ny\n' }) },
        { callId: 'c', name: 'apply_patch', arguments: JSON.stringify({ path: 'a.ts', edits: [{ old: 'gone', new: '' }] }) },
        call('d', 'bash', { command: 'pnpm test' }),
        call('e', 'bash', { command: 'pnpm vitest run' }),
      ],
      results: [
        { callId: 'a', isError: false, text: undefined },
        { callId: 'b', isError: false, text: undefined },
        { callId: 'c', isError: false, text: undefined },
        { callId: 'd', isError: false, text: ' Tests  1 failed | 9 passed (10)\n[exit code: 1]' },
        { callId: 'e', isError: false, text: ' Test Files  3 passed (3)\n      Tests  2 failed | 40 passed (42)\n[exit code: 1]' },
      ],
    })
    expect(summary.editedFileStats).toEqual([
      { path: 'a.ts', added: 2, removed: 2 },
      { path: 'b.ts', added: 2, removed: 0 },
    ])
    expect(summary.tests).toEqual({ passed: 40, failed: 2, total: 42 })
    expect(summary.commandRuns.map(run => run.outcome)).toEqual(['exit 1', 'exit 1'])
    expect(TurnActivity.segments(summary, { includeReads: true, lineCounts: true, testResults: true }).map(segment => segment.text)).toEqual([
      'edited 2 files +4 −2',
      'ran 2 commands',
      '2 of 42 tests failed',
    ])
    expect(TurnActivity.segments(summary, { includeReads: true, lineCounts: false, testResults: false }).map(segment => segment.text)).toEqual([
      'edited 2 files',
      'ran 2 commands',
    ])
    expect(
      TurnActivity.segments(summary, { includeReads: true, lineCounts: true, testResults: true, editedFiles: false }).map(segment => segment.text),
    ).toEqual(['ran 2 commands', '2 of 42 tests failed'])
    expect(TurnActivity.testCounts('===== 3 failed, 12 passed in 1.20s =====')).toEqual({ passed: 12, failed: 3, total: 15 })
    expect(TurnActivity.duration(72_000)).toBe('1m 12s')
  })

  describe('the footer says each thing once', () => {
    const options = { includeReads: true, lineCounts: true, testResults: true }
    const texts = (summary: Parameters<typeof TurnActivity.segments>[0]) => TurnActivity.segments(summary, options).map(segment => segment.text)

    it('never prints "other tool call": a turn of only such calls has no part at all', () => {
      const summary = TurnActivity.summarize({ calls: [call('a', 'todo_write', {}), call('b', 'html_render', {})], results: [] })
      expect(summary.otherCalls).toBe(2)
      expect(texts(summary)).toEqual([])
    })

    it('never prints "0s"', () => {
      expect(TurnActivity.shownDuration(400)).toBeUndefined()
      expect(TurnActivity.shownDuration(0)).toBeUndefined()
      expect(TurnActivity.shownDuration(1_200)).toBe('1s')
      expect(TurnActivity.shownDuration(72_000)).toBe('1m 12s')
    })

    it('reads a duration as the kit does: whole seconds rounded down (DESIGN.md › Durations)', () => {
      // Rounded, 59.9 s read "1m 00s" here while "Worked for" read "59s" for the same turn.
      expect(TurnActivity.shownDuration(59_900)).toBe('59s')
      expect(TurnActivity.shownDuration(999)).toBeUndefined()
      expect(TurnActivity.shownDuration(3_840_000)).toBe('1h 04m')
    })

    it('says the total only where "Worked for" does not: a stopped or failed turn', () => {
      expect(TurnActivity.saysOwnTotal('end_turn')).toBe(false)
      expect(TurnActivity.saysOwnTotal(undefined)).toBe(false)
      expect(TurnActivity.saysOwnTotal('aborted')).toBe(true)
      expect(TurnActivity.saysOwnTotal('interrupted')).toBe(true)
      expect(TurnActivity.saysOwnTotal('error')).toBe(true)
    })

    it('reports a failed test run once, as the one red part, which opens the failed command', () => {
      const summary = TurnActivity.summarize({
        calls: [call('a', 'bash', { command: 'pnpm vitest run' })],
        results: [{ callId: 'a', isError: false, text: ' Tests  1 failed | 7 passed (8)\n[exit code: 1]' }],
      })
      expect(TurnActivity.segments(summary, options)).toEqual([
        { key: 'commands', text: 'ran 1 command' },
        { key: 'tests', text: '1 of 8 tests failed', failed: true, opensFailures: true },
      ])
      expect(TurnActivity.failedCommandsBeyondTests(summary, { testResults: true })).toBe(0)
      // With test results off, the failed command is the only word on the failure.
      expect(TurnActivity.failedCommandsBeyondTests(summary, { testResults: false })).toBe(1)
    })

    it('keeps one red part when another command failed beside the test run', () => {
      const failing = TurnActivity.summarize({
        calls: [call('a', 'bash', { command: 'pnpm vitest run' }), call('b', 'bash', { command: 'pnpm build' })],
        results: [
          { callId: 'a', isError: false, text: ' Tests  1 failed | 4 passed (5)\n[exit code: 1]' },
          { callId: 'b', isError: false, text: 'boom\n[exit code: 2]' },
        ],
      })
      const parts = TurnActivity.segments(failing, options)
      expect(parts.filter(part => part.failed === true)).toEqual([{ key: 'tests', text: '1 of 5 tests failed', failed: true, opensFailures: true }])
      // The test outcome opens both failed commands, so no second red count stands beside it.
      expect(TurnActivity.failedCommandsBeyondTests(failing, { testResults: true })).toBe(0)
    })

    it('counts failed commands on their own when no test failed, and marks passing tests as passed, never red', () => {
      const build = TurnActivity.summarize({
        calls: [call('a', 'bash', { command: 'pnpm build' })],
        results: [{ callId: 'a', isError: false, text: 'boom\n[exit code: 2]' }],
      })
      expect(TurnActivity.failedCommandsBeyondTests(build, { testResults: true })).toBe(1)
      const passing = TurnActivity.summarize({
        calls: [call('a', 'bash', { command: 'pnpm vitest run' })],
        results: [{ callId: 'a', isError: false, text: ' Tests  5 passed (5)\n[exit code: 0]' }],
      })
      // Every test passed: the part carries the green check of a verified result (round two item 21).
      expect(TurnActivity.segments(passing, options).at(-1)).toEqual({ key: 'tests', text: '5 tests passed', passed: true })
      expect(TurnActivity.segments(passing, options).some(part => part.failed === true)).toBe(false)
    })

    it('draws no separator first, nor right after a chevron', () => {
      // "ran 1 command ›" "1 of 8 tests failed ›" "6s" "Walkthrough ›": the chevrons already separate.
      expect(TurnActivity.separators([true, true, false, true])).toEqual([false, false, false, true])
      // chips, "ran 1 command ›", "5s"
      expect(TurnActivity.separators([false, true, false])).toEqual([false, true, false])
      expect(TurnActivity.separators([false])).toEqual([false])
    })
  })
})
