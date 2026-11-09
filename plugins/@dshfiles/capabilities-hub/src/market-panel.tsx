import { useSyncExternalStore } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginMarketPage } from './plugin-market-page.js'

type SectionOwner = Parameters<PropsRenderSlots<'settings.section'>['renderSlot']>[1]

/**
 * The market page over the client's own section ledger: the catalog plugin registers its section whenever it loads, so
 * the page switches from the install hint to the catalog without a reload.
 */
export const createPluginMarketPage = (presence: {
  readonly subscribe: (listener: () => void) => () => void
  readonly installed: () => boolean
  readonly owner: SectionOwner
}) => {
  const PluginMarketPanel = (props: { readonly renderSlot: PropsRenderSlots<'settings.section'>['renderSlot'] }): JSX.Element => {
    const installed = useSyncExternalStore(presence.subscribe, presence.installed)
    return <PluginMarketPage renderSlot={props.renderSlot} owner={presence.owner} installed={installed} />
  }
  return PluginMarketPanel
}
