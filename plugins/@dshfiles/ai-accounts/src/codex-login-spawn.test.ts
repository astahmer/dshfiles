import { describe, expect, it, vi } from 'vitest'
import { CodexLoginUnsupported, createCodexLoginRunner, spawnOfficialCodexLogin, type CodexLoginSpawnProcess } from './codex-login-process.js'

/** A scripted child: the test decides when output, a spawn error or the close event arrives. */
const fakeChild = () => {
  const output = () => {
    const receives: Array<(text: string) => void> = []
    return {
      stream: { setEncoding: (_encoding: 'utf8') => {}, on: (_event: 'data', receive: (text: string) => void) => void receives.push(receive) },
      emit: (text: string) => receives.forEach(receive => receive(text)),
    }
  }
  const errors: Array<(error: Error) => void> = []
  const closes: Array<(code: number | null) => void> = []
  const stdout = output()
  const stderr = output()
  // The adapter reads `pid` only to signal the process group; a test sets it once a group kill is what it checks.
  let pid: number | undefined
  return {
    get pid() {
      return pid
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
    on: (_event: 'error', receive: (error: Error) => void) => void errors.push(receive),
    once: (_event: 'close', receive: (code: number | null) => void) => void closes.push(receive),
    kill: vi.fn((_signal: 'SIGTERM' | 'SIGKILL') => {}),
    write: (text: string) => {
      stdout.emit(text)
      stderr.emit(text)
    },
    fail: (error: Error) => errors.forEach(receive => receive(error)),
    close: (code: number | null) => closes.forEach(receive => receive(code)),
    setPid: (value: number) => {
      pid = value
    },
  }
}

const spawnWith = (spawn: CodexLoginSpawnProcess) => spawnOfficialCodexLogin(spawn)

describe('official CLI Node spawn adapter (no real login)', () => {
  it('starts only fixed argv without a shell, closes stdin and pipes output without logging it', async () => {
    const child = fakeChild()
    const spawn = vi.fn<CodexLoginSpawnProcess>(() => child)
    const receive = vi.fn()
    const run = createCodexLoginRunner(spawnWith(spawn), { PATH: '/trusted/bin' })({
      home: '/private/fake-stage',
      signal: new AbortController().signal,
      onOutput: receive,
    })
    expect(spawn).toHaveBeenLastCalledWith(
      'codex',
      ['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth'],
      expect.objectContaining({
        cwd: '/private/fake-stage',
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: expect.objectContaining({ CODEX_HOME: '/private/fake-stage' }),
      }),
    )
    child.write('fake-output-not-logged')
    expect(receive).toHaveBeenCalledWith('fake-output-not-logged')
    child.close(0)
    expect(await run).toBe(0)
  })

  it('classifies missing CLI explicitly while suppressing raw spawn diagnostics', async () => {
    const child = fakeChild()
    const spawn = vi.fn<CodexLoginSpawnProcess>(() => child)
    const run = createCodexLoginRunner(spawnWith(spawn), {})({ home: '/private/fake-stage', signal: new AbortController().signal, onOutput: () => {} })
    const settled = vi.fn()
    void run.then(settled, settled)
    child.fail(Object.assign(new Error('raw-credential-never-reflect'), { code: 'ENOENT' }))
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    child.close(-2)
    await expect(run).rejects.toBeInstanceOf(CodexLoginUnsupported)
    await expect(run).rejects.not.toThrow('raw-credential')
  })

  it('signals the whole owned process group on cancel, and never spawns once already aborted', async () => {
    const child = fakeChild()
    child.setPid(4_242)
    const spawn = vi.fn<CodexLoginSpawnProcess>(() => child)
    const runner = createCodexLoginRunner(spawnWith(spawn), {})
    if (process.platform !== 'win32') {
      const killGroup = vi.spyOn(process, 'kill').mockImplementation(() => true)
      try {
        const controller = new AbortController()
        const run = runner({ home: '/private/fake-stage', signal: controller.signal, onOutput: () => {} })
        controller.abort()
        expect(killGroup).toHaveBeenCalledWith(-4_242, 'SIGTERM')
        child.close(null)
        await run
      } finally {
        killGroup.mockRestore()
      }
    }
    const aborted = new AbortController()
    aborted.abort()
    expect(await runner({ home: '/private/fake-stage', signal: aborted.signal, onOutput: () => {} })).toBeNull()
  })
})
