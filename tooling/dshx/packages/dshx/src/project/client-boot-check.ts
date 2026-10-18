import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { spawnOwnedProcess, stopOwnedProcess } from './owned-process.js'
import { compositionFailures, readProfileComposition } from './profile-composition.js'
import { ScratchProfileRuntime } from './scratch-profile.js'
import { StartupDialogs } from './startup-dialogs.js'
import type { BrowserBootEvidence, SlotRenderFailure } from './browser-boot.js'
export { compositionFailures }

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
 * So this drives a real browser against a real boot. It requires DSH's native
 * readiness signal, a mounted application root, and every requested Client entry
 * in the boot manifest. An expected entry left pending is a defect. Other entries
 * may stay pending only when the boot card names the service they await; this
 * check deliberately starts no Host conversation.
 */

export interface ClientBootCheckOptions {
  readonly projectRoot: string
  readonly profile: string
  readonly port: number
  readonly executable?: string
  readonly timeoutMs?: number
  /** Scratch DSH home that owns every file written by the check. */
  readonly dshHome: string
  /** Prepared profile directory with the expected bundles installed. */
  readonly profileRoot: string
  /** Bundle ids that must appear in offline composition before a browser is spent. */
  readonly expectedBundles: readonly [string, ...string[]]
  /** Client ids that must appear in DSH's boot manifest. */
  readonly expectedClientEntries: readonly string[]
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
  /** Slots that lost their entry to a render crash, by boundary marker or by console line. */
  readonly slotFailures: readonly SlotRenderFailure[]
  /** Expected bundles absent from the offline composition. */
  readonly compositionFailures: readonly string[]
  /** Expected Client entries absent from DSH's boot manifest. */
  readonly missingClientEntries: readonly string[]
  /** Which native surface decided the browser outcome. */
  readonly evidence?: BrowserBootEvidence
  /** The unavailability card remained mounted after the native readiness signal. */
  readonly failureCardVisible: boolean
  /** True only after DSH readiness resolved and the application root mounted. */
  readonly browserReady: boolean
  readonly url?: string
  readonly timedOut: boolean
  /** Host process or offline composition check could not complete. */
  readonly processError?: string
  /** Set when the Host process could not be spawned at all. */
  readonly spawnError?: string
  /** Set when the browser could not be driven at all. */
  readonly browserError?: string
  /** A safe description of why native application readiness could not be proved. */
  readonly readinessError?: string
}

const DEFAULT_TIMEOUT_MS = 90_000
/** A Host that announced its URL but does not answer within this window is reported by the browser outcome instead. */
const HOST_RESPONSE_TIMEOUT_MS = 10_000

/** Time for the shell behind the first-run provider dialog to render, including its Slot entry crashes. */
const SLOT_SETTLE_MS = 1_000

/**
 * Recover entry states from the boot card text. The card prints the summary line
 * first and then one line per entry, so the audit below it is the whole record.
 */
const parseBootText = (text: string): ClientBootCheckEntry[] => {
  const entries: ClientBootCheckEntry[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const match = /^(?<id>@[^:]+): (?<state>failed|pending|error)\b(?<detail>.*)$/.exec(line)
    if (match?.groups === undefined) continue
    const rawDetail = match.groups.detail?.trim().replace(/^:\s*/, '')
    const detail = rawDetail === undefined ? undefined : ScratchProfileRuntime.redactHostOutput(rawDetail)
    entries.push({
      id: match.groups.id ?? '',
      state: match.groups.state ?? '',
      ...(detail === undefined || detail === '' ? {} : { detail }),
    })
  }
  return entries
}

/** Pending is acceptable only for a non-target entry with an explicit native service wait. */
const clientEntryFailures = (entries: readonly ClientBootCheckEntry[], expectedClientEntries: readonly string[]): ClientBootCheckEntry[] => {
  const expected = new Set(expectedClientEntries)
  return entries.filter(entry => {
    if (entry.state !== 'pending') return true
    if (expected.has(entry.id)) return true
    return !/^\(waiting for service: [^)]+\)$/.test(entry.detail ?? '')
  })
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

const waitForHostUrl = (
  child: ChildProcess,
  output: () => string,
  timeoutMs: number,
): Promise<{ readonly url?: string; readonly processError?: string; readonly spawnError?: string }> =>
  new Promise(resolve => {
    let settled = false
    const finish = (value: { readonly url?: string; readonly processError?: string; readonly spawnError?: string }): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      child.off('error', handleError)
      child.off('close', handleClose)
      resolve(value)
    }
    const handleError = (error: Error): void => finish({ spawnError: 'The Host process could not be spawned: ' + error.message })
    const handleClose = (code: number | null): void => finish({ processError: `The Host exited with code ${String(code)} before announcing its URL.` })
    const timer = setInterval(() => {
      const match = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(output())
      if (match?.[0] !== undefined) {
        finish({ url: match[0] })
        return
      }
      if (Date.now() - startedAt > timeoutMs) finish({})
    }, 250)
    const startedAt = Date.now()
    child.once('error', handleError)
    child.once('close', handleClose)
  })

/**
 * The Host announces its URL once it is ready to serve, which is what the journey harness navigates on. Probing for
 * the first answer replaces a fixed settle that cost two seconds on every check, and still waits when a Host
 * announces before it accepts connections.
 */
