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
    expect(TurnActivity.parts(summary, { includeReads: true })).toEqual(['ran 1 command', 'edited 1 file', 'read 1 file', '1 search', '1 other tool call'])
    expect(TurnActivity.parts(summary, { includeReads: false })).toEqual(['ran 1 command', 'edited 1 file', '1 other tool call'])
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
      'tests 40/42',
    ])
    expect(TurnActivity.segments(summary, { includeReads: true, lineCounts: false, testResults: false }).map(segment => segment.text)).toEqual([
      'edited 2 files',
      'ran 2 commands',
    ])
    expect(TurnActivity.testCounts('===== 3 failed, 12 passed in 1.20s =====')).toEqual({ passed: 12, failed: 3, total: 15 })
    expect(TurnActivity.duration(72_000)).toBe('1m 12s')
  })
})
