import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { DestinationSections } from '@dshfiles/thread-sidebar/destinations'
import { AutomationsPanel } from './automations-panel.js'

const PANEL_ID = 'project-automations'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9v4l2.5 2.5M9 3h6" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/project-automations',
  inject: ['slots', 'workspaces', 'uiWorkspace'],
  setup(ctx, decorate, metadata) {
    // The sidebar rail lists this page under Work, beside Backlog and Schedules; without the rail it stays a plain link.
    metadata?.plugin?.add(DestinationSections, {
      panelId: PANEL_ID,
      destination: 'work',
      label: 'Automations',
      description: 'Schedules and webhooks that start threads in a project.',
      order: 3,
      formerLabels: ['Automations'],
    })
    const projects = () =>
      EntityLabels.projectsOf(ctx.workspaces.list.getSnapshot().items).map(workspace => ({
        projectId: workspace.workspaceId,
        title: workspace.title,
        path: workspace.path,
      }))
    // SAFETY: every id passed here is a sessionId the Host returned from sessions.create for a run.
    const openThread = (sessionId: string) => ctx.uiWorkspace.openSession(sessionId as SessionId)
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => 'Automations' }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID },
        decorate(() => (
          <PluginQueryProvider>
            <AutomationsPanel projects={projects} openThread={openThread} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
