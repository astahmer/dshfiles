import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { agentsApi } from '@dshfiles/agents/contract'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import type {} from '@dshfiles/input-trigger/client'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'

import { AgentDispatchProvider } from './agent-dispatch-context.js'
import { AgentComments, type AgentDispatchPort } from './agent-dispatch.js'
import { backlogApi, BacklogViews } from './api.js'
import { BacklogFocusModel } from './backlog-focus.js'
import { BacklogMentions } from './backlog-mentions.js'
import { BacklogPanel, type StartThreadPorts } from './backlog-panel.js'
import { installBacklogReferenceLinks } from './backlog-reference-links.js'
import { BacklogReferenceOverlay } from './backlog-reference-overlay.jsx'
import { BacklogNotices, BacklogNoticeToast } from './notices.js'
import { defaultTargetFor, StartThreadForm, type StartThreadCatalog, type StartThreadOutcome, type StartThreadRequest } from './start-thread.js'
import './client.css'

const PANEL_ID = 'dshfiles-backlog-panel'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A thread the backlog just started for one item, retained while its first message is admitted. */
    backlogStartThread: unknown
  }
}

export default defineClient({
  name: '@dshfiles/backlog',
  inject: ['slots', 'layout', 'sessions', 'workspaces', 'remote', 'remote.session', 'uiWorkspace', 'conversation', 'inputTriggers'],
  setup(ctx, decorate) {
    ctx.effect(() => installBacklogReferenceLinks(), 'backlog reference links')
    const api = createApiClient(ctx, backlogApi)
    const agents = createApiClient(ctx, agentsApi)
    const startThreadPorts: StartThreadPorts = {
      // The chooser sets an item's project: a registered jj workspace is work in progress, not a project to file into.
      listProjects: () =>
        EntityLabels.projectsOf(ctx.workspaces.list.getSnapshot().items).map(workspace => ({
          id: workspace.workspaceId,
          title: workspace.title,
          path: workspace.path,
        })),
      loadCatalog: async (): Promise<StartThreadCatalog> => {
        const result = await ctx.remote.session.modelCatalog()
        if (!result.ok) throw new Error(result.error.message)
        return StartThreadForm.catalog(result.value)
      },
      listAgents: async () => {
        try {
          const snapshot = await agents.list()
          return snapshot.agents.filter(agent => agent.enabled).map(agent => ({ ...AgentComments.agent(agent), description: agent.description }))
        } catch {
          return []
        }
      },
      start: async (request: StartThreadRequest): Promise<StartThreadOutcome> => {
        /** Nothing was created; the dialog is already gone, so the reason travels as a report. */
        const failed = (reason: string): StartThreadOutcome => {
          BacklogNotices.show({ text: reason, kind: 'failure', sessionId: null })
          return { ok: false, reason }
        }
        // A jj workspace and a Session take a moment; the banner says the work is under way until a report replaces it.
        BacklogNotices.show({ text: StartThreadForm.starting(request.items), kind: 'progress', sessionId: null })
        const start: Parameters<typeof api.safe.startThread>[0] = { ids: request.items.map(item => item.id), send: request.send }
        if (request.target.kind === 'project') start.workspaceId = request.target.projectId
        else if (request.target.kind === 'cwd') start.cwd = request.target.path
        if (request.agent !== undefined) start.agent = request.agent.handle
        if (request.provider !== null) start.provider = request.provider
        if (request.model !== null) start.model = request.model
        if (request.reasoningEffort !== undefined) start.reasoningEffort = request.reasoningEffort
        if (request.message !== '') start.message = request.message
        const started = await api.safe.startThread(start)
        if (!started.ok) return failed(started.error.message)
        // SAFETY: the Host answers the Session it just created; the brand is type-only on the wire.
        const sessionId = started.value.sessionId as SessionId
        if (!request.send && request.message !== '') {
          // A draft belongs to the composer that owns it, so the panel leaves it after the Host created the thread.
          const reference = ctx.sessions.retain(sessionId, { source: 'backlogStartThread' })
          try {
            await reference.ready
            ctx.conversation.input.requestDraftInitialization(reference.binding, { prompt: request.message, clearPreviousDraft: true })
          } catch (cause) {
            console.warn(`backlog: thread ${sessionId} started without its draft: ${String(cause)}`)
          } finally {
            reference.release()
          }
        }
        if (request.open) {
          try {
            ctx.uiWorkspace.openSession(sessionId)
          } catch (cause) {
            console.warn(`backlog: thread ${sessionId} could not be opened: ${String(cause)}`)
          }
        }
        // Opening it is already done when asked, so the report only carries the thread when it is still the user's to do.
        BacklogNotices.show({ text: StartThreadForm.started(request.items), kind: 'success', sessionId: request.open ? null : sessionId })
        return { ok: true, sessionId }
      },
    }
    /**
     * A leading `@handle` in an item comment starts that agent's thread for the item. An unknown or disabled handle,
     * or an agents bundle that is not installed, leaves the comment exactly as it was.
     */
    const dispatchPort: AgentDispatchPort = {
      choices: async () => {
        try {
          const snapshot = await agents.list()
          return snapshot.agents.filter(agent => agent.enabled).map(AgentComments.choice)
        } catch {
          return []
        }
      },
      dispatch: async ({ item, text }) => {
        const mention = AgentComments.mention(text)
        if (mention === null) return { kind: 'skipped', reason: 'no-mention' }
        let agent
        try {
          const found = await agents.get({ handle: mention.handle })
          agent = found.agent
        } catch {
          return { kind: 'skipped', reason: 'agents-unavailable' }
        }
        if (agent === null) return { kind: 'skipped', reason: 'unknown-agent' }
        if (!agent.enabled) return { kind: 'skipped', reason: 'disabled-agent' }
        const projects = startThreadPorts.listProjects()
        const items = [item]
        const started = await startThreadPorts.start(AgentComments.request({ items, agent, task: mention.task, target: defaultTargetFor(items, projects) }))
        if (!started.ok) return { kind: 'failed', reason: started.reason }
        await api.safe.comment({ id: item.id, text })
        return { kind: 'dispatched' }
      },
    }
    const mentions = BacklogMentions.createSource({
      section: 'Backlog',
      search: async (query, limit, signal) => BacklogViews.list(await api.list({ query, freshness: 'active', limit }, { signal })).items,
    })
    ctx.effect(() => ctx.inputTriggers.registerSource(mentions), 'backlog: @ mentions')
    const PanelView = (): JSX.Element => (
      <PluginQueryProvider>
        <AgentDispatchProvider port={dispatchPort}>
          <BacklogPanel
            startThread={startThreadPorts}
            listThreads={() => {
              const state = ctx.sessions.list.getSnapshot()
              return state.ids.flatMap(id => {
                const session = state.byId[id]
                if (session === undefined || session.blank || session.parentId !== undefined) return []
                const thread = { id: session.id, title: session.displayTitle, running: session.running }
                return [session.cwd === undefined ? thread : { ...thread, cwd: session.cwd }]
              })
            }}
            openThread={sessionId => {
              const session = Object.values(ctx.sessions.list.getSnapshot().byId).find(candidate => candidate?.id === sessionId)
              if (session !== undefined) ctx.uiWorkspace.openSession(session.id)
            }}
          />
        </AgentDispatchProvider>
      </PluginQueryProvider>
    )
    const ReferenceOverlay = (): JSX.Element => (
      <PluginQueryProvider>
        <BacklogReferenceOverlay
          openInBacklog={id => {
            BacklogFocusModel.request(id)
            // SAFETY: this entry registers PANEL_ID as a main-slot key just below, so it is a live panel id.
            ctx.layout.selectPanel(PANEL_ID as MainPanelId)
          }}
        />
        <BacklogNoticeToast openThread={sessionId => ctx.uiWorkspace.openSession(sessionId)} />
      </PluginQueryProvider>
    )
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 3, label: 'Backlog' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, decorate(PanelView)))
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'dshfiles-backlog-reference-preview', order: 121 }, decorate(ReferenceOverlay)),
    )
  },
})

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <rect x="3.5" y="4" width="5" height="16" rx="1.5" />
    <rect x="10" y="4" width="5" height="10" rx="1.5" />
    <rect x="16.5" y="4" width="4" height="6" rx="1.5" />
  </svg>
)
