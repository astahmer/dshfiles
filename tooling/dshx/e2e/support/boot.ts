import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const profileRoot = resolve(repoRoot, '..')

export interface BootedProfile {
  /** Tokenized URL the Host announced. */
  readonly url: string
  /** Profile name that was booted. */
  readonly profile: string
  /** Port the Host is listening on. */
  readonly port: number
  /** Host process, so a scenario can read its logs when one fails. */
  readonly host: ChildProcessByStdio<null, Readable, Readable>
  /** Everything the Host printed, captured for failure messages. */
  output(): string
  /** Stop the Host and remove the scratch profile root. */
  close(): Promise<void>
}

/** Reserve a port by binding it and letting go, so the Host can take it. */
export const findFreePort = async (): Promise<number> =>
  new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('could not reserve a port'))
        return
      }
      const { port } = address
      server.close(() => resolvePort(port))
    })
  })

const URL_PATTERN = /http:\/\/127\.0\.0\.1:\d+\/\S*/

/**
 * Boot a real DSH profile and wait for it to announce its URL.
 *
 * Every scenario in this suite shares one of these, because a browser launch and
 * a Host boot are the two expensive units and neither is specific to a journey.
 * Nothing here is mocked: the defects these tests exist for are precisely about
 * services the Host provides and packages negotiate between, so a stub would
 * reproduce the assumption under test rather than the system.
 */
export const bootProfile = async (profile: string, timeoutMs = 90_000): Promise<BootedProfile> => {
  const port = await findFreePort()
  const scratch = await mkdtemp(join(tmpdir(), 'dshx-e2e-'))
  const host = spawn('dsh', ['--profile', profile, '--port', String(port), '--no-open'], {
    cwd: profileRoot,
    env: { ...process.env, DSHX_BOOT_PROFILE_ROOT: scratch },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  host.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  host.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })

  const url = await new Promise<string>((resolveUrl, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const match = URL_PATTERN.exec(output)
      if (match?.[0] !== undefined) {
        clearInterval(timer)
        resolveUrl(match[0])
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        host.kill('SIGKILL')
        reject(new Error(`the ${profile} profile did not announce a URL within ${String(timeoutMs)}ms:\n${output}`))
      }
    }, 250)
    host.once('exit', (code: number | null) => {
      clearInterval(timer)
      reject(new Error(`the ${profile} profile exited with code ${String(code)} before announcing a URL:\n${output}`))
    })
  })

  return {
    url,
    profile,
    port,
    host,
    output: () => output,
    async close(): Promise<void> {
      host.kill('SIGTERM')
      await new Promise<void>(done => {
        const timer = setTimeout(() => {
          host.kill('SIGKILL')
          done()
        }, 3_000)
        host.once('exit', () => {
          clearTimeout(timer)
          done()
        })
      })
      await rm(scratch, { recursive: true, force: true })
    },
  }
}
