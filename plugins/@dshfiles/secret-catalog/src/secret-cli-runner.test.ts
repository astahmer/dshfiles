import { Readable, Writable } from 'node:stream'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it, vi } from 'vitest'
import { runSecretCli, SecretCliError } from './secret-cli-runner.js'

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
    stdout: Readable.from(['synthetic-private-mutation-output']),
    stderr: Readable.from(['synthetic-private-diagnostic-output']),
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
    expect(test.spec()?.stdio).toEqual({ stdin: 'pipe', stdout: { maxBytes: 1_000_000 }, stderr: 'pipe' })
    expect(test.handle.stderr?.readableFlowing).toBe(true)
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
    expect(test.spec()?.stdio.stdout).toBe('pipe')
    expect(test.spec()?.stdio.stderr).toBe('pipe')
    expect(test.handle.stdout?.readableFlowing).toBe(true)
    expect(test.handle.stderr?.readableFlowing).toBe(true)
    expect(test.handle.collected.stdout?.readFrom).not.toHaveBeenCalled()
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

  it('tags each failure with a stable code', async () => {
    const failed = harness({ exitCode: 1 })
    await expect(runSecretCli(failed.runtime, { args: ['print', '--json'], cwd: null, captureStdout: true }, {})).rejects.toMatchObject({
      code: 'cli-failed',
    })

    const missing = harness()
    vi.mocked(missing.runtime.resolveExecutable).mockRejectedValueOnce(new Error('ENOENT'))
    const missingFailure = runSecretCli(missing.runtime, { args: ['print', '--json'], cwd: null, captureStdout: true }, {})
    await expect(missingFailure).rejects.toBeInstanceOf(SecretCliError)
    await expect(missingFailure).rejects.toMatchObject({ code: 'cli-missing', message: 'Secret CLI executable could not be found on the Host PATH.' })
    expect(missing.runtime.spawn).not.toHaveBeenCalled()
  })

  it.each(['stdout', 'stderr', 'stdin'] as const)('cancels on repeated %s errors during the process-range wait, even after a zero exit', async stream => {
    const test = harness()
    vi.mocked(test.handle.waitForExit).mockImplementationOnce(async () => {
      test.handle[stream]?.emit('error', new Error('synthetic-private-stream-detail'))
      test.handle[stream]?.emit('error', new Error('synthetic-private-second-stream-detail'))
      return true
    })
    const result = runSecretCli(test.runtime, { args: ['set', 'SYNTHETIC_TOKEN'], cwd: null, captureStdout: false, stdin: 'synthetic-value' }, {})

    await expect(result).rejects.toBeInstanceOf(SecretCliError)
    await expect(result).rejects.toMatchObject({ code: 'cli-failed', message: 'Secret CLI command failed.' })
    expect(test.spec()?.signal?.aborted).toBe(true)
    expect(test.handle.terminate).toHaveBeenCalledOnce()
    expect(() => test.handle[stream]?.emit('error', new Error('synthetic-private-late-stream-detail'))).not.toThrow()
  })

  it.each(['stdout', 'stderr'] as const)('fails closed when the requested raw %s pipe is unavailable', async stream => {
    const test = harness()
    vi.mocked(test.runtime.spawn).mockReturnValueOnce({ ...test.handle, [stream]: undefined })
    await expect(runSecretCli(test.runtime, { args: ['set', 'SYNTHETIC_TOKEN'], cwd: null, captureStdout: false }, {})).rejects.toMatchObject({
      code: 'cli-failed',
      message: 'Secret CLI command failed.',
    })
    expect(test.handle.terminate).toHaveBeenCalledOnce()
  })

  it('does not accept a zero exit if the deadline elapses during the process-range wait', async () => {
    vi.useFakeTimers()
    try {
      const test = harness()
      vi.mocked(test.handle.waitForExit).mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
        return true
      })
      await expect(runSecretCli(test.runtime, { args: ['print', '--json'], cwd: null, captureStdout: true }, {})).rejects.toMatchObject({
        code: 'cli-timeout',
        message: 'Secret CLI command timed out.',
      })
      expect(test.handle.terminate).toHaveBeenCalledOnce()
      expect(test.handle.collected.stdout?.readFrom).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['throws', 'unconfirmed'] as const)('masks termination diagnostics and reports cleanup when it %s', async mode => {
    const test = harness({ exitCode: 2 })
    if (mode === 'throws') {
      vi.mocked(test.handle.terminate).mockImplementationOnce(() => {
        throw new Error('synthetic-private-termination-detail')
      })
    } else {
      vi.mocked(test.handle.waitForExit).mockResolvedValue(false)
    }
    const result = runSecretCli(test.runtime, { args: ['print', '--json'], cwd: null, captureStdout: true }, {})
    await expect(result).rejects.toBeInstanceOf(SecretCliError)
    await expect(result).rejects.toMatchObject({ code: 'cli-failed', message: 'Secret CLI command failed. Process cleanup could not be confirmed.' })
    await expect(result).rejects.not.toHaveProperty('cause')
  })

  it('preserves the timeout code when termination throws', async () => {
    vi.useFakeTimers()
    try {
      const test = harness()
      vi.mocked(test.handle.waitForExit).mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
        return true
      })
      vi.mocked(test.handle.terminate).mockImplementationOnce(() => {
        throw new Error('synthetic-private-termination-detail')
      })
      await expect(runSecretCli(test.runtime, { args: ['print', '--json'], cwd: null, captureStdout: true }, {})).rejects.toMatchObject({
        code: 'cli-timeout',
        message: 'Secret CLI command timed out. Process cleanup could not be confirmed.',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('classifies a timed-out executable lookup as a timeout, not a missing CLI', async () => {
    vi.useFakeTimers()
    try {
      const test = harness()
      vi.mocked(test.runtime.resolveExecutable).mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
        throw new Error('synthetic-private-lookup-detail')
      })
      await expect(runSecretCli(test.runtime, { args: ['print', '--json'], cwd: null, captureStdout: true }, {})).rejects.toMatchObject({
        code: 'cli-timeout',
        message: 'Secret CLI command timed out.',
      })
      expect(test.runtime.spawn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps failure spans typed and free of provider diagnostics when cleanup throws', async () => {
    using recorder = recordSpans()
    const test = harness({ exitCode: 2 })
    vi.mocked(test.handle.terminate).mockImplementationOnce(() => {
      throw new Error('synthetic-private-termination-detail')
    })
    await expect(
      runSecretCli(test.runtime, { args: ['set', 'SYNTHETIC_TOKEN', '--env', 'dev'], cwd: null, captureStdout: false, stdin: 'synthetic-secret-value' }, {}),
    ).rejects.toBeInstanceOf(SecretCliError)
    const span = recorder.span('secret set')
    expect(span.kind).toBe('client')
    expect(span.status).toEqual({ code: 'error', message: 'SecretCliError:cli-failed' })
    expect(span.attributes['error.type']).toBe('SecretCliError:cli-failed')
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toMatch(/SYNTHETIC_TOKEN|synthetic-|dev"/)
  })

  it('records a secret <verb> span with flag names only, never the alias or the value', async () => {
    using recorder = recordSpans()
    await runSecretCli(harness().runtime, {
      args: ['set', 'SYNTHETIC_TOKEN', '--env', 'dev'],
      cwd: null,
      captureStdout: false,
      stdin: 'synthetic-secret-value',
    })
    const span = recorder.span('secret set')
    expect(span.kind).toBe('client')
    expect(span.attributes['process.command.verb']).toBe('set')
    expect(JSON.stringify(span.attributes)).not.toMatch(/SYNTHETIC_TOKEN|synthetic-secret-value|dev"/)
  })
})
