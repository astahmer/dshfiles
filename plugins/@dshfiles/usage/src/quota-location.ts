import type { UsageQuotaTarget, UsageQuotaView } from '@dshfiles/ai-accounts/quota-views'
import { panelOccurrence } from '@dshfiles/workbench/panel-occurrence'

/**
 * Where Usage › Quota stands: the view and the account a caller asked for. Module state, not a stored preference: the
 * last view is a session detail, and `open` comes from other plugins through the `UsageNavigation` contract. It lives
 * apart from the Quota tab, so the entry can navigate without loading the Usage page's lazy chunk.
 */
/** The account a quota view opens on, when a caller named one. */
export interface QuotaAccount {
  readonly accountId?: string
  readonly displayName?: string
}

export interface QuotaLocation extends QuotaAccount {
  readonly view: UsageQuotaView
  /** Bumped on every navigation, so the same account opened twice still remounts its view. */
  readonly visit: number
}

const createLocation = () => {
  let location: QuotaLocation = { view: 'accounts', visit: 0 }
  const listeners = new Set<() => void>()
  return {
    get: () => location,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (next: QuotaLocation) => {
      location = next
      for (const listener of listeners) listener()
    },
  }
}
const locations = new Map<string | undefined, ReturnType<typeof createLocation>>()
const locationFor = (panelId?: string) => {
  const key = panelId === undefined ? undefined : panelOccurrence({ panelId })
  const existing = locations.get(key)
  if (existing !== undefined) return existing
  const location = createLocation()
  locations.set(key, location)
  return location
}

/** The account fields that are set, without carrying an explicit `undefined` into the location. */
const accountOf = (source: { readonly accountId?: string | undefined; readonly displayName?: string | undefined }): QuotaAccount => {
  const { accountId, displayName } = source
  if (accountId === undefined) return displayName === undefined ? {} : { displayName }
  return displayName === undefined ? { accountId } : { accountId, displayName }
}

/** Land on a view (and account) of the Quota tab; the caller selects the Usage page and its Quota tab. */
const goToQuota = (target: UsageQuotaTarget = {}, panelId?: string): void => {
  const location = locationFor(panelId)
  const current = location.get()
  location.set({ view: target.view ?? current.view, ...accountOf(target), visit: current.visit + 1 })
}

export class QuotaLocations {
  static readonly for = locationFor
  static readonly accountOf = accountOf
  static readonly go = goToQuota
}
