import { spawn } from 'node:child_process'
import { withSpan } from '@dshfiles/dshx/tracing'

/** No executable, args, shell command, issuer or environment comes from an API caller. */
export const CODEX_LOGIN_EXECUTABLE = 'codex'
export const CODEX_LOGIN_ARGS = ['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth'] as const

export class CodexLoginUnsupported extends Error {
  constructor() {
    super('Install the official OpenAI Codex CLI on the DSH Host with device-auth support, then retry. DSH does not install it automatically.')
  }
}

export interface CodexLoginChild {
  readonly finished: Promise<number | null>
  onOutput(receive: (text: string) => void): void
  kill(signal: 'SIGTERM' | 'SIGKILL'): void
}

export type CodexLoginSpawn = (options: {
  readonly executable: typeof CODEX_LOGIN_EXECUTABLE
  readonly args: typeof CODEX_LOGIN_ARGS
  readonly home: string
  readonly env: NodeJS.ProcessEnv
}) => CodexLoginChild

const spawnOfficial: CodexLoginSpawn = options => {
  const child = spawn(options.executable, options.args, {
    cwd: options.home,
    env: options.env,
    shell: false,
    // The official npm launcher can own a native child. Cancel the entire owned group on Unix.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const finished = new Promise<number | null>((resolve, reject) => {
    let failure: Error | undefined
    child.on('error', error => {
      // Never include spawn errors: they can contain env, paths or command output.
      failure = 'code' in error && error.code === 'ENOENT' ? new CodexLoginUnsupported() : new Error('Official Codex CLI could not start or stop')
    })
    // An error event alone does not prove a running process stopped. Never clean its home before close.
    child.once('close', code => {
      if (failure === undefined) resolve(code)
      else reject(failure)
    })
  })
  return {
    finished,
    onOutput: receive => {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (text: string) => receive(text))
      child.stderr.on('data', (text: string) => receive(text))
    },
    kill: signal => {
      if (process.platform === 'win32' || child.pid === undefined) {
        child.kill(signal)
        return
      }
      try {
        process.kill(-child.pid, signal)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) child.kill(signal)
      }
    },
  }
}

const inheritedEnvironment = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SYSTEMROOT',
  'TMPDIR',
  'TEMP',
  'LANG',
  'LC_ALL',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const

export type RunCodexLogin = (input: {
  readonly home: string
  readonly signal: AbortSignal
  readonly onOutput: (text: string) => void
}) => Promise<number | null>

/** Cancellation waits for process close; a same-account retry cannot race a still-exiting CLI. */
export const createCodexLoginRunner =
  (createChild: CodexLoginSpawn = spawnOfficial, environment: NodeJS.ProcessEnv = process.env): RunCodexLogin =>
  async input => {
    if (input.signal.aborted) return null
    return withSpan('codex login', { kind: 'client', attributes: { 'process.executable.name': 'codex' } }, async span => {
      try {
        const env: NodeJS.ProcessEnv = { CODEX_HOME: input.home, NO_COLOR: '1', TERM: 'dumb' }
        for (const key of inheritedEnvironment) if (environment[key] !== undefined) env[key] = environment[key]
        const child = createChild({ executable: CODEX_LOGIN_EXECUTABLE, args: CODEX_LOGIN_ARGS, home: input.home, env })
        let killTimer: ReturnType<typeof setTimeout> | undefined
        const abort = (): void => {
          if (killTimer !== undefined) return
          child.kill('SIGTERM')
          killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000)
          killTimer.unref()
        }
        input.signal.addEventListener('abort', abort, { once: true })
        child.onOutput(text => {
          if (!input.signal.aborted) input.onOutput(text)
        })
        if (input.signal.aborted) abort()
        try {
          const code = await child.finished
          if (code !== null) span.setAttribute('process.exit.code', code)
          span.setAttribute('dshx.ai-accounts.cancelled', input.signal.aborted)
          if (input.signal.aborted) span.setStatus('error', 'cancelled')
          else if (code !== 0) span.setStatus('error', 'nonzero_exit')
          return code
        } finally {
          input.signal.removeEventListener('abort', abort)
          if (killTimer !== undefined) clearTimeout(killTimer)
        }
      } catch (error) {
        // Preserve the published contribution's boundary: no spawn path, output or arbitrary error code enters tracing or callers.
        if (error instanceof CodexLoginUnsupported) throw new CodexLoginUnsupported()
        throw new Error('Official Codex CLI could not start or stop')
      }
    })
  }
