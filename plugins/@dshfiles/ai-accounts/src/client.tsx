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
import { createWorkspacePickerPorts, type WorkspacePickerPorts } from '@dshfiles/workspace-folder-picker/picker'
import { AccountsPanel } from './accounts-panel.js'
import { createAccountSetupController } from './account-setup-controller.js'
import { AccountSetupOverlay } from './account-setup-dialog.js'
import { useServingAccount, type UseServingAccountSessions } from './use-serving-account.js'
import type { CredentialSetupPort } from './credential-setup-port.js'
import { QuotaStrip } from './quota-footer.js'
import { QuotaStatusItem } from './quota-status-item.js'
import { ThreadAccountSurface } from './thread-account-dialog.js'
import { UsageHistoryPanel } from './usage-history-panel.js'
import { QuotaForecastPanel } from './quota-forecast-panel.js'
import { QuotaAccountsView } from './quota-accounts-view.js'
import { AccountQuotaViews, UsageNavigation, type QuotaViewProps, type UsageQuotaTarget, type UsageQuotaView } from './quota-views.js'
import { useEffect } from 'react'
import { useContract } from '@dshfiles/dshx/client'
import { EdgeUsageWidget } from './edge-usage.js'
import { ModelsPageAccounts } from './models-page-accounts.js'
import { SessionCostDockEntry } from './session-cost.js'
import { TurnCostEstimate } from './turn-cost-estimate.js'
import { CredentialRecoveryMessage } from './credential-recovery-message.js'
// Type-only: the owned Chat fork's seat beside Resume on a failed turn.
import type {} from '@dshfiles/chat/turn-error-action'
import type { TurnUsageCostOwnerProps } from '@dshfiles/chat/turn-usage-cost'
import { QuotaAutoResumeToggle } from './quota-auto-resume-toggle.js'
import { QuotaRetryMessage } from './quota-retry-message.js'
import { AiAccountsSettingsSection } from './settings-section.js'
import { AI_ACCOUNTS_LOCALE_NAMESPACE, aiAccountsLocale } from './locales.js'

/**
 * The accounts page is a main panel with its own sidebar row, the same shape the
 * provider panels use, so it sits directly below Plugins instead of adding a
 * second place to look for account settings.
 */
const PANEL_ID = 'ai-accounts'
const USAGE_PANEL_ID = 'ai-accounts-usage'
const FORECAST_PANEL_ID = 'ai-accounts-forecast'
const USAGE_STRIP_ID = 'ai-accounts-usage-strip'

