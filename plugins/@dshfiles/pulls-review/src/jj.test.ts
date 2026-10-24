import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { createJjRun } from './jj.js'

const handle = (exitCode: number): SubprocessHandle => ({
  stdin: undefined,
  stdout: undefined,
  stderr: undefined,
  control: undefined,
  collected: {
    stdout: { readFrom: () => ({ text: 'diff', nextOffset: 4, lossy: false }) },
    stderr: { readFrom: () => ({ text: 'There is no jj repo', nextOffset: 19, lossy: false }) },
  },
  done: Promise.resolve({ exitCode, signal: null }),
  terminate: () => undefined,
  waitForExit: async () => true,
})

const runWith = (exitCode: number) => createJjRun({ subprocess: { resolveExecutable: async () => '/usr/local/bin/jj', spawn: () => handle(exitCode) } })

describe('pulls-review jj runs', () => {
  it('records a jj diff span with flag names only', async () => {
    using recorder = recordSpans()
    await expect(runWith(0)({ path: '/private/tmp/thread', args: ['diff', '--from', 'synthetic-base', '--git'] })).resolves.toEqual({
      stdout: 'diff',
      truncated: false,
    })
    const span = recorder.span('jj diff')
    expect(span.attributes['jj.output.truncated']).toBe(false)
    expect(JSON.stringify(span.attributes)).not.toMatch(/synthetic-base|\/private\/tmp/)
  })

  it('marks a jj run outside a repository as an error span', async () => {
    using recorder = recordSpans()
    await expect(runWith(1)({ path: '/private/tmp/elsewhere', args: ['log'] })).rejects.toThrow('not-a-repository')
    expect(recorder.span('jj log').status.code).toBe('error')
  })
})
