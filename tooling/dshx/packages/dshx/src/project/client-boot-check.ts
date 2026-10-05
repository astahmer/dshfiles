import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Client boot verification.
 *
 * The Host boot check proves a plugin's server half loads. It cannot see the
 * browser half, where a client plugin activates against services provided by
 * other packages: a missing Cordis service or a locale namespace that another
 * package already registered both throw inside `apply`, take the fiber to
 * `failed`, and surface only as a "Failed to load plugins" card naming whichever
 * entries happened to be affected. Neither reaches typecheck or the build.
 *
 * So this drives a real browser against a real boot. The Web UI records each
 * client entry's state in the DOM, which is what gets read back: an entry in
 * `failed`, or one reporting an import failure, is a defect. An entry left
 * `pending` on a live-host service is expected here and is not a failure, because
 * this check does not run a Host conversation.
 */

export interface ClientBootCheckOptions {
  readonly projectRoot: string
  readonly profile: string
  readonly port: number
  readonly executable?: string
  readonly timeoutMs?: number
  /**
   * A prepared profile directory (package.json with the expected bundles, run
   * through its package manager) to boot from, via DSHX_BOOT_PROFILE_ROOT.
   * Without one the check provisions nothing: DSH boots the profile it finds —
   * or an empty one — and the browser pass proves only that the Web UI mounts,
   * which is exactly the vacuous success this check exists to prevent.
   */
  readonly profileRoot?: string
  /** Bundle ids that must appear in the offline composition before a browser is spent. */
  readonly expectedBundles?: readonly string[]
  /** Browser to drive the Web UI with. */
  readonly browserName?: 'chromium' | 'firefox' | 'webkit'
}

export interface ClientBootCheckEntry {
  readonly id: string
  /** Cordis state as the Web UI reports it: active, failed, pending, loading. */
  readonly state: string
  /** Failure detail for an entry that did not activate. */
  readonly detail?: string
}

export interface ClientBootCheckResult {
  readonly ok: boolean
  readonly entries: readonly ClientBootCheckEntry[]
  /** Entries that failed, with their detail. */
  readonly failures: readonly ClientBootCheckEntry[]
  /** Slots that mounted an error boundary instead of their entry. */
  readonly slotFailures: readonly { readonly slot: string }[]
  /** Expected bundles absent from the offline composition. */
  readonly compositionFailures: readonly string[]
  readonly url?: string
  readonly timedOut: boolean
  /** Set when the browser could not be driven at all. */
  readonly browserError?: string
}

const DEFAULT_TIMEOUT_MS = 90_000

/** Expected bundle ids missing from a `dsh --dump-config` composition document. */
export const compositionFailures = (dump: string, expectedBundles: readonly string[]): readonly string[] => expectedBundles.filter(id => !dump.includes(id))

/**
 * Recover entry states from the boot card text. The card prints the summary line
 * first and then one line per entry, so the audit below it is the whole record.
 */
export const parseBootText = (text: string): ClientBootCheckEntry[] => {
  const entries: ClientBootCheckEntry[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const match = /^(?<id>@[^:]+): (?<state>failed|pending|error)\b(?<detail>.*)$/.exec(line)
    if (match?.groups === undefined) continue
    const detail = match.groups.detail?.trim().replace(/^:\s*/, '')
    entries.push({
      id: match.groups.id ?? '',
      state: match.groups.state ?? '',
      ...(detail === undefined || detail === '' ? {} : { detail }),
    })
  }
  return entries
}

const findFreePort = async (): Promise<number> => {
  const { createServer } = await import('node:net')
  return new Promise<number>((resolve, reject) => {
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
      server.close(() => resolve(port))
    })
  })
}

export const checkClientBoot = async (options: ClientBootCheckOptions): Promise<ClientBootCheckResult> => {
  const executable = options.executable ?? 'dsh'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const port = options.port === 0 ? await findFreePort() : options.port
  const ownedProfileRoot = options.profileRoot === undefined
  const profileRoot = options.profileRoot ?? (await mkdtemp(join(tmpdir(), 'dshx-client-boot-')))
  let output = ''
  const startedAt = Date.now()

  // Offline composition first: a browser launch proves nothing about a bundle
  // the profile never composed, so an absent expected bundle fails before boot.
  let composition: readonly string[] = []
  if (options.expectedBundles !== undefined && options.expectedBundles.length > 0) {
    const dump = await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, ['--profile', options.profile, '--dump-config'], {
        cwd: options.projectRoot,
        env: { ...process.env, DSHX_BOOT_PROFILE_ROOT: profileRoot },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`dsh --dump-config did not finish within ${timeoutMs}ms.`))
      }, timeoutMs)
      child.once('exit', code => {
        clearTimeout(timer)
        if (code === 0) resolve(stdout)
        else reject(new Error(`dsh --dump-config exited ${String(code)}: ${stderr.slice(0, 400)}`))
      })
    })
    composition = compositionFailures(dump, options.expectedBundles)
  }

  let url: string | undefined
  let entries: ClientBootCheckEntry[] = []
  let slotFailures: readonly { readonly slot: string }[] = []
  let browserError: string | undefined
  if (composition.length === 0) {
    const child = spawn(executable, ['--profile', options.profile, '--port', String(port), '--no-open'], {
      cwd: options.projectRoot,
      env: { ...process.env, DSHX_BOOT_PROFILE_ROOT: profileRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    url = await new Promise<string | undefined>(resolve => {
      const timer = setInterval(() => {
        const match = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(output)
        if (match?.[0] !== undefined) {
          clearInterval(timer)
          resolve(match[0])
        }
        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer)
          resolve(undefined)
        }
      }, 250)
      child.once('exit', () => {
        clearInterval(timer)
        resolve(undefined)
      })
    })

    if (url !== undefined) {
      await new Promise(resolve => setTimeout(resolve, 2_000))
      try {
        const { chromium, firefox, webkit } = (await import('playwright')) as typeof import('playwright')
        const engine = { chromium, firefox, webkit }[options.browserName ?? 'chromium']
        const browser = await engine.launch({ headless: true })
        try {
          const page = await browser.newPage()
          await page.goto(url, { waitUntil: 'domcontentloaded' })
          const { readClientBootOutcome } = await import('./browser-boot.js')
          const outcome = await readClientBootOutcome(page, { url, timeoutMs })
          slotFailures = outcome.slotFailures
          if (!outcome.ok) entries = parseBootText(outcome.text)
        } finally {
          await browser.close()
        }
      } catch (error) {
        browserError = error instanceof Error ? error.message : String(error)
      }
    }

    child.kill('SIGTERM')
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  if (ownedProfileRoot) await rm(profileRoot, { recursive: true, force: true })

  const timedOut = composition.length === 0 && url === undefined
  const failures = entries.filter(entry => entry.state !== 'pending')
  return {
    ok: composition.length === 0 && !timedOut && browserError === undefined && failures.length === 0 && slotFailures.length === 0,
    entries,
    failures,
    slotFailures,
    compositionFailures: composition,
    timedOut,
    ...(url === undefined ? {} : { url }),
    ...(browserError === undefined ? {} : { browserError }),
  }
}
