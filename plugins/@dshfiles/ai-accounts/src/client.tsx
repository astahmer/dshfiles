import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from './models-page-slot.js'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { AccountsPanel } from './accounts-panel.js'
import { QuotaFooter } from './quota-footer.js'
import { UsageHistoryPanel } from './usage-history-panel.js'
import { EdgeUsageWidget } from './edge-usage.js'
import { ModelsPageAccounts } from './models-page-accounts.js'
import { AiAccountsSettingsSection } from './settings-section.js'
import { AI_ACCOUNTS_LOCALE_NAMESPACE, aiAccountsLocale } from './locales.js'
import './client.css'

/**
 * The accounts page is a main panel with its own sidebar row, the same shape the
 * provider panels use, so it sits directly below Plugins instead of adding a
 * second place to look for account settings.
 */
const PANEL_ID = 'ai-accounts'
const USAGE_PANEL_ID = 'ai-accounts-usage'

export default defineClientPlugin({
  id: 'llm-ai-accounts',
  name: '@dshfiles/ai-accounts',
  uses: ['ui'],
  inject: ['layout', 'locale'],
  locales: [aiAccountsLocale],
  // Declare the services used through the scoped context. The UI capability
  // supplies the native slot adapter and decorates each registered component.
  setup(api) {
    const ctx = api.raw.ctx
    const label = (): string => ctx.locale.bind(AI_ACCOUNTS_LOCALE_NAMESPACE)('aiAccountsPanel')
    const historyLabel = (): string => ctx.locale.bind(AI_ACCOUNTS_LOCALE_NAMESPACE)('aiAccountsUsageHistory')
    const openUsageHistory = (): void => ctx.layout.selectPanel(USAGE_PANEL_ID as MainPanelId)
    const AccountsPanelView = (): JSX.Element => <AccountsPanel onOpenUsageHistory={openUsageHistory} />
    const UsageHistoryPanelView = (): JSX.Element => <UsageHistoryPanel onBack={() => ctx.layout.selectPanel(PANEL_ID as MainPanelId)} />
    const QuotaFooterView = (props: { readonly wide: boolean }): JSX.Element | null => <QuotaFooter {...props} onOpenUsageHistory={openUsageHistory} />
    const EdgeUsageHostView = (): JSX.Element | null => <EdgeUsageWidget onOpenUsageHistory={openUsageHistory} />
    const SettingsSectionView = (props: { readonly close: () => void }): JSX.Element => (
      <AiAccountsSettingsSection close={props.close} openAccounts={() => ctx.layout.selectPanel(PANEL_ID as MainPanelId)} />
    )
    // A settings page of its own, beside Models and Command Code in the nav.
    api.ui.register({ name: 'settings.section', id: 'ai-accounts', order: 40, label, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, SettingsSectionView)
    // The Models page only draws rows for settings namespaces, which accounts
    // are not, so they join it through its footer seat.
    api.ui.register({ name: 'settings.models.footer', id: 'ai-accounts-models', order: 0, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, ModelsPageAccounts)
    // The footer owns its whole surface, so quota lives there as a compact
    // disclosure: the number you want without opening the panel.
    api.ui.register(
      {
        name: 'sidebar.footer.action',
        id: 'ai-accounts-quota',
        order: 2,
        locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
      },
      QuotaFooterView,
    )
    // The edge overlay mounts with the shell, so it survives panel switches; a
    // settings toggle decides whether it draws.
    api.ui.register(
      {
        name: 'sidebar.footer.action',
        id: 'ai-accounts-edge',
        order: 3,
        locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
      },
      EdgeUsageHostView,
    )

    api.ui.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        // Plugins sits at order 0; 1 places this row directly beneath it.
        order: 1,
        label,
        locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
      },
      PanelGlyph,
    )
    api.ui.register(
      {
        name: 'sidebar.panellist',
        id: USAGE_PANEL_ID,
        order: 2,
        label: historyLabel,
        locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
      },
      UsageHistoryGlyph,
    )
    api.ui.register({ name: 'main', key: PANEL_ID, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, AccountsPanelView)
    api.ui.register({ name: 'main', key: USAGE_PANEL_ID, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, UsageHistoryPanelView)
  },
})

/** Icon for the sidebar row; the shell owns the button around it. */
const PanelGlyph = (props: { readonly size?: number; readonly active?: boolean }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M17 7.5h4.5M17 11h4.5M17 14.5h3" />
  </svg>
)

const UsageHistoryGlyph = (props: { readonly size?: number; readonly active?: boolean }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3v18h18" />
    <path d="m7 14 4-4 3 3 6-7" />
  </svg>
)
