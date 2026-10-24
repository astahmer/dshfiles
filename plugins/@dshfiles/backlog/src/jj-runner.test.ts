import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { runReadOnlyJj } from './jj-runner.js'

const fakeJj = (input: { readonly exitCode: number; readonly output: string }) => {
  const specs: SubprocessSpawnSpec[] = []
  const handle: SubprocessHandle = {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: { stdout: { readFrom: () => ({ text: input.output, nextOffset: input.output.length, lossy: false }) } },
    done: Promise.resolve({ exitCode: input.exitCode, signal: null }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
  const subprocess: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'> = {
    resolveExecutable: async () => '/usr/local/bin/jj',
    spawn: spec => {
      specs.push(spec)
      return handle
    },
  }
  return { subprocess, specs }
}

describe('backlog jj runner', () => {
  it('records a jj log span with flag names only and the exit code', async () => {
    using recorder = recordSpans()
    const jj = fakeJj({ exitCode: 0, output: 'abc123' })
    await expect(
      runReadOnlyJj({ subprocess: jj.subprocess, cwd: '/private/tmp/repo', args: ['log', '--no-graph', '-r', 'main', '-T', 'commit_id'] }),
    ).resolves.toBe('abc123')
    expect(jj.specs[0]?.argv).toEqual([
      '/usr/local/bin/jj',
      '--color=never',
      '--no-pager',
      '--ignore-working-copy',
      'log',
      '--no-graph',
      '-r',
      'main',
      '-T',
      'commit_id',
    ])
    const span = recorder.span('jj log')
    expect(span.kind).toBe('client')
    expect(span.attributes['process.exit.code']).toBe(0)
    expect(JSON.stringify(span.attributes)).not.toContain('commit_id')
    expect(JSON.stringify(span.attributes)).not.toContain('/private/tmp/repo')
  })

  it('marks a failing jj run as an error', async () => {
    using recorder = recordSpans()
    const jj = fakeJj({ exitCode: 1, output: '' })
    await expect(runReadOnlyJj({ subprocess: jj.subprocess, cwd: '/private/tmp/repo', args: ['log'] })).rejects.toThrow('jj exited 1')
    expect(recorder.span('jj log').status.code).toBe('error')
  })
})
