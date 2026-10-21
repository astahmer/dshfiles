import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@dshfiles/input-trigger/client'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'

import { AgentMentions } from './agent-mentions.js'
import { AgentsPanel, type AgentsPanelProps } from './agents-panel.js'
import { agentsApi } from './api.js'
import { AgentDispatch, type AgentDispatchRequest, type AgentModelSelection, type AgentThreadCreation } from './dispatch.js'

const PANEL_ID = 'dshfiles-agents'

/** Thread ids cross the Host boundary as plain JSON strings; the workspace API brands them. */
// SAFETY: the value is a Session id the agents API returned for a thread this Host created, and uiWorkspace
// re-resolves it against its own reference before navigating; an unknown id fails the same way a stale one does.
const asSessionId = (sessionId: string): SessionId => sessionId as SessionId

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A thread an agent just started, retained while its opening message is admitted. */
    agentDispatch: unknown
  }
}

export default defineClient({
  name: '@dshfiles/agents',
  inject: ['slots', 'sessions', 'remote', 'remote.session', 'uiWorkspace', 'workspaces', 'inputTriggers'],
  setup(ctx, decorate) {
    const api = createApiClient(ctx, agentsApi)

    const startThread = async (request: AgentDispatchRequest): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> => {
      const target = AgentDispatch.creationArgs(request.target, ctx.workspaces.list.getSnapshot().items[0]?.workspaceId)
      const creation: AgentThreadCreation = request.agent.preset === null ? { ...target } : { ...target, agentPreset: request.agent.preset }
      let sessionId
      try {
        sessionId = await ctx.sessions.create(creation)
      } catch (cause) {
        return { ok: false, reason: `The thread could not be created: ${cause instanceof Error ? cause.message : String(cause)}` }
      }
      const route = request.agent.route
      if (route !== null) {
        const selection: AgentModelSelection =
          route.reasoningEffort === undefined
            ? { sessionId, provider: route.provider, model: route.model }
            : { sessionId, provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort }
        const selected = await ctx.remote.session.selectModel(selection)
        if (!selected.ok) console.warn(`agents: thread ${sessionId} kept the Host default model: ${selected.error.message}`)
      }
      const title = AgentDispatch.title(request)
      const renamed = await ctx.remote.session.rename({ sessionId, title })
      if (!renamed.ok) console.warn(`agents: thread ${sessionId} title kept as created: ${renamed.error.message}`)
      const reference = ctx.sessions.retain(sessionId, { source: 'agentDispatch' })
      try {
        await reference.ready
        const session = reference.binding.session
        const text = AgentDispatch.openingMessage(request)
        const handle = session.beginSubmission({ mode: 'queue', text, attachments: [] })
        const prompted = await session.prompt([{ type: 'text', text }], 'queue', undefined, handle.requestId)
        if (!prompted.ok) console.warn(`agents: thread ${sessionId} started without its opening message: ${prompted.error.message}`)
      } catch (cause) {
        console.warn(`agents: thread ${sessionId} started without its opening message: ${String(cause)}`)
      } finally {
        reference.release()
      }
      await api.safe.recordUse({ handle: request.agent.handle, thread: { sessionId: String(sessionId), title } })
      ctx.uiWorkspace.openSession(sessionId)
      return { ok: true }
    }

    const mentions = AgentMentions.createSource({
      section: 'Agents',
      list: async () => (await api.list()).agents,
    })
    ctx.effect(() => ctx.inputTriggers.registerSource(mentions), 'dshfiles-agents: @ mentions')

    const panelProps: AgentsPanelProps = {
      // A dispatch target is a project: the jj workspaces cut from one are where threads run, not places to start in.
      listProjects: () =>
        EntityLabels.projectsOf(ctx.workspaces.list.getSnapshot().items).map(workspace => ({
          id: workspace.workspaceId,
          title: workspace.title,
          path: workspace.path,
        })),
      loadCatalog: async () => {
        const result = await ctx.remote.session.modelCatalog()
        if (!result.ok) throw new Error(result.error.message)
        return AgentDispatch.catalog(result.value)
      },
      loadPresets: async () => (await api.presets()).presets,
      loadThreads: async handle => (await api.threads({ handle })).threads,
      openThread: sessionId => ctx.uiWorkspace.openSession(asSessionId(sessionId)),
      startThread,
    }

    const PanelView = (): JSX.Element => (
      <PluginQueryProvider>
        <AgentsPanel {...panelProps} />
      </PluginQueryProvider>
    )

    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: 'Agents' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, decorate(PanelView)))
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
    strokeWidth="1.6"
    strokeLinecap="round"
  >
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19c0-2.8 2.5-5 5.5-5s5.5 2.2 5.5 5" />
    <circle cx="17" cy="9.5" r="2.2" />
    <path d="M15.5 14.6c2.6-.4 5 1.5 5 4.4" />
  </svg>
)
