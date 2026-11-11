import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'
import { useSyncExternalStore } from 'react'
import type { WizardOutcome } from './setup-wizard.js'

/** How the user last left the wizard, per browser: tour progress is presentation, never a Host setting. */
const outcome = createStoredValue({ key: 'dshfiles.onboarding.wizard.v1', schema: Schema.NullOr(Schema.Literals(['done', 'skipped'])), fallback: null })

let requested = false
const listeners = new Set<() => void>()
const publish = (next: boolean): void => {
  requested = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The first-run outcome plus an explicit replay request from the palette or the page. */
export class WizardStore {
  static readonly useOutcome = (): WizardOutcome | null => outcome.useValue()
  static readonly useRequested = (): boolean =>
    useSyncExternalStore(
      subscribe,
      () => requested,
      () => requested,
    )
  static readonly request = (): void => publish(true)
  static readonly finish = (next: WizardOutcome): void => {
    outcome.set(next)
    publish(false)
  }
}
