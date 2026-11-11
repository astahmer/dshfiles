import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'

/** The newest change the user marked seen, per browser: what counts as new is presentation, never a Host setting. */
const lastSeen = createStoredValue({ key: 'dshfiles.onboarding.whats-new.v1', schema: Schema.NullOr(Schema.String), fallback: null })

export class WhatsNewStore {
  static readonly useLastSeen = (): string | null => lastSeen.useValue()
  static readonly markSeen = (newest: string): boolean => lastSeen.set(newest)
}
