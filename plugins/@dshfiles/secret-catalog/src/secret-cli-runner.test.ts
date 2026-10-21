import { Writable } from 'node:stream'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { runSecretCli } from './secret-cli-runner.js'

interface Harness {
  readonly runtime: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>
  readonly spec: () => SubprocessSpawnSpec | undefined
  readonly handle: SubprocessHandle
  readonly stdin: () => string
}

const harness = (
  options: { readonly exitCode?: number | null; readonly lossy?: boolean; readonly output?: string; readonly stdinClosed?: boolean } = {},
): Harness => {
  let spec: SubprocessSpawnSpec | undefined
  let input = ''
  const stdin = new Writable({
    write(chunk, _encoding, done) {
      if (options.stdinClosed === true) {
        done(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
        return
      }
      input += Buffer.from(chunk).toString('utf8')
      done()
    },
  })
  const handle: SubprocessHandle = {
    stdin,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stdout: {
        readFrom: vi.fn(() => ({ text: options.output ?? '', nextOffset: (options.output ?? '').length, lossy: options.lossy ?? false })),
      },
    },
    done: Promise.resolve({ exitCode: options.exitCode ?? 0, signal: null }),
    terminate: vi.fn(),
    waitForExit: vi.fn(async () => true),
  }
  const runtime: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'> = {
    resolveExecutable: vi.fn(async () => '/nix/store/secret-cli/bin/secret'),
    spawn: vi.fn(next => {
      spec = next
      return handle
    }),
  }
  return { runtime, spec: () => spec, handle, stdin: () => input }
}

describe('managed secret CLI runner', () => {
  it('uses argv, bounds output, pipes manual values on stdin, and forwards only the CLI session inputs', async () => {
    const test = harness({ output: 'synthetic-output\n' })
    const environment: NodeJS.ProcessEnv = {
      BW_SESSION: 'synthetic-session-token',
      SECRET_SESSION_FILE: '/private/tmp/synthetic-secret-session',
      AWS_SECRET_ACCESS_KEY: 'must-not-be-forwarded',
    }
    const result = await runSecretCli(
      test.runtime,
      {
        args: ['set', 'SYNTHETIC_TOKEN', '--env', 'dev'],
        cwd: '/private/tmp/project',
        captureStdout: true,
        stdin: 'synthetic-secret-value',
      },
      environment,
    )

    expect(result).toBe('synthetic-output\n')
    expect(test.spec()?.argv).toEqual(['/nix/store/secret-cli/bin/secret', 'set', 'SYNTHETIC_TOKEN', '--env', 'dev'])
    expect(test.spec()?.cwd).toBe('/private/tmp/project')
    expect(test.spec()?.env).toEqual({ BW_SESSION: 'synthetic-session-token', SECRET_SESSION_FILE: '/private/tmp/synthetic-secret-session' })
    expect(test.spec()?.stdio).toEqual({ stdin: 'pipe', stdout: { maxBytes: 1_000_000 }, stderr: { maxBytes: 1 } })
    expect(test.stdin()).toBe('synthetic-secret-value')
    expect(test.handle.waitForExit).toHaveBeenCalledOnce()
  })

  it('does not expose CLI stdout for copy and mutation commands', async () => {
    const test = harness({ output: 'must-not-reach-the-caller' })
    const result = await runSecretCli(
      test.runtime,
      {
        args: ['get', 'SYNTHETIC_TOKEN', '--copy'],
        cwd: '/private/tmp/project',
        captureStdout: false,
      },
      {},
    )

    expect(result).toBe('')
    expect(test.spec()?.stdio.stdout).toEqual({ maxBytes: 1 })
    expect(test.spec()?.stdio.stderr).toEqual({ maxBytes: 1 })
    expect(test.spec()?.env).toEqual({})
  })

  it('terminates the managed process range and returns only a generic error for failed or oversized output', async () => {
    const failed = harness({ exitCode: 2 })
    await expect(runSecretCli(failed.runtime, { args: ['print', '--json'], cwd: null, captureStdout: true }, {})).rejects.toThrow('Secret CLI command failed.')
    expect(failed.handle.terminate).toHaveBeenCalledOnce()

    const oversized = harness({ lossy: true })
    await expect(runSecretCli(oversized.runtime, { args: ['get', 'SYNTHETIC_TOKEN'], cwd: null, captureStdout: true }, {})).rejects.toThrow(
      'Secret CLI command failed.',
    )
    expect(oversized.handle.terminate).toHaveBeenCalledOnce()
  })

  it('reports a CLI that exits before reading its stdin as a failure without an unhandled stream error', async () => {
    const test = harness({ exitCode: 1, stdinClosed: true })

    await expect(
      runSecretCli(test.runtime, { args: ['set', 'SYNTHETIC_TOKEN'], cwd: null, captureStdout: false, stdin: 'synthetic-secret-value' }, {}),
    ).rejects.toThrow('Secret CLI command failed.')
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})
