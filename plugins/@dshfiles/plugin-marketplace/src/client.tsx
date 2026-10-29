import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { defineClient, defineSlot, PluginDetailBadge, PluginDetailSection } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import type { ReactNode } from 'react'
import { ContributionFailuresModel } from './contribution-failures.js'
import { MarketplaceTab, type MarketplaceTabProps } from './MarketplaceTab.js'
import { marketplaceLocale, MARKETPLACE_LOCALE_NAMESPACE } from './locales.js'

let tabLabel = (): string => 'Framework Hub'

const MarketplaceSlot = (props: MarketplaceTabProps): ReactNode => (
  <PluginQueryProvider>
    <MarketplaceTab {...props} />
  </PluginQueryProvider>
)

const marketplaceTab = defineSlot('settings.plugins.tab', {
  id: 'marketplace',
  order: 20,
  label: () => tabLabel(),
  locale: marketplaceLocale,
  component: MarketplaceSlot,
})

export default defineClient({
  name: '@dshfiles/plugin-marketplace',
  locales: [marketplaceLocale],
  slots: [marketplaceTab],
  setup(ctx, _decorate, metadata) {
    const t = ctx.locale.bind(MARKETPLACE_LOCALE_NAMESPACE)
    tabLabel = () => t('tab')
    metadata?.plugin?.add(PluginDetailBadge, { id: 'dshx-contribution-failures', component: ContributionFailuresModel.createBadge(t) })
    metadata?.plugin?.add(PluginDetailSection, { id: 'dshx-contribution-failures', component: ContributionFailuresModel.createSection(t) })
  },
})
