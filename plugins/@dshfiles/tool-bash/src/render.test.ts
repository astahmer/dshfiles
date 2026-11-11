import { parseExitStatus } from '@deepseek-ai/dsh-shell'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { describe, expect, it } from 'vitest'
import { renderResult } from './native/render.ts'

const run = (input: Partial<ShellRunResult> = {}): ShellRunResult => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  aborted: false,
  timeoutMs: 120_000,
  stdout: { text: 'hello\n', truncated: false },
  stderr: { text: '', truncated: false },
  ...input,
})

describe('bash result rendering', () => {
  it('ends every completed run with its exit code, zero included', () => {
    expect(renderResult(run())).toBe('hello\n[exit code: 0]')
    expect(renderResult(run({ exitCode: 2 }))).toBe('hello\n[exit code: 2]')
    expect(parseExitStatus(renderResult(run()))).toEqual({ body: 'hello', exitCode: 0 })
  })

  it('names the signal that killed a command', () => {
    expect(
      renderResult(run({ exitCode: null, signal: 'SIGKILL' }))
        .split('\n')
        .at(-1),
    ).toBe('[killed by signal: SIGKILL]')
  })

  it('says how long a timed-out command waited and suggests a larger timeout', () => {
    const text = renderResult(run({ exitCode: null, signal: 'SIGTERM', timedOut: true, timeoutMs: 90_000 }))

    expect(text).toContain('[timed out after 90000ms (1m 30s); rerun with a larger timeoutMs or with run_in_background: true]')
    expect(text.split('\n').at(-1)).toBe('[killed by signal: SIGTERM]')
  })

  it('drops the partial first line of a truncated tail so the line count is exact', () => {
    const text = renderResult(run({ stdout: { text: 'tail of line 7\nline 8\nline 9\n', truncated: true, spillPath: '/tmp/out.txt' } }))

    expect(text).toBe('line 8\nline 9\n[output truncated: showing the last 2 lines; full output: /tmp/out.txt]\n[exit code: 0]')
  })

  it('keeps a truncated tail that holds no line break', () => {
    const text = renderResult(run({ stdout: { text: 'end of one long line', truncated: true } }))

    expect(text).toBe('end of one long line\n[output truncated: showing the end of one line; full output: (unavailable)]\n[exit code: 0]')
  })
})
