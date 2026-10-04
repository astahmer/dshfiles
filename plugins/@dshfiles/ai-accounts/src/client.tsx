import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { useApi } from '@dshfiles/dshx/client'
import { defineClient } from '@dshfiles/dshx/client'
import { AccountsPanel } from './accounts-panel.js'
import { QuotaFooter } from './quota-footer.js'
import { UsageHistoryPanel } from './usage-history-panel.js'
import { AI_ACCOUNTS_LOCALE_NAMESPACE, aiAccountsLocale } from './locales.js'

/**
 * The accounts page is a main panel with its own sidebar row, the same shape the
 * provider panels use, so it sits directly below Plugins instead of adding a
 * second place to look for account settings.
 */
const PANEL_ID = 'ai-accounts'
const USAGE_PANEL_ID = 'ai-accounts-usage'

export default defineClient({
  name: '@dshfiles/ai-accounts',
  locales: [aiAccountsLocale],
  setup(ctx, decorate) {
    const label = (): string => ctx.locale.bind(AI_ACCOUNTS_LOCALE_NAMESPACE)('aiAccountsPanel')
    const historyLabel = (): string => ctx.locale.bind(AI_ACCOUNTS_LOCALE_NAMESPACE)('aiAccountsUsageHistory')
    const openUsageHistory = (): void => ctx.layout.selectPanel(USAGE_PANEL_ID as MainPanelId)
    const AccountsPanelView = (): JSX.Element => <AccountsPanel onOpenUsageHistory={openUsageHistory} />
    const UsageHistoryPanelView = (): JSX.Element => (
      <UsageHistoryPanel onBack={() => ctx.layout.selectPanel(PANEL_ID as MainPanelId)} />
    )
    const QuotaFooterView = (props: { readonly wide: boolean }): JSX.Element | null => (
      <QuotaFooter {...props} onOpenUsageHistory={openUsageHistory} />
    )
    // The footer owns its whole surface, so quota lives there as a compact
    // disclosure: the number you want without opening the panel.
    ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register(
        {
          name: 'sidebar.footer.action',
          id: 'ai-accounts-quota',
          order: 2,
          locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
        },
        QuotaFooterView,
      ),
    )

    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: PANEL_ID,
          // Plugins sits at order 0; 1 places this row directly beneath it.
          order: 1,
          label,
          locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
        },
        PanelGlyph,
      ),
    )
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: USAGE_PANEL_ID,
          order: 2,
          label: historyLabel,
          locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
        },
        UsageHistoryGlyph,
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: AI_ACCOUNTS_LOCALE_NAMESPACE },
        AccountsPanelView,
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: USAGE_PANEL_ID, locale: AI_ACCOUNTS_LOCALE_NAMESPACE },
        UsageHistoryPanelView,
      ),
    )
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