const waitForHostResponse = async (url: string, timeoutMs = HOST_RESPONSE_TIMEOUT_MS): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1_000) })
      return
    } catch {
      if (Date.now() >= deadline) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

export const checkClientBoot = async (options: ClientBootCheckOptions): Promise<ClientBootCheckResult> => {
  const executable = options.executable ?? 'dsh'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const port = options.port === 0 ? await findFreePort() : options.port
  let output = ''
  let composition: readonly string[] = []
  let entries: ClientBootCheckEntry[] = []
  let slotFailures: readonly SlotRenderFailure[] = []
  let missingClientEntries: readonly string[] = []
  let browserReady = false
  let failureCardVisible = false
  let readinessError: string | undefined
  let browserError: string | undefined
  let processError: string | undefined
  let spawnError: string | undefined
  let evidence: BrowserBootEvidence | undefined
  let timedOut = false
  let host: ChildProcess | undefined
  let launchUrl: string | undefined
  try {
    try {
      await access(join(options.profileRoot, 'package.json'))
    } catch {
      throw new Error('Client boot requires a prepared isolated profileRoot with package.json.')
    }
    const dump = await readProfileComposition({
      projectRoot: options.projectRoot,
      profile: options.profile,
      profileRoot: options.profileRoot,
      dshHome: options.dshHome,
      executable,
      timeoutMs,
    })
    composition = compositionFailures(dump, options.expectedBundles)

    if (composition.length === 0) {
      try {
        host = spawnOwnedProcess(executable, ['--profile', options.profile, '--port', String(port), '--no-open'], {
          cwd: options.projectRoot,
          env: ScratchProfileRuntime.hostEnvironment(options.dshHome, options.profileRoot),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        spawnError = error instanceof Error ? error.message : String(error)
      }
      if (host !== undefined) {
        const collect = (chunk: Buffer): void => {
          output += chunk.toString('utf8')
        }
        host.stdout?.on('data', collect)
        host.stderr?.on('data', collect)
        const readiness = await waitForHostUrl(host, () => output, timeoutMs)
        launchUrl = readiness.url
        processError = readiness.processError
        spawnError = readiness.spawnError

        if (launchUrl === undefined && processError === undefined && spawnError === undefined) timedOut = true
        if (launchUrl !== undefined) {
          await waitForHostResponse(launchUrl)
          try {
            const { chromium, firefox, webkit } = (await import('playwright')) as typeof import('playwright')
            const engine = { chromium, firefox, webkit }[options.browserName ?? 'chromium']
            const browser = await engine.launch({ headless: true })
            try {
              const page = await browser.newPage()
              // Attach before the navigation: a Slot that abdicates logs its crash once, and a reader attached after the
              // mount can no longer see it in the DOM.
              const consoleErrors: string[] = []
              page.on('console', message => {
                if (message.type() === 'error') consoleErrors.push(message.text())
              })
              await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
              const { BrowserBootModel } = await import('./browser-boot.js')
              const outcome = await BrowserBootModel.readOutcome(page, {
                timeoutMs,
                expectedClientEntries: options.expectedClientEntries,
                inspectSlotFailures: options.expectedClientEntries.length > 0,
              })
              // A scratch home has no provider, so DSH opens its provider-setup dialog over the shell, and the Slots behind it
              // never mount: an entry that crashes while rendering there leaves no trace at all. Dismiss it, let the
              // shell render, then read the Slot traces once more without disturbing the audit read above.
              await StartupDialogs.dismissProviderSetupIfShown(page)
              await new Promise(resolve => setTimeout(resolve, SLOT_SETTLE_MS))
              const mounted = await BrowserBootModel.readOutcome(page, {
                timeoutMs,
                expectedClientEntries: options.expectedClientEntries,
                inspectSlotFailures: options.expectedClientEntries.length > 0,
                consoleMessages: consoleErrors,
              })
              browserReady = outcome.ready
              evidence = outcome.evidence
              missingClientEntries = outcome.missingClientEntries
              failureCardVisible = outcome.failureCardVisible
              readinessError = outcome.readinessError
              timedOut ||= outcome.timedOut
              slotFailures = mounted.slotFailures
              entries = parseBootText(outcome.text)
            } finally {
              await browser.close()
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            browserError = ScratchProfileRuntime.redactHostOutput(message)
          }
        }
      }
    }
  } catch (error) {
    processError = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      if (host !== undefined) await stopOwnedProcess(host)
    } catch (error) {
      processError ??= `Could not stop the check-owned Host: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const failures = clientEntryFailures(entries, options.expectedClientEntries)
  const unexplainedFailureCard = failureCardVisible && entries.length === 0
  return {
    ok:
      composition.length === 0 &&
      missingClientEntries.length === 0 &&
      browserReady &&
      !unexplainedFailureCard &&
      !timedOut &&
      processError === undefined &&
      spawnError === undefined &&
      browserError === undefined &&
      readinessError === undefined &&
      failures.length === 0 &&
      slotFailures.length === 0,
    entries,
    failures,
    slotFailures,
    compositionFailures: composition,
    missingClientEntries,
    browserReady,
    failureCardVisible,
    timedOut,
    ...(processError === undefined ? {} : { processError: ScratchProfileRuntime.redactHostOutput(processError) }),
    ...(spawnError === undefined ? {} : { spawnError: ScratchProfileRuntime.redactHostOutput(spawnError) }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(launchUrl === undefined ? {} : { url: new URL(launchUrl).origin }),
    ...(browserError === undefined ? {} : { browserError: ScratchProfileRuntime.redactHostOutput(browserError) }),
    ...(readinessError === undefined ? {} : { readinessError: ScratchProfileRuntime.redactHostOutput(readinessError) }),
  }
}

export class ClientBootCheckModel {
  static readonly parseBootText = parseBootText
  static readonly clientEntryFailures = clientEntryFailures
  static readonly waitForHostResponse = waitForHostResponse
}
