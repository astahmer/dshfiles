import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'
import { useSyncExternalStore } from 'react'
import type { WizardOutcome } from './setup-wizard.js'

/** How the user last left the wizard, per browser: tour progress is presentation, never a Host setting. */
const outcome = createStoredValue({ key: 'dshfiles.onboarding.wizard.v1', schema: Schema.NullOr(Schema.Literals(['done', 'skipped'])), fallback: null })

/** An explicit replay is open; `closed` is this page load's "not now" (Escape, the close button, a followed link). */
let state = { requested: false, closed: false }
const listeners = new Set<() => void>()
const publish = (next: typeof state): void => {
  state = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The first-run outcome, an explicit replay request from the palette or the page, and this load's dismissal. */
export class WizardStore {
  static readonly useOutcome = (): WizardOutcome | null => outcome.useValue()
  static readonly useRequested = (): boolean =>
    useSyncExternalStore(
      subscribe,
      () => state.requested,
      () => state.requested,
    )
  /** Closed for now: the wizard does not open by itself again until the next page load. */
  static readonly useClosed = (): boolean =>
    useSyncExternalStore(
      subscribe,
      () => state.closed,
      () => state.closed,
    )
  static readonly request = (): void => publish({ ...state, requested: true })
  static readonly finish = (next: WizardOutcome): void => {
    outcome.set(next)
    publish({ ...state, requested: false })
  }
  /** Put away without an outcome: it may open by itself again on a later load while setup is still missing. */
  static readonly close = (): void => publish({ requested: false, closed: true })
}
