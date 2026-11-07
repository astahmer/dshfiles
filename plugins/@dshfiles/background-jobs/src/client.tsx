import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient, useRegistry } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { ToolCallSections, type ToolCallSectionProps } from '@dshfiles/tool-meta/tool-call-sections'
import type { JobsClient } from './job-preview-model.js'
import { JobPreviewSection } from './job-preview.js'
import { Processes } from './processes-page.js'
import { ThreadJobsFacet } from './thread-jobs-facet.js'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { PROCESSES_JOBS_TAB, ProcessesNavigation, ProcessViews } from './process-views.js'
import { BACKGROUND_JOBS_LOCALE_NAMESPACE, backgroundJobsLocale } from './locales.js'

const PANEL_ID = 'dshfiles-background-jobs'
/** The thread panel's Jobs facet (plans/ade-ux §4.4): a page tab type of the right pane. */
const JOBS_FACET_ID = 'dshfiles-background-jobs-thread'

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
  inject: ['slots', 'sessions', 'uiWorkspace', 'layout', 'sidebarRightTabs', 'jobs'],
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
      // SAFETY: in the browser `ctx.jobs` is the job-controller's client service; the Host registry's declaration of the
      // same Context key is the one this program sees (job-preview-model.ts says why).
      const jobs = ctx.jobs as unknown as JobsClient
      const JobPreview = (props: ToolCallSectionProps): JSX.Element => (
        <PluginQueryProvider>
          <JobPreviewSection
            {...props}
            jobs={jobs}
            t={translate}
            useThreadLabel={() => EntityLabels.useSessionLabel(ctx.sessions)}
            // SAFETY: a job's owner is a Host-issued Session id.
            openThread={sessionId => ctx.uiWorkspace.openSession(sessionId as SessionId)}
            openProcesses={() => openProcesses()}
          />
        </PluginQueryProvider>
      )
      plugin.add(ToolCallSections, { id: '@dshfiles/background-jobs/job-preview', Section: plugin.bind(JobPreview) })
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
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: JOBS_FACET_ID,
          kind: JOBS_FACET_ID,
          title: () => translate('tabJobs'),
          guide: [{ id: 'thread-jobs', order: 60, title: () => translate('tabJobs'), description: () => translate('jobsFacetGuide'), icon: PanelGlyph }],
        }),
      'background-jobs: thread Jobs facet type',
    )
    const JobsFacet = (props: PropsRuntime<'sidebar.right.pane.tab'>): JSX.Element => {
      const sessionLabel = EntityLabels.useSessionLabel(ctx.sessions)
      return <ThreadJobsFacet sessionId={props.sessionId} t={translate} sessionLabel={sessionLabel} onOpenProcesses={() => openProcesses()} />
    }
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: JOBS_FACET_ID, locale: BACKGROUND_JOBS_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <JobsFacet {...props} />
          </PluginQueryProvider>
        )),
      ),
    )
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
