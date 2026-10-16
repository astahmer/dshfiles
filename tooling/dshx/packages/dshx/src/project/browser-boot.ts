import { z } from 'zod'

export interface BrowserBootOptions {
  readonly timeoutMs: number
  readonly expectedClientEntries: readonly string[]
  readonly inspectSlotFailures?: boolean
  /**
   * Console text the caller captured from before the first navigation. A
   * shadowing Slot kind retires a crashed entry and leaves no marker behind, so
   * its crash line is the only surviving trace.
   */
  readonly consoleMessages?: readonly string[]
}

/** A Slot that lost its entry to a render crash, however the renderer recorded it. */
export interface SlotRenderFailure {
  readonly slot: string
  /**
   * `boundary`: the Slot mounted its error face, marked `[data-slot-error]`.
   * `crash`: the entry threw and a shadowing Slot kind retired it onto the
   * cell's next survivor, so the marker is gone but the console line remains.
   */
  readonly source: 'boundary' | 'crash'
}

/**
 * Which native surface decided the outcome, so a failure names what was (or was
 * never) observed instead of a bare boolean.
 *
 * - `app-outlet`: the renderer mounted the application (`[data-slot="root"]`).
 * - `boot-card-cleared`: the kernel-owned boot element was seen and then removed
 *   by the mount handoff.
 * - `failure-card`: the audit listed failed entries.
 * - `blank`: the boot element never appeared — the kernel never ran.
 * - `stalled`: the boot element stayed up for the whole window without failing.
 */
export type BrowserBootEvidence = 'app-outlet' | 'boot-card-cleared' | 'failure-card' | 'stalled' | 'blank'

export interface BrowserBootOutcome {
  /** True when DSH's readiness signal resolved and the application root mounted. */
  readonly ready: boolean
  /** Legacy DOM handoff result; strict callers should use ready. */
  readonly ok: boolean
  /** Client rows missing from the native DSH boot manifest. */
  readonly missingClientEntries: readonly string[]
  readonly failureCardVisible: boolean
  /** The boot card text, if DSH kept its diagnostic card mounted. */
  readonly text: string
  /** The browser readiness signal stayed unsettled until the deadline. */
  readonly timedOut: boolean
  /** Why readiness could not be established. */
  readonly readinessError?: string
  /**
   * Slots that lost their entry to a render crash: the boundary markers still in
   * the DOM, plus the entries the renderer retired onto a fallback survivor.
   *
   * An entry that throws while rendering never reaches the boot audit, because
   * the fiber itself activated fine. Only the renderer records it.
   */
  readonly slotFailures: readonly SlotRenderFailure[]
  readonly evidence: BrowserBootEvidence
}

const SLOT_ERROR = '[data-slot-error]'
const BOOT_CARD = '[data-dsh-boot]'
const APP_OUTLET = '[data-slot="root"]'
const SLOT_INSPECTION_TIMEOUT_MS = 10_000
const SlotFailureNamesSchema = z.array(z.string().nullable())
const NativeReadinessSchema = z.object({
  ready: z.boolean(),
  missingClientEntries: z.array(z.string()),
  failureCardVisible: z.boolean(),
  text: z.string(),
  timedOut: z.boolean(),
  readinessError: z.string().exactOptional(),
  evidence: z.enum(['app-outlet', 'boot-card-cleared', 'failure-card', 'stalled', 'blank']),
})

/** The part of a Playwright Page the reader drives. Results cross from the browser, so they are decoded here. */
interface BootPage {
  evaluate<Argument>(pageFunction: (argument: Argument) => unknown, argument: Argument): Promise<unknown>
}

/**
 * Read the boot card, the mount handoff, and any Slot that lost its entry to a
 * render crash.
 *
 * Read DSH's native boot manifest and readiness promise, then verify the app root
 * mounted. The boot card is useful failure detail, but its absence alone cannot
 * distinguish a mounted application from a blank or unauthenticated document.
 *
 * Render crashes matter as much as the card, and for a different reason. A plugin
 * whose apply throws never reaches active and lands in the audit, but one that
 * reads a service it never declared throws while rendering, after it has already
 * activated. The fiber is fine and the audit is clean, so the crash has only two
 * possible traces: a `[data-slot-error]` marker where a fallback-entry-free cell
 * went dry, or the renderer's console line when a shadowing cell retired the
 * entry onto the next survivor. Reading one without the other misses whichever
 * shape the profile happens to compose: the audit catches activation, the marker
 * catches a dry cell, and the console line catches a takeover.
 *
 * The page is passed in rather than opened here so this module stays a pure
 * reader: the caller owns the browser and the Host, which is also what lets the
 * E2E scenarios share one launch across every assertion. That is also why the
 * caller captures console text: only it can attach before the first navigation.
 */
