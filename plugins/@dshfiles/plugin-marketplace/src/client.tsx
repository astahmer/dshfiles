import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { defineClient, defineSlot } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import type { ReactNode } from 'react'
import { MarketplaceTab, type MarketplaceTabProps } from './MarketplaceTab.js'
import { marketplaceLocale, MARKETPLACE_LOCALE_NAMESPACE } from './locales.js'
import { ToolsTab, type ToolsTabProps } from './tools-tab.js'
import { toolsLocale, TOOLS_LOCALE_NAMESPACE } from './tools-locales.js'
import './client.css'

let tabLabel = (): string => 'Framework Hub'
let toolsTabLabel = (): string => 'Tools'

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

const ToolsSlot = (props: ToolsTabProps): ReactNode => (
  <PluginQueryProvider>
    <ToolsTab {...props} />
  </PluginQueryProvider>
)

const toolsTab = defineSlot('settings.plugins.tab', {
  id: 'tools',
  order: 30,
  label: () => toolsTabLabel(),
  locale: toolsLocale,
  component: ToolsSlot,
})

export default defineClient({
  name: '@dshfiles/plugin-marketplace',
  locales: [marketplaceLocale, toolsLocale],
  slots: [marketplaceTab, toolsTab],
  setup(ctx) {
    const t = ctx.locale.bind(MARKETPLACE_LOCALE_NAMESPACE)
    tabLabel = () => t('tab')
    const tools = ctx.locale.bind(TOOLS_LOCALE_NAMESPACE)
    toolsTabLabel = () => tools('tab')
  },
})
