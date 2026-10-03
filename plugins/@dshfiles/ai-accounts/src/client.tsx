import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { useApi } from '@dshfiles/dshx/client'
import { defineClient } from '@dshfiles/dshx/client'
import { AccountsPanel } from './accounts-panel.js'
import { QuotaFooter } from './quota-footer.js'
import { AI_ACCOUNTS_LOCALE_NAMESPACE, aiAccountsLocale } from './locales.js'

/**
 * The accounts page is a main panel with its own sidebar row, the same shape the
 * provider panels use, so it sits directly below Plugins instead of adding a
 * second place to look for account settings.
 */
const PANEL_ID = 'ai-accounts'

export default defineClient({
  name: '@dshfiles/ai-accounts',
  locales: [aiAccountsLocale],
  setup(ctx) {
    const label = (): string => ctx.locale.bind(AI_ACCOUNTS_LOCALE_NAMESPACE)('aiAccountsPanel')
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
        QuotaFooter,
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
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: AI_ACCOUNTS_LOCALE_NAMESPACE },
        AccountsPanel,
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