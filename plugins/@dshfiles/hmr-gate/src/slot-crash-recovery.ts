import { Option } from 'effect'
import * as Schema from 'effect/Schema'

const decodeAttempts = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Finite)))

declare global {
  // A page-wide flag: every reload of this bundle is a new module, so a module-level one would install again.
  var dshfilesSlotCrashRecoveryInstalled: boolean | undefined
}

/** Where the install flag lives; the page's global object by default. */
interface RecoveryRegistry {
  dshfilesSlotCrashRecoveryInstalled?: boolean | undefined
}

export type RecoveryListener = (event: { readonly error?: unknown }) => void

interface RecoveryPage {
  readonly addEventListener: (type: 'error', listener: RecoveryListener) => void
  readonly storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | undefined
  readonly setTimeout: (run: () => void, ms: number) => void
  readonly reload: () => void
  readonly now: () => number
}

/**
 * A recomposition (a Host restart, or swapping the client of a plugin others inject, such as the Session controller)
 * can leave a slot with no adapter for one render; the stock renderer then throws SlotAssemblyError past every error
 * boundary and React unmounts the page. The page reloads instead of staying blank.
 *
 * Installed once per page and never removed: that same recomposition disposes and re-runs this plugin, so a listener or
 * timer the plugin owned was gone exactly when it was needed. A page that crashes again right after its reload (the
 * Host still coming back) retries with longer delays, then stops so a deterministic failure cannot loop.
 */
export class SlotCrashRecovery {
  static readonly storageKey = 'dshfiles.hmr-gate.slot-recovery'
  /** Delay before each successive reload inside one window; the first lets the rest of a rebuild burst arrive. */
  static readonly delaysMs = [1_500, 5_000, 15_000] as const
  static readonly windowMs = 120_000

  static installOnce(page: RecoveryPage, registry: RecoveryRegistry = globalThis): void {
    if (registry.dshfilesSlotCrashRecoveryInstalled === true) return
    registry.dshfilesSlotCrashRecoveryInstalled = true
    let pending = false
    page.addEventListener('error', event => {
      if (pending || !(event.error instanceof Error) || event.error.name !== 'SlotAssemblyError') return
      const now = page.now()
      const recent = SlotCrashRecovery.attempts(page).filter(at => now - at < SlotCrashRecovery.windowMs)
      const delay = SlotCrashRecovery.delaysMs[recent.length]
      if (delay === undefined) return
      pending = true
      page.setTimeout(() => {
        try {
          page.storage?.setItem(SlotCrashRecovery.storageKey, JSON.stringify([...recent, page.now()]))
        } catch {}
        page.reload()
      }, delay)
    })
  }

  private static attempts(page: RecoveryPage): readonly number[] {
    let stored: string | null | undefined
    try {
      stored = page.storage?.getItem(SlotCrashRecovery.storageKey)
    } catch {}
    return Option.getOrElse(decodeAttempts(stored), () => [])
  }
}