export default defineClientPlugin({
  id: 'llm-ai-accounts',
  name: '@dshfiles/ai-accounts',
  uses: ['ui'],
  inject: ['layout', 'locale', 'remote', 'remote.credentials', 'sessions'],
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
    const setupController = createAccountSetupController()
    ctx.effect(() => () => setupController.close())
    const openSetup = (onCreated?: (accountId: string) => void): void => setupController.open(onCreated === undefined ? {} : { onCreated })
    const reconnect = (accountId: string): void => setupController.open({ accountId })
    const SetupOverlayView = (): JSX.Element => (
      <PluginQueryProvider>
        <AccountSetupOverlay controller={setupController} credentialSetup={credentialSetup} folderPicker={folderPicker} />
      </PluginQueryProvider>
    )
    api.ui.register({ name: 'shell.overlay', id: 'ai-accounts-setup', order: 20, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, SetupOverlayView)
    const translate = ctx.locale.bind(AI_ACCOUNTS_LOCALE_NAMESPACE)
    const label = (): string => translate('aiAccountsPanel')
    // SAFETY: This id is registered as a main-panel slot below.
    const openAccounts = (): void => ctx.layout.selectPanel(PANEL_ID as MainPanelId)
    // Usage and quota live on one page now, Observe › Usage › Quota (docs/ade-ux §6), owned by @dshfiles/usage. Without
    // usage, the former Usage history and Quota forecast pages below still open, so nothing is lost.
    const usageNavigation = api.use(UsageNavigation)
    const openQuota = (target: UsageQuotaTarget, fallback: string): void => {
      const navigation = usageNavigation.get()
      if (navigation.status === 'active') navigation.value.openQuota(target)
      // SAFETY: Both fallback ids are registered as main-panel slots below.
      else ctx.layout.selectPanel(fallback as MainPanelId)
    }
    const openUsageHistory = (): void => openQuota({ view: 'history' }, USAGE_PANEL_ID)
    // Every slot shares the bundle's query client, so the footer, edge widget
    // and panels read one usage cache instead of polling side by side.
    const AccountsPanelView = (): JSX.Element => (
      <PluginQueryProvider>
        <AccountsPanel
          credentialSetup={credentialSetup}
          folderPicker={folderPicker}
          onOpenUsageHistory={openUsageHistory}
          onAddAccount={openSetup}
          onConnectAccount={reconnect}
        />
      </PluginQueryProvider>
    )
    // A saved tab of a former page redirects to its view in Usage › Quota while usage runs; otherwise it is the page.
    const QuotaRedirect = (props: { readonly view: UsageQuotaView; readonly children: JSX.Element }): JSX.Element | null => {
      const active = useContract(UsageNavigation).status === 'active'
      useEffect(() => {
        if (active) openQuota({ view: props.view }, '')
      }, [active, props.view])
      return active ? null : props.children
    }
    const UsageHistoryPanelView = (): JSX.Element => (
      <QuotaRedirect view="history">
        <PluginQueryProvider>
          <UsageHistoryPanel onBack={openAccounts} />
        </PluginQueryProvider>
      </QuotaRedirect>
    )
    const QuotaForecastPanelView = (): JSX.Element => (
      <QuotaRedirect view="forecast">
        <PluginQueryProvider>
          <QuotaForecastPanel onBack={openAccounts} />
        </PluginQueryProvider>
      </QuotaRedirect>
    )
    // The quota views Usage › Quota draws; bound so their hooks read this plugin's API and query cache.
    const QuotaAccountsSection = (props: QuotaViewProps): JSX.Element => (
      <PluginQueryProvider>
        <QuotaAccountsView {...props} onOpenAccounts={openAccounts} onOpenHistory={accountId => openQuota({ view: 'history', accountId }, USAGE_PANEL_ID)} />
      </PluginQueryProvider>
    )
    const QuotaHistorySection = (props: QuotaViewProps): JSX.Element => (
      <PluginQueryProvider>
        <UsageHistoryPanel embedded onBack={openAccounts} {...(props.accountId === undefined ? {} : { accountId: props.accountId })} />
      </PluginQueryProvider>
    )
    const QuotaForecastSection = (): JSX.Element => (
      <PluginQueryProvider>
        <QuotaForecastPanel embedded onBack={openAccounts} />
      </PluginQueryProvider>
    )
    api.provide(AccountQuotaViews, {
      Accounts: api.bind(QuotaAccountsSection),
      History: api.bind(QuotaHistorySection),
      Forecast: api.bind(QuotaForecastSection),
    })
    const ConnectedQuotaStrip = (props: { readonly useSessions: UseServingAccountSessions }): JSX.Element => {
      const serving = useServingAccount(props.useSessions)
      return (
        <ThreadAccountSurface key={serving.sessionId} sessionId={serving.sessionId}>
          {choose => (
            <QuotaStrip
              {...(choose === undefined ? {} : { onUseForThread: choose })}
              onOpenAccounts={openAccounts}
              onOpenUsageHistory={openUsageHistory}
              onAddAccount={() => openSetup()}
              onConnectAccount={reconnect}
              activeAccountId={serving.activeAccountId}
              activeAccountRunning={serving.running}
            />
          )}
        </ThreadAccountSurface>
      )
    }
    const QuotaStripView = (props: { readonly useSessions: UseServingAccountSessions }): JSX.Element => (
      <PluginQueryProvider>
        <ConnectedQuotaStrip useSessions={props.useSessions} />
      </PluginQueryProvider>
    )
    const EdgeUsageHostView = (): JSX.Element => (
      <PluginQueryProvider>
        <EdgeUsageWidget onOpenUsageHistory={openUsageHistory} onConnectAccount={reconnect} />
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
    const TurnCostEstimateView = (props: TurnUsageCostOwnerProps): JSX.Element | null => (
      <PluginQueryProvider>
        <TurnCostEstimate {...props} />
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
    const QuotaAutoResumeToggleView = (props: { readonly sessionId: string; readonly seq: number }): JSX.Element => (
      <PluginQueryProvider>
        <QuotaAutoResumeToggle sessionId={props.sessionId} seq={props.seq} />
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
    // Quota lives in the frame's status strip now (docs/ade-ux §4.1 R5), as one item instead of the sidebar footer's
    // menu and preview strip; frame-layout renders nothing for it when another frame owns the layout.
    ctx.effect(() =>
      QuotaStatusItem.register({
        plugin: api,
        View: props => <QuotaStripView useSessions={props.useSessions} />,
        open: () => openQuota({ view: 'accounts' }, USAGE_PANEL_ID),
      }),
    )
    // The same strip stays a movable Workbench view in free docking, where the thread sidebar still seats it above its foot.
    api.ui.register(
      { name: 'sidebar.footer.above', id: USAGE_STRIP_ID, order: 0, label: 'AI Accounts: Preview', locale: AI_ACCOUNTS_LOCALE_NAMESPACE },
      QuotaStripView,
    )
    // The edge overlay mounts with the shell, so it survives panel switches; a
    // settings toggle decides whether it draws.
    api.ui.register(
      {
        name: 'sidebar.footer.action',
        id: 'ai-accounts-edge',
        order: 3,
        label: 'AI Accounts: Edge preview',
        locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
      },
      EdgeUsageHostView,
    )

    // Its own id beside the shipped `stats` cell: reusing `stats` would replace the token readout.
    api.ui.register({ name: 'conversation.composer.dock', id: 'ai-accounts-session-cost', order: 10, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, SessionCostView)
    api.ui.register({ name: 'conversation.chat.turnUsageCost', id: 'ai-accounts-turn-cost', order: 0 }, TurnCostEstimateView)
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
    // Beside Resume on the failed turn itself, so the per-thread choice lives
    // where the user decides to resume. Declared by the owned Chat fork.
    api.ui.register(
      {
        name: 'conversation.chat.turnErrorAction',
        id: 'ai-accounts-quota-auto-resume',
        order: 10,
        inject: sessionId => ({ sessionId }),
      },
      QuotaAutoResumeToggleView,
    )

    api.ui.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        // Plugins sits at order 0; 1 places this row directly beneath it.
        order: 1,
        label: () => `AI Accounts: ${translate('aiAccountsAccountsView')}`,
        locale: AI_ACCOUNTS_LOCALE_NAMESPACE,
      },
      PanelGlyph,
    )
    api.ui.register({ name: 'main', key: PANEL_ID, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, AccountsPanelView)
    // Usage history and Quota forecast are views of Observe › Usage › Quota while @dshfiles/usage runs. Without it
    // (compositions that leave usage out) they keep their own navigation entries, so nothing becomes unreachable.
    const historyLabel = (): string => translate('aiAccountsUsageHistory')
    const forecastLabel = (): string => translate('aiAccountsQuotaForecast')
    api.keyed(
      usageNavigation,
      (live, scope) => {
        if (live.status === 'active') return
        const slots = ctx.slots
        const entries = [
          { id: USAGE_PANEL_ID, order: 2, label: () => `AI Accounts: ${historyLabel()}`, glyph: UsageHistoryGlyph },
          { id: FORECAST_PANEL_ID, order: 3, label: () => `AI Accounts: ${forecastLabel()}`, glyph: QuotaForecastGlyph },
        ]
        for (const entry of entries) {
          const dispose = slots.inject('sidebar.panellist', () =>
            slots.register(
              { name: 'sidebar.panellist', id: entry.id, order: entry.order, label: entry.label, locale: AI_ACCOUNTS_LOCALE_NAMESPACE },
              entry.glyph,
            ),
          )
          if (typeof dispose === 'function') scope.onDispose(() => void dispose())
        }
      },
      { equals: (left, right) => (left.status === 'active') === (right.status === 'active') },
    )
    api.ui.register({ name: 'main', key: USAGE_PANEL_ID, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, UsageHistoryPanelView)
    api.ui.register({ name: 'main', key: FORECAST_PANEL_ID, locale: AI_ACCOUNTS_LOCALE_NAMESPACE }, QuotaForecastPanelView)
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

const QuotaForecastGlyph = (props: { readonly size?: number; readonly active?: boolean }): JSX.Element => (
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
    <rect x="3" y="5" width="18" height="4" rx="1" />
    <rect x="3" y="15" width="18" height="4" rx="1" />
    <path d="M14 5v4M9 15v4" />
  </svg>
)
