import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { CODEX_LOGIN_ARGS, CODEX_LOGIN_EXECUTABLE, CodexLoginUnsupported, createCodexLoginRunner, type CodexLoginSpawn } from './codex-login-process.js'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => vi.useRealTimers())

describe('fixed official Codex subprocess boundary', () => {
  it('records a codex login span until process close without device output, homes or credentials', async () => {
    using recorder = recordSpans()
    const done = deferred<number | null>()
    const output = vi.fn()
    const run = createCodexLoginRunner(() => ({ finished: done.promise, onOutput: receive => receive('private-device-code'), kill: () => {} }), {
      HOME: '/private/user',
      OPENAI_API_KEY: 'private-key',
    })
    const pending = run({ home: '/private/staging', signal: new AbortController().signal, onOutput: output })
    expect(output).toHaveBeenCalledWith('private-device-code')
    expect(recorder.named('codex login')).toHaveLength(0)
    done.resolve(0)
    await expect(pending).resolves.toBe(0)
    const span = recorder.span('codex login')
    expect(span.kind).toBe('client')
    expect(span.attributes).toEqual({ 'process.executable.name': 'codex', 'process.exit.code': 0, 'dshx.ai-accounts.cancelled': false })
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toMatch(/private|device-code/)
  })

  it('keeps a cancelled codex login span open until the child is reaped', async () => {
    using recorder = recordSpans()
    const done = deferred<number | null>()
    const controller = new AbortController()
    const run = createCodexLoginRunner(() => ({ finished: done.promise, onOutput: () => {}, kill: () => {} }), {})
    const pending = run({ home: '/private/staging', signal: controller.signal, onOutput: () => {} })
    controller.abort('private-abort-reason')
    expect(recorder.named('codex login')).toHaveLength(0)
    done.resolve(null)
    await expect(pending).resolves.toBeNull()
    const span = recorder.span('codex login')
    expect(span.attributes['dshx.ai-accounts.cancelled']).toBe(true)
    expect(span.status).toEqual({ code: 'error', message: 'cancelled' })
    expect(JSON.stringify(span.attributes)).not.toContain('private')
  })

  it('records only the error class when Codex spawn fails', async () => {
    using recorder = recordSpans()
    const run = createCodexLoginRunner(() => {
      throw Object.assign(new Error('private-spawn-path-and-env'), { code: 'private-error-code' })
    }, {})
    await expect(run({ home: '/private/staging', signal: new AbortController().signal, onOutput: () => {} })).rejects.toThrow(
      'Official Codex CLI could not start or stop',
    )
    const span = recorder.span('codex login')
    expect(span.status).toEqual({ code: 'error', message: 'Error' })
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toContain('private')
  })
  it('preserves unsupported-CLI guidance without forwarding arbitrary failure metadata', async () => {
    using recorder = recordSpans()
    const run = createCodexLoginRunner(() => {
      throw Object.assign(new CodexLoginUnsupported(), { code: 'private-error-code' })
    }, {})
    await expect(run({ home: '/private/staging', signal: new AbortController().signal, onOutput: () => {} })).rejects.toBeInstanceOf(CodexLoginUnsupported)
    const span = recorder.span('codex login')
    expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toContain('private')
  })

  it('uses fixed official executable/args and staging home; no inherited tokens, runtime injection or caller command', async () => {
    const done = deferred<number | null>()
    let receive: (text: string) => void = () => {}
    const kill = vi.fn()
    const spawn = vi.fn<CodexLoginSpawn>(() => ({
      finished: done.promise,
      onOutput: callback => {
        receive = callback
      },
      kill,
    }))
    const run = createCodexLoginRunner(spawn, {
      PATH: '/trusted/bin',
      HOME: '/home/test',
      OPENAI_API_KEY: 'never-copy',
      CODEX_ACCESS_TOKEN: 'never-copy',
      NODE_OPTIONS: '--require attacker',
      RUST_LOG: 'trace',
      CODEX_HOME: '/other-account',
    })
    const controller = new AbortController()
    const onOutput = vi.fn()
    const task = run({ home: '/private/shadow/.dsh-login-fake', signal: controller.signal, onOutput })
    expect(spawn).toHaveBeenCalledWith({
      executable: CODEX_LOGIN_EXECUTABLE,
      args: CODEX_LOGIN_ARGS,
      home: '/private/shadow/.dsh-login-fake',
      env: { PATH: '/trusted/bin', HOME: '/home/test', CODEX_HOME: '/private/shadow/.dsh-login-fake', NO_COLOR: '1', TERM: 'dumb' },
    })
    expect(CODEX_LOGIN_EXECUTABLE).toBe('codex')
    expect(CODEX_LOGIN_ARGS).toEqual(['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth'])
    receive('public prompt')
    expect(onOutput).toHaveBeenCalledWith('public prompt')
    done.resolve(0)
    expect(await task).toBe(0)
    expect(kill).not.toHaveBeenCalled()
  })
  it('terminates on cancel, escalates after two seconds and waits for process reaping', async () => {
    vi.useFakeTimers()
    const done = deferred<number | null>()
    const kill = vi.fn()
    let receive: (text: string) => void = () => {}
    const spawn = vi.fn<CodexLoginSpawn>(() => ({
      finished: done.promise,
      onOutput: callback => {
        receive = callback
      },
      kill,
    }))
    const controller = new AbortController()
    const onOutput = vi.fn()
    const task = createCodexLoginRunner(spawn, {})({ home: '/private/stage', signal: controller.signal, onOutput })
    controller.abort()
    receive('never-forward-after-cancel')
    expect(onOutput).not.toHaveBeenCalled()
    expect(kill).toHaveBeenCalledWith('SIGTERM')
    await vi.advanceTimersByTimeAsync(2000)
    expect(kill).toHaveBeenLastCalledWith('SIGKILL')
    done.resolve(null)
    expect(await task).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not spawn when already aborted and clears escalation after close', async () => {
    vi.useFakeTimers()
    const spawn = vi.fn<CodexLoginSpawn>()
    expect(await createCodexLoginRunner(spawn, {})({ home: '/private/stage', signal: AbortSignal.abort(), onOutput: () => {} })).toBeNull()
    expect(spawn).not.toHaveBeenCalled()
    const done = deferred<number | null>()
    const kill = vi.fn()
    spawn.mockReturnValue({ finished: done.promise, onOutput: () => {}, kill })
    const controller = new AbortController()
    const task = createCodexLoginRunner(spawn, {})({ home: '/private/stage', signal: controller.signal, onOutput: () => {} })
    controller.abort()
    done.resolve(null)
    await task
    await vi.advanceTimersByTimeAsync(3000)
    expect(kill).toHaveBeenCalledTimes(1)
  })
})
