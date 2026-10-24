import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { runManagedProcess } from './managed-process.js'

const subprocessExiting = (exitCode: number): Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'> => {
  const handle: SubprocessHandle = {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: 'ok', nextOffset: 2, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
  return { resolveExecutable: async () => '/usr/local/bin/pnpm', spawn: () => handle }
}

describe('managed project-check process', () => {
  it('records a project-checks run span with the executable, argument count and exit code, never argv', async () => {
    using recorder = recordSpans()
    const result = await runManagedProcess({
      subprocess: subprocessExiting(2),
      command: 'pnpm',
      args: ['run', 'synthetic-private-script'],
      cwd: '/private/tmp/project',
      timeoutMs: 5_000,
      signal: undefined,
    })
    expect(result).toMatchObject({ exitCode: 2, failure: null })
    const span = recorder.span('project-checks run')
    expect(span.attributes).toMatchObject({ 'process.executable.name': 'pnpm', 'dshx.project-checks.argument_count': 2, 'process.exit.code': 2 })
    expect(span.status.code).toBe('error')
    expect(JSON.stringify(span.attributes)).not.toMatch(/synthetic-private-script|\/private\/tmp/)
  })
})
