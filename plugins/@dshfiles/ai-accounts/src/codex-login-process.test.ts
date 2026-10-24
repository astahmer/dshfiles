import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODEX_LOGIN_ARGS, CODEX_LOGIN_EXECUTABLE, createCodexLoginRunner, type CodexLoginSpawn } from './codex-login-process.js'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => vi.useRealTimers())

describe('fixed official Codex subprocess boundary', () => {
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

it('records a bounded CLI lifetime span without paths, device codes or raw errors', async () => {
  using recorder = recordSpans()
  const run = createCodexLoginRunner(() => {
    throw new Error('private-output-ABCD-EFGH')
  }, {})
  await expect(run({ home: '/private/stage', signal: new AbortController().signal, onOutput: () => {} })).rejects.toThrow(
    'Official Codex device sign-in process failed',
  )
  const span = recorder.span('ai-accounts codex device login')
  expect(span.attributes).toEqual({ 'dshx.ai-accounts.provider': 'codex', 'error.type': 'Error' })
  expect(span.status.code).toBe('error')
  expect(JSON.stringify(span, (_key, value) => (typeof value === 'bigint' ? String(value) : value))).not.toMatch(/private-output|ABCD-EFGH|private\/stage/u)
})
