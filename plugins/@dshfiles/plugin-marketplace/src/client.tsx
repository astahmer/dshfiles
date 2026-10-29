import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { defineClient, PluginDetailBadge, PluginDetailSection, SettingsSection, type SettingsSectionItem } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ContributionFailuresModel } from './contribution-failures.js'
import { MarketplaceTab } from './MarketplaceTab.js'
import { marketplaceLocale, MARKETPLACE_LOCALE_NAMESPACE } from './locales.js'

export default defineClient({
  name: '@dshfiles/plugin-marketplace',
  locales: [marketplaceLocale],
  setup(ctx, _decorate, metadata) {
    const t = ctx.locale.bind(MARKETPLACE_LOCALE_NAMESPACE)
    const plugin = metadata?.plugin
    if (plugin === undefined) return
    const MarketplaceSlot = () => (
      <PluginQueryProvider>
        <MarketplaceTab t={t} />
      </PluginQueryProvider>
    )
    plugin.add(SettingsSection, (track): SettingsSectionItem => {
      track(plugin.environment.locale)
      return { id: 'marketplace', title: t('tab'), order: 20, placement: 'plugins', component: MarketplaceSlot }
    })
    plugin.add(PluginDetailBadge, { id: 'dshx-contribution-failures', component: ContributionFailuresModel.createBadge(t) })
    plugin.add(PluginDetailSection, { id: 'dshx-contribution-failures', component: ContributionFailuresModel.createSection(t) })
  },
})
