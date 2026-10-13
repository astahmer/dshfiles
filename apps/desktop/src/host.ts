import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

/**
 * The Host process.
 *
 * DSH is already a launcher, so this does not need a daemon contract or a service
 * unit the way a shell over a separate host would: the child is spawned here,
 * owned here, and stopped when the window closes.
 *
 * `--port 0` lets the OS assign a port, so two windows can run at once without
 * either being told to collide. The launch URL carries the Host's own process
 * token; it is held only until the window loads it, and is then dropped so no
 * later code path — an error, a log line, a crash report — can reach it.
 */

const ANNOUNCED_URL = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/

/** The Host is spawned with stdin ignored and both output streams piped. */
type HostChild = ChildProcessByStdio<null, Readable, Readable>

export interface HostOptions {
  readonly profile: string
  /** Milliseconds to wait for the Host to announce its URL. */
  readonly readyTimeoutMs?: number
  readonly executable?: string
}

export interface HostSession {
  /** The tokenized launch URL, or `undefined` once it has been loaded. */
  launchUrl: string | undefined
  /** Authority the Host bound, without the token. */
  readonly authority: string
  stop: () => Promise<void>
  forgetLaunchUrl: () => void
}

export class HostStartError extends Error {}

/**
 * Resolve once the Host prints its tokenized launch URL.
 *
 * Both output streams are watched because a failing Host explains itself on
 * stderr and would otherwise look like a silent timeout. Whatever was read is
 * returned either way, so the caller can show the Host's own words.
 */
const waitForLaunchUrl = (child: HostChild, timeoutMs: number): Promise<string> =>
  new Promise<string>(resolve => {
    let seen = ''
    const settle = (suffix?: string): void => {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      child.off('exit', onExit)
      resolve(suffix === undefined ? seen : `${seen}\n${suffix}`)
    }
    const onData = (chunk: Buffer): void => {
      seen += chunk.toString('utf8')
      if (ANNOUNCED_URL.test(seen)) settle()
    }
    const onExit = (): void => {
      settle(`dsh exited with code ${String(child.exitCode)} before announcing a URL`)
    }
    const timer = setTimeout(() => {
      settle(`dsh announced no URL within ${String(timeoutMs)}ms`)
    }, timeoutMs)
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', onExit)
  })

export const startHost = async (options: HostOptions): Promise<HostSession> => {
  const executable = options.executable ?? 'dsh'
  const child: HostChild = spawn(executable, ['--profile', options.profile, '--port', '0', '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const announcement = await waitForLaunchUrl(child, options.readyTimeoutMs ?? 60_000)
  const match = ANNOUNCED_URL.exec(announcement)
  if (match?.[0] === undefined) {
    child.kill('SIGKILL')
    // The Host's own output is the useful part of this failure, so it is passed
    // through rather than replaced with a generic message.
    throw new HostStartError(`dsh did not announce a URL.\n\n${announcement.trim()}`)
  }
  const launchUrl = match[0]

  const held: HostSession = {
    launchUrl,
    authority: new URL(launchUrl).origin,
    stop: () => stopHost(child),
    forgetLaunchUrl: () => {
      held.launchUrl = undefined
    },
  }
  return held
}

/**
 * Stop the Host, escalating only if it ignores the polite signal.
 *
 * A Host left running holds its port and its data directory, so the second press
 * is deliberate rather than immediate.
 */
const stopHost = async (child: HostChild): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>(resolve => {
    child.once('exit', () => {
      resolve()
    })
  })
  child.kill('SIGTERM')
  const escalated = setTimeout(() => {
    child.kill('SIGKILL')
  }, 5_000)
  await exited
  clearTimeout(escalated)
}

/**
 * Resolve the `dsh` executable, or explain how to fix its absence.
 *
 * A GUI launch inherits a much smaller `PATH` than a shell, so "not found" is the
 * expected failure here rather than an edge case, and it needs its own message.
 */
export const resolveDshExecutable = async (probe: (directory: string) => Promise<boolean>, pathValue: string): Promise<string> => {
  for (const directory of pathValue.split(':')) {
    if (directory === '') continue
    if (await probe(directory)) return `${directory}/dsh`
  }
  throw new HostStartError(
    'dsh was not found on PATH. An app launched from Finder or the app menu inherits a minimal PATH; add the directory containing dsh, or pass an explicit executable.',
  )
}
