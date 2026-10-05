import type { Page } from '@playwright/test'
import { z } from 'zod'

export interface BrowserBootOptions {
  readonly timeoutMs: number
  readonly expectedClientEntries: readonly string[]
  readonly inspectSlotFailures?: boolean
}

/** A Slot that threw while rendering, as the renderer marked it in the DOM. */
export interface SlotRenderFailure {
  readonly slot: string
}

export interface BrowserBootOutcome {
  /** True when DSH's readiness signal resolved and the application root mounted. */
  readonly ready: boolean
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
   * Slots that mounted an error boundary instead of their entry. An entry that
   * throws while rendering never reaches the boot audit, because the fiber itself
   * activated fine — only the boundary caught it.
   */
  readonly slotFailures: readonly SlotRenderFailure[]
}

const SLOT_ERROR = '[data-slot-error]'
const SLOT_INSPECTION_TIMEOUT_MS = 10_000
const SlotFailureNamesSchema = z.array(z.string().nullable())

/**
 * Read the boot card and any Slot that fell to its error boundary.
 *
 * Read DSH's native boot manifest and readiness promise, then verify the app root
 * mounted. The boot card is useful failure detail, but its absence alone cannot
 * distinguish a mounted application from a blank or unauthenticated document.
 *
 * The error boundaries matter as much as the card, and for a different reason. A
 * plugin whose apply throws never reaches active and lands in the audit, but one
 * that reads a service it never declared throws while rendering, after it has
 * already activated. The fiber is fine, the audit is clean, and the only trace is
 * a marker element where a panel should be. Checking one without the other misses
 * a whole class: the audit catches activation, the boundary catches render.
 *
 * The page is passed in rather than opened here so this module stays a pure
 * reader: the caller owns the browser and the Host, which is also what lets the
 * E2E scenarios share one launch across every assertion.
 */
export const readClientBootOutcome = async (page: Page, options: BrowserBootOptions): Promise<BrowserBootOutcome> => {
  const nativeReadiness = await page.evaluate(
    async ({ expectedClientEntries, timeoutMs }) => {
      const readClientEntryIds = (): string[] => {
        const boot = Reflect.get(globalThis, '__DSH_BOOT__')
        if (boot === null || typeof boot !== 'object') return []
        const entries = Reflect.get(boot, 'entries')
        if (!Array.isArray(entries)) return []
        return entries.flatMap(entry => {
          if (entry === null || typeof entry !== 'object') return []
          const id = Reflect.get(entry, 'id')
          return typeof id === 'string' ? [id] : []
        })
      }

      const deadline = Date.now() + timeoutMs
      let readiness: Promise<'resolved' | 'rejected'> | undefined
      while (Date.now() < deadline) {
        const readyCard = document.querySelector('[data-dsh-boot]')
        const readyText = readyCard?.textContent ?? ''
        const clientEntryIds = readClientEntryIds()
        const missingClientEntries = expectedClientEntries.filter(id => !clientEntryIds.includes(id))
        const ready = Reflect.get(globalThis, '__DSH_BOOT_READY__')
        const signal = ready !== null && typeof ready === 'object' ? Reflect.get(ready, 'promise') : undefined
        const hasThen = signal !== null && (typeof signal === 'object' || typeof signal === 'function') && typeof Reflect.get(signal, 'then') === 'function'

        if (hasThen) {
          readiness ??= Promise.resolve(signal).then(
            () => 'resolved' as const,
            () => 'rejected' as const,
          )
          const state = await Promise.race([readiness, new Promise<'waiting'>(resolve => setTimeout(() => resolve('waiting'), 100))])
          if (state === 'rejected') {
            return {
              ready: false,
              missingClientEntries,
              failureCardVisible: readyText.includes('Failed to load plugins'),
              text: readyText,
              timedOut: false,
              readinessError: 'The native DSH Client readiness promise rejected.',
            }
          }
          if (state === 'resolved') {
            const root = document.querySelector('#root')
            if (root !== null && root.childElementCount > 0) {
              return {
                ready: true,
                missingClientEntries,
                failureCardVisible: readyText.includes('Failed to load plugins'),
                text: readyText,
                timedOut: false,
              }
            }
          }
        } else {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      const card = document.querySelector('[data-dsh-boot]')
      const clientEntryIds = readClientEntryIds()
      return {
        ready: false,
        missingClientEntries: expectedClientEntries.filter(id => !clientEntryIds.includes(id)),
        failureCardVisible: (card?.textContent ?? '').includes('Failed to load plugins'),
        text: card?.textContent ?? '',
        timedOut: true,
        readinessError: 'DSH did not resolve its native Client readiness signal and mount the application root before the deadline.',
      }
    },
    { expectedClientEntries: options.expectedClientEntries, timeoutMs: options.timeoutMs },
  )

  const text = nativeReadiness.text
  const failures = options.inspectSlotFailures === false ? [] : await slotFailures(page)
  return {
    ...nativeReadiness,
    text,
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
  slotNames.filter((slot): slot is string => slot !== null && slot !== '').map(slot => ({ slot }))

/** Every Slot currently rendering its error boundary. */
const slotFailures = async (page: Page): Promise<readonly SlotRenderFailure[]> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let serializedSlotNames: string
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
    slotNames = JSON.parse(serializedSlotNames)
  } catch {
    throw new Error('The browser returned invalid Slot error-boundary data.')
  }
  const parsedSlotNames = SlotFailureNamesSchema.safeParse(slotNames)
  if (!parsedSlotNames.success) throw new Error('The browser returned invalid Slot error-boundary data.')
  return slotRenderFailures(parsedSlotNames.data)
}
