import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { agentsApi } from '@dshfiles/agents/contract'
import type {} from '@dshfiles/input-trigger/client'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'

import { AgentDispatchProvider } from './agent-dispatch-context.js'
import { AgentComments, type AgentDispatchPort } from './agent-dispatch.js'
import { backlogApi, BacklogViews } from './api.js'
import { BacklogMentions } from './backlog-mentions.js'
import { BacklogPanel, type StartThreadPorts } from './backlog-panel.js'
import {
  defaultTargetFor,
  StartThreadForm,
  type StartThreadCatalog,
  type StartThreadCreation,
  type StartThreadRequest,
  type StartThreadTarget,
} from './start-thread.js'

const PANEL_ID = 'dshfiles-backlog-panel'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A thread the backlog just started for one item, retained while its first message is admitted. */
    backlogStartThread: unknown
  }
}

export default defineClient({
  name: '@dshfiles/backlog',
  inject: ['slots', 'sessions', 'workspaces', 'remote', 'remote.session', 'uiWorkspace', 'conversation', 'inputTriggers'],
  setup(ctx, decorate) {
    const api = createApiClient(ctx, backlogApi)
    const agents = createApiClient(ctx, agentsApi)
    const startThreadPorts: StartThreadPorts = {
      listProjects: () =>
        ctx.workspaces.list.getSnapshot().items.map(workspace => ({ id: workspace.workspaceId, title: workspace.title, path: workspace.path })),
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
      start: async (request: StartThreadRequest) => {
        const base = creationArgsFor(request.target, ctx.workspaces.list.getSnapshot().items[0]?.workspaceId)
        const creation: StartThreadCreation = request.agent?.preset == null ? { ...base } : { ...base, agentPreset: request.agent.preset }
        let sessionId
        try {
          sessionId = await ctx.sessions.create(creation)
        } catch (cause) {
          return { ok: false, reason: `The thread could not be created: ${cause instanceof Error ? cause.message : String(cause)}` }
        }
        const route = request.agent?.route ?? null
        const selection =
          route === null
            ? request.provider === null || request.model === null
              ? null
              : { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort }
            : { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort ?? request.reasoningEffort }
        if (selection !== null) {
          const selected = await ctx.remote.session.selectModel(
            selection.reasoningEffort === undefined
              ? { sessionId, provider: selection.provider, model: selection.model }
              : { sessionId, provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort },
          )
          if (!selected.ok) console.warn(`backlog: thread ${sessionId} kept the Host default model: ${selected.error.message}`)
        }
        const renamed = await ctx.remote.session.rename({ sessionId, title: StartThreadForm.title(request.item) })
        if (!renamed.ok) console.warn(`backlog: thread ${sessionId} title kept as created: ${renamed.error.message}`)
        if (request.message !== '') {
          const reference = ctx.sessions.retain(sessionId, { source: 'backlogStartThread' })
          try {
            await reference.ready
            if (request.send) {
              const session = reference.binding.session
              const handle = session.beginSubmission({ mode: 'queue', text: request.message, attachments: [] })
              const prompted = await session.prompt([{ type: 'text', text: request.message }], 'queue', undefined, handle.requestId)
              if (!prompted.ok) console.warn(`backlog: thread ${sessionId} started without its first message: ${prompted.error.message}`)
            } else {
              ctx.conversation.input.requestDraftInitialization(reference.binding, { prompt: request.message, clearPreviousDraft: true })
            }
          } catch (cause) {
            console.warn(`backlog: thread ${sessionId} started without its first message: ${String(cause)}`)
          } finally {
            reference.release()
          }
        }
        const linked = await api.safe.link({ id: request.item.id, link: { type: 'thread', target: sessionId, provenance: 'user' } })
        if (!linked.ok) console.warn(`backlog: item b:${String(request.item.id)} was not linked to thread ${sessionId}: ${linked.error.message}`)
        ctx.uiWorkspace.openSession(sessionId)
        return { ok: true }
      },
    }
    /**
     * A leading `@handle` in an item comment starts that agent's thread for the item. An unknown or disabled handle,
     * or an agents bundle that is not installed, leaves the comment exactly as it was.
     */
    const dispatchPort: AgentDispatchPort = {
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
        const started = await startThreadPorts.start(AgentComments.request({ item, agent, task: mention.task, target: defaultTargetFor(item, projects) }))
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
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 3, label: 'Backlog' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, decorate(PanelView)))
  },
})

/**
 * A thread with no project joins the first registered workspace, the way the composer's New thread does; a bare path
 * runs in that folder, and a Host with no workspace at all leaves the choice to the composer.
 */
const creationArgsFor = (target: StartThreadTarget, defaultWorkspaceId: WorkspaceId | undefined) => {
  if (target.kind === 'project') return { workspaceId: target.projectId }
  if (target.kind === 'cwd') return { cwd: target.path }
  return defaultWorkspaceId === undefined ? {} : { workspaceId: defaultWorkspaceId }
}

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
