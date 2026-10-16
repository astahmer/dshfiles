import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from './models-page-slot.js'
import type {} from './sidebar-footer-slot.js'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { createWorkspacePickerPorts, type WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { AccountsPanel } from './accounts-panel.js'
import type { CredentialSetupPort } from './credential-setup-port.js'
import { QuotaFooter, QuotaStrip } from './quota-footer.js'
import { UsageHistoryPanel } from './usage-history-panel.js'
import { EdgeUsageWidget } from './edge-usage.js'
import { ModelsPageAccounts } from './models-page-accounts.js'
import { SessionCostDockEntry } from './session-cost.js'
import { CredentialRecoveryMessage } from './credential-recovery-message.js'
import { QuotaRetryMessage } from './quota-retry-message.js'
import { AiAccountsSettingsSection } from './settings-section.js'
import { AI_ACCOUNTS_LOCALE_NAMESPACE, aiAccountsLocale } from './locales.js'
import { useSyncExternalStore } from 'react'

/**
 * The accounts page is a main panel with its own sidebar row, the same shape the
 * provider panels use, so it sits directly below Plugins instead of adding a
 * second place to look for account settings.
 */
const PANEL_ID = 'ai-accounts'
const USAGE_PANEL_ID = 'ai-accounts-usage'
const USAGE_STRIP_ID = 'ai-accounts-usage-strip'

export default defineClientPlugin({
  id: 'llm-ai-accounts',
  name: '@dshfiles/ai-accounts',
  uses: ['ui'],
  inject: ['layout', 'locale', 'remote', 'remote.credentials'],
  locales: [aiAccountsLocale],
  // Declare the services used through the scoped context. The UI capability
  // supplies the native slot adapter and decorates each registered component.
  setup(api) {
    const ctx = api.raw.ctx
    const folderPicker: WorkspacePickerPorts = createWorkspacePickerPorts(ctx.remote)
    const remoteCredentials = ctx.remote?.credentials
    const credentialSetup: CredentialSetupPort | undefined =
      remoteCredentials === undefined
        ? undefined
        : {
            describe: async ref => {
              const result = await remoteCredentials.describe([ref])
              if (!result.ok) throw new Error('Credential status is unavailable.')
              const info = result.value[ref]
              if (info === undefined) throw new Error('Credential status is unavailable.')
              return info
            },
            set: async (ref, value) => {
              const result = await remoteCredentials.set(ref, value)
              if (!result.ok) throw new Error('The key could not be stored in DSH credentials.')
            },
          }
    const translate = ctx.locale.bind(AI_ACCOUNTS_LOCALE_NAMESPACE)
    const label = (): string => translate('aiAccountsPanel')
    const historyLabel = (): string => translate('aiAccountsUsageHistory')
    // SAFETY: This id is registered as a main-panel slot below.
    const openAccounts = (): void => ctx.layout.selectPanel(PANEL_ID as MainPanelId)
    // SAFETY: This id is registered as a main-panel slot below.
    const openUsageHistory = (): void => ctx.layout.selectPanel(USAGE_PANEL_ID as MainPanelId)
    // Every slot shares the bundle's query client, so the footer, edge widget
    // and panels read one usage cache instead of polling side by side.
    const AccountsPanelView = (): JSX.Element => (
      <PluginQueryProvider>
        <AccountsPanel credentialSetup={credentialSetup} folderPicker={folderPicker} onOpenUsageHistory={openUsageHistory} />
      </PluginQueryProvider>
    )
    const UsageHistoryPanelView = (): JSX.Element => (
      <PluginQueryProvider>
        <UsageHistoryPanel onBack={openAccounts} />
      </PluginQueryProvider>
    )
    const subscribeStripSeat = (listener: () => void): (() => void) => ctx.slots.subscribe('sidebar.footer.above', listener)
    const stripSeated = (): boolean => ctx.slots.entriesOfSlot('sidebar.footer.above').some(entry => entry.options.id === USAGE_STRIP_ID)
    const QuotaFooterView = (props: { readonly wide: boolean }): JSX.Element => {
      const seated = useSyncExternalStore(subscribeStripSeat, stripSeated)
      return (
        <PluginQueryProvider>
          <QuotaFooter onOpenUsageHistory={openUsageHistory} stripSeated={seated} wide={props.wide} />
        </PluginQueryProvider>
      )
    }
    const QuotaStripView = (): JSX.Element => (
      <PluginQueryProvider>
        <QuotaStrip onOpenUsageHistory={openUsageHistory} />
      </PluginQueryProvider>
    )
    const EdgeUsageHostView = (): JSX.Element => (
      <PluginQueryProvider>
        <EdgeUsageWidget onOpenUsageHistory={openUsageHistory} />
      </PluginQueryProvider>
    )
    const ModelsPageAccountsView = (): JSX.Element => (
      <PluginQueryProvider>
        <ModelsPageAccounts />
      </PluginQueryProvider>
    )
    // Dock entries share the bundle's query client, so every open composer reads one quote cache.
    const SessionCostView = (props: { readonly useProjection?: unknown }): JSX.Element => (
      <PluginQueryProvider>
        <SessionCostDockEntry useProjection={props.useProjection} />
      </PluginQueryProvider>
    )
    const CredentialRecoveryMessageView = (props: { readonly turn: TurnLocation }): JSX.Element | null => (
      <CredentialRecoveryMessage
        turn={props.turn}
        onOpenAccounts={openAccounts}
        hint={translate('credentialRecoveryHint')}
        actionLabel={translate('credentialRecoveryAction')}
      />
    )
    const QuotaRetryMessageView = (props: { readonly turn: TurnLocation; readonly sessionId: string }): JSX.Element => (
      <PluginQueryProvider>
        <QuotaRetryMessage turn={props.turn} sessionId={props.sessionId} />
      </PluginQueryProvider>
    )
    const SettingsSectionView = (props: { readonly close: () => void }): JSX.Element => (
      <PluginQueryProvider>
        <AiAccountsSettingsSection close={props.close} openAccounts={openAccounts} />
      </PluginQueryProvider>
    )
    // A settings page of its own, beside Models and Command Code in the nav.
    api.ui.register({ name: 'settings.section', id: 'ai-accounts', order: 40, label, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, SettingsSectionView)
    // The Models page only draws rows for settings namespaces, which accounts
    // are not, so they join it through its footer seat.
    api.ui.register({ name: 'settings.models.footer', id: 'ai-accounts-models', order: 0, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, ModelsPageAccountsView)
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
    // Only the thread sidebar declares this seat; registration waits for it, and the footer action yields the wide strip to it.
    api.ui.register({ name: 'sidebar.footer.above', id: USAGE_STRIP_ID, order: 0, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, QuotaStripView)
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

    // Its own id beside the shipped `stats` cell: reusing `stats` would replace the token readout.
    api.ui.register({ name: 'conversation.composer.dock', id: 'ai-accounts-session-cost', order: 10, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, SessionCostView)
    api.ui.register(
      { name: 'conversation.chat.turnTail', id: 'ai-accounts-credential-recovery', order: 10, locale: AI_ACCOUNTS_LOCALE_NAMESPACE },
      CredentialRecoveryMessageView,
    )
    api.ui.register(
      {
        name: 'conversation.chat.turnTail',
        id: 'ai-accounts-quota-retry',
        order: 20,
        locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
        inject: sessionId => ({ sessionId }),
      },
      QuotaRetryMessageView,
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
