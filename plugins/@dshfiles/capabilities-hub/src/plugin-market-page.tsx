import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

/** The settings section dshmarket registers for its catalog; the page frames that one section and nothing else. */
export const MARKET_SECTION_ID = 'market'

type SectionRenderSlot = PropsRenderSlots<'settings.section'>['renderSlot']
/** What the settings section slot hands its entries; the market's card expects the same frame an All-settings row gives. */
type SectionOwner = Parameters<SectionRenderSlot>[1]

export interface PluginMarketPageProps {
  readonly renderSlot: SectionRenderSlot
  readonly owner: SectionOwner
  /** Whether a plugin (dshmarket) registered the market section in this client. */
  readonly installed: boolean
}

/**
 * The marketplace as its own stage page, so Settings lists it beside the managers instead of hiding the catalog
 * inside All settings. The catalog stays owned by the plugin that installs it: this page frames the section it
 * registered, and says how to install it when none did.
 */
export const PluginMarketPage = ({ renderSlot, owner, installed }: PluginMarketPageProps): JSX.Element =>
  installed ? (
    <div className="dshx-root dshx:h-full dshx:min-h-0 dshx:overflow-auto" data-dshfiles-plugin-market="">
      {renderSlot('settings.section', owner, { only: MARKET_SECTION_ID })}
    </div>
  ) : (
    <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-2 dshx:overflow-auto dshx:p-6" data-dshfiles-plugin-market="">
      <h2 className="dshx:m-0 dshx:text-base dshx:font-semibold">Plugin Market</h2>
      <p className="dshx:m-0 dshx:max-w-prose dshx:text-sm dshx:text-muted-foreground">
        The community catalog comes from the dshmarket plugin, which this profile does not have loaded.
      </p>
      <p className="dshx:m-0 dshx:max-w-prose dshx:text-sm dshx:text-muted-foreground">
        Install it with{' '}
        <code className="dshx:rounded dshx:bg-muted dshx:px-1 dshx:py-0.5 dshx:font-mono dshx:text-xs">dsh plugin --profile web add dshmarket</code> and reload;
        this page fills in on its own once the market registers.
      </p>
    </div>
  )