export const readClientBootOutcome = async (page: BootPage, options: BrowserBootOptions): Promise<BrowserBootOutcome> => {
  const nativeReadiness = NativeReadinessSchema.parse(
    await page.evaluate(
      async ({ expectedClientEntries, timeoutMs, bootCardSelector, appOutletSelector }) => {
        // The page publishes its boot graph and readiness promise as untyped globals; these guards read the parts used here.
        const hasBootGraph = (scope: Window): scope is Window & { readonly __DSH_BOOT__: { readonly entries: ReadonlyArray<unknown> } } =>
          '__DSH_BOOT__' in scope && scope.__DSH_BOOT__ instanceof Object && 'entries' in scope.__DSH_BOOT__ && Array.isArray(scope.__DSH_BOOT__.entries)
        const isBootEntry = (entry: unknown): entry is { readonly id: string } => entry instanceof Object && 'id' in entry && typeof entry.id === 'string'
        const hasReadySignal = (scope: Window): scope is Window & { readonly __DSH_BOOT_READY__: { readonly promise: PromiseLike<unknown> } } =>
          '__DSH_BOOT_READY__' in scope &&
          scope.__DSH_BOOT_READY__ instanceof Object &&
          'promise' in scope.__DSH_BOOT_READY__ &&
          scope.__DSH_BOOT_READY__.promise instanceof Object &&
          'then' in scope.__DSH_BOOT_READY__.promise &&
          typeof scope.__DSH_BOOT_READY__.promise.then === 'function'
        const readClientEntryIds = (): string[] => (hasBootGraph(window) ? window.__DSH_BOOT__.entries.filter(isBootEntry).map(entry => entry.id) : [])

        const deadline = Date.now() + timeoutMs
        let readiness: Promise<'resolved' | 'rejected'> | undefined
        let sawBootCard = false
        let readinessAvailable = false

        while (Date.now() < deadline) {
          const card = document.querySelector(bootCardSelector)
          if (card !== null) sawBootCard = true
          const text = card?.textContent ?? ''
          const failureCardVisible = text.includes('Failed to load plugins')
          const clientEntryIds = readClientEntryIds()
          const missingClientEntries = expectedClientEntries.filter(id => !clientEntryIds.includes(id))

          if (failureCardVisible) {
            const evidence: BrowserBootEvidence = 'failure-card'
            return { ready: false, missingClientEntries, failureCardVisible, text, timedOut: false, evidence }
          }

          if (hasReadySignal(window)) {
            readinessAvailable = true
            readiness ??= Promise.resolve(window.__DSH_BOOT_READY__.promise).then(
              () => 'resolved' as const,
              () => 'rejected' as const,
            )
            const state = await Promise.race([readiness, new Promise<'waiting'>(resolve => setTimeout(() => resolve('waiting'), 100))])
            if (state === 'rejected') {
              const evidence: BrowserBootEvidence = sawBootCard ? 'stalled' : 'blank'
              return {
                ready: false,
                missingClientEntries,
                failureCardVisible,
                text,
                timedOut: false,
                readinessError: 'The native DSH Client readiness promise rejected.',
                evidence,
              }
            }
            const root = document.querySelector('#root')
            const applicationMounted = document.querySelector(appOutletSelector) !== null || (root !== null && root.childElementCount > 0)
            if (state === 'resolved' && applicationMounted) {
              const evidence: BrowserBootEvidence = 'app-outlet'
              return { ready: true, missingClientEntries, failureCardVisible, text, timedOut: false, evidence }
            }
            if (state === 'resolved') await new Promise(resolve => setTimeout(resolve, 100))
          } else {
            const root = document.querySelector('#root')
            const applicationMounted = document.querySelector(appOutletSelector) !== null || (root !== null && root.childElementCount > 0)
            if (!readinessAvailable && applicationMounted) {
              const evidence: BrowserBootEvidence = 'app-outlet'
              return {
                ready: false,
                missingClientEntries,
                failureCardVisible,
                text,
                timedOut: false,
                readinessError: 'DSH did not expose its native Client readiness signal.',
                evidence,
              }
            }
            if (!readinessAvailable && sawBootCard && card === null) {
              const evidence: BrowserBootEvidence = 'boot-card-cleared'
              return {
                ready: false,
                missingClientEntries,
                failureCardVisible,
                text,
                timedOut: false,
                readinessError: 'DSH did not expose its native Client readiness signal.',
                evidence,
              }
            }
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }

        const card = document.querySelector(bootCardSelector)
        const text = card?.textContent ?? ''
        const clientEntryIds = readClientEntryIds()
        const missingClientEntries = expectedClientEntries.filter(id => !clientEntryIds.includes(id))
        const failureCardVisible = text.includes('Failed to load plugins')
        const root = document.querySelector('#root')
        const applicationMounted = document.querySelector(appOutletSelector) !== null || (root !== null && root.childElementCount > 0)
        let evidence: BrowserBootEvidence
        if (failureCardVisible) evidence = 'failure-card'
        else if (applicationMounted) evidence = 'app-outlet'
        else if (sawBootCard && card === null) evidence = 'boot-card-cleared'
        else if (sawBootCard) evidence = 'stalled'
        else evidence = 'blank'

        return {
          ready: false,
          missingClientEntries,
          failureCardVisible,
          text,
          timedOut: true,
          readinessError: readinessAvailable
            ? 'DSH did not resolve its native Client readiness signal and mount the application root before the deadline.'
            : 'DSH did not expose its native Client readiness signal before the deadline.',
          evidence,
        }
      },
      {
        expectedClientEntries: options.expectedClientEntries,
        timeoutMs: options.timeoutMs,
        bootCardSelector: BOOT_CARD,
        appOutletSelector: APP_OUTLET,
      },
    ),
  )

  const failures =
    options.inspectSlotFailures === false ? [] : mergeSlotFailures(await slotFailures(page), slotCrashesFromConsole(options.consoleMessages ?? []))
  const ok = (nativeReadiness.evidence === 'app-outlet' || nativeReadiness.evidence === 'boot-card-cleared') && !nativeReadiness.failureCardVisible
  return {
    ...nativeReadiness,
    ok,
    slotFailures: failures,
  }
}

/**
 * Turn the Slot names a page's boundary markers carry into failures.
 *
 * Separated from the evaluate call so the mapping is testable without a browser:
 * the callback runs in the page, so a stub could never exercise it directly.
 */
export const slotRenderFailures = (slotNames: readonly (string | null)[]): readonly SlotRenderFailure[] =>
  slotNames.filter((slot): slot is string => slot !== null && slot !== '').map(slot => ({ slot, source: 'boundary' }))

/**
 * Console lines DSH's renderer writes when a Slot entry, or one Factory
 * occurrence, throws while rendering.
 */
const SLOT_CRASH_PATTERNS = [/slot entry crashed in '([^']+)'/, /slot factory occurrence crashed in '([^']+)'/] as const

/**
 * Turn the renderer's crash lines back into failed Slots.
 *
 * A shadowing Slot kind (`single` cells with priority) abdicates the crashed
 * entry and re-renders onto the cell's next survivor. The boundary face only
 * shows until that re-render lands, so the DOM afterwards reports the takeover
 * as clean while the panel still shows the wrong component. The console line is
 * what stays, which is why the DOM-only reader called this class invisible.
 */
export const slotCrashesFromConsole = (messages: readonly string[]): readonly SlotRenderFailure[] => {
  const crashed = new Map<string, SlotRenderFailure>()
  for (const message of messages) {
    for (const pattern of SLOT_CRASH_PATTERNS) {
      const slot = pattern.exec(message)?.[1]
      if (slot !== undefined && slot !== '') crashed.set(slot, { slot, source: 'crash' })
    }
  }
  return [...crashed.values()]
}

/** One entry per crashed Slot; a mounted boundary is the stronger evidence for the same name. */
const mergeSlotFailures = (boundary: readonly SlotRenderFailure[], crashes: readonly SlotRenderFailure[]): readonly SlotRenderFailure[] => {
  const merged = new Map<string, SlotRenderFailure>()
  for (const failure of [...crashes, ...boundary]) merged.set(failure.slot, failure)
  return [...merged.values()]
}

/** Every Slot currently rendering its error boundary. */
const slotFailures = async (page: BootPage): Promise<readonly SlotRenderFailure[]> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let serializedSlotNames: unknown
  try {
    serializedSlotNames = await Promise.race([
      page.evaluate(
        selector => JSON.stringify([...document.querySelectorAll(selector)].map(element => element.getAttribute('data-slot-error'))) ?? '[]',
        SLOT_ERROR,
      ),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true
          reject(new Error('Slot inspection timed out.'))
        }, SLOT_INSPECTION_TIMEOUT_MS)
      }),
    ])
  } catch {
    const reason = timedOut
      ? `Browser Slot error-boundary inspection timed out after ${String(SLOT_INSPECTION_TIMEOUT_MS)} ms.`
      : 'Browser Slot error-boundary inspection failed.'
    throw new Error(reason)
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }

  let slotNames: unknown
  try {
    slotNames = JSON.parse(z.string().parse(serializedSlotNames))
  } catch {
    throw new Error('The browser returned invalid Slot error-boundary data.')
  }
  const parsedSlotNames = SlotFailureNamesSchema.safeParse(slotNames)
  if (!parsedSlotNames.success) throw new Error('The browser returned invalid Slot error-boundary data.')
  return slotRenderFailures(parsedSlotNames.data)
}
