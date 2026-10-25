import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { withSpan } from '@dshfiles/dshx/tracing'
import { CdpTransport } from './chrome-cdp.js'

const MAC_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
const WINDOWS_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Chromium\\Application\\chrome.exe',
]

const onPath = ({ name, pathValue }: { readonly name: string; readonly pathValue: string }): string | undefined => {
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) continue
    const candidate = join(directory, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * A configured path wins; otherwise the platform's usual install locations and PATH.
 * Nothing here guesses a browser for a platform it does not know.
 */
const chromeExecutable = ({
  platform,
  pathValue = '',
  configured = '',
}: {
  readonly platform: string
  readonly pathValue?: string
  readonly configured?: string
}): string | undefined => {
  const chosen = configured.trim()
  if (chosen.length > 0) return existsSync(chosen) ? chosen : undefined
  const candidates = platform === 'darwin' ? MAC_PATHS : platform === 'win32' ? WINDOWS_PATHS : LINUX_NAMES
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
    if (platform !== 'win32' && platform !== 'darwin') {
      const found = onPath({ name: candidate, pathValue })
      if (found !== undefined) return found
    }
  }
  return undefined
}

const defaultProfileDir = ({ dshHome }: { readonly dshHome: string | undefined }): string =>
  join(dshHome === undefined || dshHome.length === 0 ? join(homedir(), '.dsh') : dshHome, 'plugins', 'annotations', 'chrome-profile')

export interface LaunchedChrome {
  readonly pid: number
  readonly port: number
  readonly endpoint: string
}

let running: LaunchedChrome | undefined

const launchedChrome = (): LaunchedChrome | undefined => running

const chromeArguments = ({
  port,
  profileDir,
  startUrl,
  headless = false,
}: {
  readonly port: number
  readonly profileDir: string
  readonly startUrl?: string
  readonly headless?: boolean
}): string[] => [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate',
  // A fresh user-data-dir otherwise triggers macOS's "Keychain Not Found" dialog and
  // blocks the window before any page exists.
  '--password-store=basic',
  '--use-mock-keychain',
  ...(headless ? ['--headless=new'] : []),
  startUrl !== undefined && startUrl.trim().length > 0 ? startUrl.trim() : 'about:blank',
]

/** Any listener counts as busy: a port can answer something other than our JSON, or nothing at all. */
const portBusy = ({ port, timeoutMs = 500 }: { readonly port: number; readonly timeoutMs?: number }): Promise<boolean> =>
  new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    const settle = (busy: boolean): void => {
      socket.destroy()
      resolve(busy)
    }
    socket.setTimeout(timeoutMs, () => settle(false))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })

const reachable = async ({ port }: { readonly port: number }): Promise<boolean> => {
  const response = await fetch(`${CdpTransport.endpointOf({ port })}/json/version`, { signal: AbortSignal.timeout(700) }).catch(() => undefined)
  if (response === undefined || !response.ok) return false
  const version = (await response.json().catch(() => undefined)) as { readonly webSocketDebuggerUrl?: unknown } | undefined
  return typeof version?.webSocketDebuggerUrl === 'string'
}

/**
 * Never attach to a browser we did not start: if the configured port already answers,
 * take the next free one instead of driving someone else's Chrome.
 */
const freePort = async ({ start, attempts = 20 }: { readonly start: number; readonly attempts?: number }): Promise<number> => {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = start + offset
    if (!(await portBusy({ port: candidate }))) return candidate
  }
  throw new Error(`No free debugging port between ${start} and ${start + attempts - 1}.`)
}

const launchChrome = async ({
  executable,
  port,
  profileDir,
  startUrl,
  headless = false,
  timeoutMs = 12_000,
}: {
  readonly executable: string
  readonly port: number
  readonly profileDir: string
  readonly startUrl?: string
  readonly headless?: boolean
  readonly timeoutMs?: number
}): Promise<LaunchedChrome> => {
  if (running !== undefined) return running
  return withSpan('annotations launch chrome', async () => {
    const chosen = await freePort({ start: port })
    // Chrome creates the leaf but not a nested path, and a missing parent makes it exit silently.
    await mkdir(profileDir, { recursive: true })
    const child = spawn(executable, chromeArguments({ port: chosen, profileDir, headless, ...(startUrl === undefined ? {} : { startUrl }) }), {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    let exited = false
    child.once('exit', () => {
      exited = true
    })
    const endpoint = CdpTransport.endpointOf({ port: chosen })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (exited) throw new Error('Chrome exited right after launch. Quit any window already using that profile and try again.')
      if (await reachable({ port: chosen })) {
        const launched = { pid: child.pid ?? 0, port: chosen, endpoint }
        running = launched
        return launched
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error('Chrome did not open a debugging port in time.')
  })
}

/**
 * The launcher was spawned detached, so it leads its own process group: signalling the
 * group closes the helpers too instead of leaving a headless browser behind.
 */
const stopChrome = (): boolean => {
  if (running === undefined) return false
  const pid = running.pid
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      running = undefined
      return false
    }
  }
  running = undefined
  return true
}

export const Chrome = {
  chromeExecutable,
  defaultProfileDir,
  launchedChrome,
  chromeArguments,
  freePort,
  launchChrome,
  stopChrome,
}
