import { useEffect, useSyncExternalStore } from 'react'

/** The settings section dshmarket registers for its catalog. */
export const MARKET_SECTION_ID = 'market'

/** settings-shell's cross-plugin open request; see its README, "Open Settings from another plugin". */
const OPEN_SETTINGS_EVENT = 'dshfiles:open-settings'

/**
 * The Plugin Market row of the Settings destination. The catalog is a `settings.section` dshmarket owns, and only
 * settings-shell may declare and render that slot, so the row hands over to Settings opened at that section. Without
 * the market, the row says how to install it; it switches over as soon as dshmarket registers its section.
 */
export const createPluginMarketPanel = (presence: { readonly subscribe: (listener: () => void) => () => void; readonly installed: () => boolean }) =>
  function PluginMarketPanel(): JSX.Element | null {
    const installed = useSyncExternalStore(presence.subscribe, presence.installed)
    useEffect(() => {
      if (installed) window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section: MARKET_SECTION_ID }, cancelable: true }))
    }, [installed])
    if (installed) return null
    return (
      <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-2 dshx:overflow-auto dshx:p-6" data-dshfiles-plugin-market="">
        <h2 className="dshx:m-0 dshx:text-base dshx:font-semibold">Plugin Market</h2>
        <p className="dshx:m-0 dshx:max-w-prose dshx:text-sm dshx:text-muted-foreground">
          The community catalog comes from the dshmarket plugin, which this profile does not load. Install it with{' '}
          <code className="dshx:rounded dshx:bg-muted dshx:px-1 dshx:py-0.5 dshx:font-mono dshx:text-xs">dsh plugin --profile web add dshmarket</code>.
        </p>
      </div>
    )
  }
