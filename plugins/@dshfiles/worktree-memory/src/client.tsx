import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { ProcessesNavigation, ProcessViews, type ProcessThreadViewProps } from '@dshfiles/background-jobs/process-views'
import { defineClient, useContract } from '@dshfiles/dshx/client'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useEffect, type ReactNode } from 'react'
import { WORKTREE_MEMORY_LOCALE_NAMESPACE, worktreeMemoryLocale } from './locales.js'
import { OrphanStatusItem } from './orphan-status-item.js'
import { MemoryBadge, MemoryGlyph, WorktreeMemoryPanel, type WorktreeMemoryPanelProps } from './panel.js'

const PANEL_ID = 'dshfiles-worktree-memory'
const RAM_TAB = 'ram'

/**
 * RAM is a tab of Observe › Processes (docs/ade-ux §6), owned by @dshfiles/background-jobs: this plugin adds the tab and
 * its part of the thread panel's Jobs facet, and no navigation entry of its own. The former page stays a main panel so
 * saved tabs keep working: it redirects to the tab while background-jobs runs, and is the full page without it.
 */
export default defineClient({
  name: '@dshfiles/worktree-memory',
  locales: [worktreeMemoryLocale],
  inject: ['layout', 'slots', 'sessions', 'uiWorkspace'],
  setup(ctx, decorate, metadata) {
    const translate = ctx.locale.bind(WORKTREE_MEMORY_LOCALE_NAMESPACE)
    const View = (props: Omit<WorktreeMemoryPanelProps, 'sessions' | 'uiWorkspace' | 't'>): JSX.Element => (
      <PluginQueryProvider>
        <TooltipProvider delayDuration={300}>
          <WorktreeMemoryPanel sessions={ctx.sessions} uiWorkspace={ctx.uiWorkspace} t={translate} {...props} />
        </TooltipProvider>
      </PluginQueryProvider>
    )
    const plugin = metadata?.plugin
    if (plugin !== undefined) {
      const RamTab = (): JSX.Element => <View mode="embedded" />
      const RamForThread = (props: ProcessThreadViewProps): JSX.Element => <View mode="thread" sessionId={props.sessionId} />
      const RamBadge = (): JSX.Element | null => (
        <PluginQueryProvider>
          <MemoryBadge t={translate} />
        </PluginQueryProvider>
      )
      plugin.add(ProcessViews, {
        id: RAM_TAB,
        label: translate('title'),
        order: 20,
        Page: plugin.bind(RamTab),
        Thread: plugin.bind(RamForThread),
        Badge: plugin.bind(RamBadge),
      })
      const processesNavigation = plugin.use(ProcessesNavigation)
      ctx.effect(
        () =>
          OrphanStatusItem.register({
            plugin,
            t: translate,
            open: () => {
              const navigation = processesNavigation.get()
              if (navigation.status === 'active') {
                navigation.value.open(RAM_TAB)
                return
              }
              // SAFETY: PANEL_ID is registered as a main-panel slot below.
              ctx.layout.selectPanel(PANEL_ID as MainPanelId)
            },
          }),
        'worktree-memory: orphan status item',
      )
      // Without background-jobs (compositions that leave it out) the RAM page keeps its own entry and glyph.
      plugin.keyed(
        processesNavigation,
        (live, scope) => {
          if (live.status === 'active') return
          const dispose = ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 7,
                label: () => `Worktree Memory: ${translate('title')}`,
                locale: WORKTREE_MEMORY_LOCALE_NAMESPACE,
              },
              decorate(props => (
                <PluginQueryProvider>
                  <MemoryGlyph size={props.size} t={props.t} />
                </PluginQueryProvider>
              )),
            ),
          )
          if (typeof dispose === 'function') scope.onDispose(() => void dispose())
        },
        { equals: (left, right) => (left.status === 'active') === (right.status === 'active') },
      )
    }
    const Redirect = (props: { readonly children: ReactNode }): ReactNode => {
      const navigation = useContract(ProcessesNavigation)
      const active = navigation.status === 'active'
      useEffect(() => {
        if (navigation.status === 'active') navigation.value.open(RAM_TAB)
      }, [navigation])
      return active ? null : props.children
    }
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: WORKTREE_MEMORY_LOCALE_NAMESPACE },
        decorate(() => (
          <Redirect>
            <View mode="page" />
          </Redirect>
        )),
      ),
    )
  },
})
