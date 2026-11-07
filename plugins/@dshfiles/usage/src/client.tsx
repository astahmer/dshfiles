import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { AccountUsageView, type AccountUsageViewProps } from '@dshfiles/ai-accounts/account-usage-view'
import { UsageNavigation, type UsageQuotaTarget } from '@dshfiles/ai-accounts/quota-views'
import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { AccountUsageDashboard } from './account-usage-dashboard.js'
import type { OpenThread } from './format.js'
import { UsagePanel, UsageTabs } from './panel.js'
import { UsageQuota } from './quota-tab.js'
import { ThreadCostFacet } from './thread-cost-facet.js'

const PANEL_ID = 'dshfiles-usage'
/** The thread panel's Cost facet (docs/ade-ux §4.4): a page tab type of the right pane. */
const COST_FACET_ID = 'dshfiles-usage-cost'
const TRACES_PANEL_ID = 'traces'

const PanelGlyph = (props: { readonly size?: number | undefined }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
  >
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/usage',
  inject: ['slots', 'sessions', 'uiWorkspace', 'layout', 'sidebarRightTabs'],
  setup(ctx, decorate, metadata) {
    const plugin = metadata?.plugin
    if (plugin !== undefined) {
      const Dashboard = (props: AccountUsageViewProps): JSX.Element => (
        <PluginQueryProvider>
          <AccountUsageDashboard {...props} />
        </PluginQueryProvider>
      )
      plugin.provide(AccountUsageView, { Dashboard: plugin.bind(Dashboard) })
      // Observe › Usage › Quota is where ai-accounts' quota views live now (docs/ade-ux §6); its old entry points and
      // saved tabs open it through this contract.
      const openQuota = (target?: UsageQuotaTarget): void => {
        UsageQuota.go(target)
        UsageTabs.show('quota')
        // SAFETY: PANEL_ID is registered as a main-panel slot below.
        ctx.layout.selectPanel(PANEL_ID as MainPanelId)
      }
      plugin.provide(UsageNavigation, { openQuota })
      // The former pages keep their names in the palette and land on their view.
      const quotaRows = [
        { id: 'quota', label: 'Observe › Usage › Quota', aliases: ['Quota', 'Account quota', 'Account usage'], target: { view: 'accounts' } },
        {
          id: 'quota-history',
          label: 'Observe › Usage › Quota history',
          aliases: ['Usage history', 'Quota history'],
          target: { view: 'history' },
        },
        {
          id: 'quota-forecast',
          label: 'Observe › Usage › Quota forecast',
          aliases: ['Quota forecast'],
          target: { view: 'forecast' },
        },
      ] as const satisfies readonly { id: string; label: string; aliases: readonly string[]; target: UsageQuotaTarget }[]
      for (const row of quotaRows)
        plugin.add(PaletteActions, {
          id: `@dshfiles/usage/${row.id}`,
          group: 'destination',
          label: row.label,
          aliases: row.aliases,
          run: () => openQuota(row.target),
        })
    }
    /**
     * Open the thread a request belongs to. A subagent's own session is not
     * always in the thread list; its parent thread is the next best place.
     */
    const openThread: OpenThread = target => {
      const sessions = Object.values(ctx.sessions.list.getSnapshot().byId)
      const own = sessions.find(session => session?.id === target.sessionId)
      const parent = target.parentSessionId === null ? undefined : sessions.find(session => session?.id === target.parentSessionId)
      const destination = own ?? parent
      if (destination === undefined) return 'missing'
      ctx.uiWorkspace.openSession(destination.id)
      return own === undefined ? 'parent' : 'opened'
    }
    const openPanel = (id: string): void => {
      // SAFETY: Only ids registered as main panels reach this (the Usage page here, Traces by @dshfiles/traces).
      if (ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)) ctx.layout.selectPanel(id as MainPanelId)
    }
    const threadTitle = (sessionId: string): string => {
      const summary = Object.values(ctx.sessions.list.getSnapshot().byId).find(entry => entry?.id === sessionId)
      return summary?.displayTitle ?? 'This thread'
    }
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: COST_FACET_ID,
          kind: COST_FACET_ID,
          title: () => 'Cost',
          guide: [
            {
              id: 'thread-cost',
              order: 61,
              title: () => 'Cost',
              description: () => "This thread's route, cost per turn and requests.",
              icon: PanelGlyph,
            },
          ],
        }),
      'usage: thread Cost facet type',
    )
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: COST_FACET_ID },
        decorate((props: PropsRuntime<'sidebar.right.pane.tab'>) => (
          <PluginQueryProvider>
            <ThreadCostFacet
              sessionId={props.sessionId}
              onShowRequests={sessionId => {
                UsageTabs.showRequestsFor({ sessionId, label: threadTitle(sessionId) })
                openPanel(PANEL_ID)
              }}
              onOpenTraces={() => openPanel(TRACES_PANEL_ID)}
              onOpenAccount={accountId => {
                UsageQuota.go({ view: 'accounts', accountId })
                UsageTabs.show('quota')
                openPanel(PANEL_ID)
              }}
            />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 4, label: 'Usage' }, PanelGlyph))
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID },
        decorate(() => (
          <PluginQueryProvider>
            <UsagePanel openThread={openThread} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
