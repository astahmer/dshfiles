import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import { useEffect, useSyncExternalStore } from 'react'
import { dispatchOpenSettings } from '@dshfiles/settings-shell/open-settings'

/** The settings section dshmarket registers for its catalog. */
export const MARKET_SECTION_ID = 'market'

/**
 * The Plugin Market row of the Settings destination. The catalog is a `settings.section` dshmarket owns, and only
 * settings-shell may declare and render that slot, so the row hands over to Settings opened at that section. Without
 * the market the page is one sentence and one action (open the Plugins page, which lists what is installed); it
 * switches over as soon as dshmarket registers its section.
 */
export const createPluginMarketPanel = (presence: {
  readonly subscribe: (listener: () => void) => () => void
  readonly installed: () => boolean
  /** Open the Plugins page; absent when this composition has none, and the page then offers no action. */
  readonly openPlugins?: (() => void) | undefined
}) =>
  function PluginMarketPanel(): JSX.Element | null {
    const installed = useSyncExternalStore(presence.subscribe, presence.installed)
    useEffect(() => {
      if (installed) dispatchOpenSettings({ section: MARKET_SECTION_ID })
    }, [installed])
    if (installed) return null
    const openPlugins = presence.openPlugins
    return (
      <main aria-label="Plugin market" className="dshx-root dshx:h-full" data-dshfiles-plugin-market="">
        <Page scroll heading="Plugin market">
          <EmptyState {...(openPlugins === undefined ? undefined : { action: { label: 'Open Plugins', onSelect: openPlugins } })}>
            The community catalog is not installed in this profile. Add the market plugin from the Plugins page to browse it here.
          </EmptyState>
        </Page>
      </main>
    )
  }
