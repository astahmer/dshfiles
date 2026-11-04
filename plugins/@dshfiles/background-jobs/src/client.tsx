import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient, useRegistry } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { Processes } from './processes-page.js'
import { PROCESSES_JOBS_TAB, ProcessesNavigation, ProcessViews } from './process-views.js'
import { BACKGROUND_JOBS_LOCALE_NAMESPACE, backgroundJobsLocale } from './locales.js'

const PANEL_ID = 'dshfiles-background-jobs'

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
    strokeLinejoin="round"
  >
    <path d="M4 6h16M4 12h16M4 18h10" />
    <circle cx="19" cy="18" r="1.4" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/background-jobs',
  locales: [backgroundJobsLocale],
  inject: ['slots', 'sessions', 'uiWorkspace', 'layout'],
  setup(ctx, decorate, metadata) {
    const translate = ctx.locale.bind(BACKGROUND_JOBS_LOCALE_NAMESPACE)
    // The Processes glyph carries the marks its tabs contribute (RAM pressure and detached memory).
    const ProcessesGlyph = (props: { readonly size?: number | undefined }): JSX.Element => {
      const badges = useRegistry(ProcessViews).flatMap(view => (view.Badge === undefined ? [] : [{ id: view.id, Badge: view.Badge }]))
      return (
        <span className="dshx:relative dshx:inline-flex">
          <PanelGlyph size={props.size} />
          {badges.map(entry => (
            <entry.Badge key={entry.id} />
          ))}
        </span>
      )
    }
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => `Background Jobs: ${translate('title')}`, locale: BACKGROUND_JOBS_LOCALE_NAMESPACE },
        decorate(ProcessesGlyph),
      ),
    )
    // Observe › Processes (plans/ade-ux §6): this page is Jobs, Dev servers and RAM; the former RAM page and saved tabs
    // land on its tabs through this contract.
    const openProcesses = (tab: string = PROCESSES_JOBS_TAB): void => {
      Processes.select(tab)
      // SAFETY: PANEL_ID is registered as a main-panel slot below.
      ctx.layout.selectPanel(PANEL_ID as MainPanelId)
    }
    const plugin = metadata?.plugin
    if (plugin !== undefined) {
      plugin.provide(ProcessesNavigation, { open: openProcesses })
      const rows = [
        { id: 'processes', label: 'Observe › Processes', aliases: ['Processes', 'Jobs', 'Background jobs'], tab: PROCESSES_JOBS_TAB },
        { id: 'processes-dev-servers', label: 'Observe › Processes › Dev servers', aliases: ['Dev servers', 'Preview servers', 'Ports'], tab: 'dev-servers' },
        { id: 'processes-ram', label: 'Observe › Processes › RAM', aliases: ['RAM', 'Process memory'], tab: 'ram' },
      ] as const
      for (const row of rows)
        plugin.add(PaletteActions, {
          id: `@dshfiles/background-jobs/${row.id}`,
          group: 'destination',
          label: row.label,
          aliases: row.aliases,
          run: () => openProcesses(row.tab),
        })
    }
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: BACKGROUND_JOBS_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <Processes.Page sessions={ctx.sessions} uiWorkspace={ctx.uiWorkspace} t={props.t} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
