import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createApiClient, type PluginContext } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { AgentMentionTones, type AgentMentionToneSource } from '@dshfiles/rich-composer/agent-mention-tones'
import { ComposerSendPreparers } from '@dshfiles/rich-composer/composer-send'
import type { SessionDrafts } from '@dshfiles/session-controller/draft-client'
import { useSyncExternalStore, type ReactNode } from 'react'
import { agentsApi } from './api.js'
import { ComposerAgent } from './composer-agent.js'
import { ComposerAgentChip } from './composer-agent-chip.js'
import { ComposerAgentChoices } from './composer-agent-choices.js'
import { createComposerAgentPreparer, type ComposerAgentPorts } from './composer-agent-preparer.js'
import { ThreadToolsControl } from './thread-tools-control.js'

const COMPOSER_ENTRY_ID = 'dshfiles-agents-composer'
const EMPTY_DRAFTS: Readonly<Record<string, never>> = {}
const noSubscription = (): (() => void) => () => {}

/**
 * The Host and draft steps of a new thread's first send. The preset Remote is read with `ctx.get`: the client entry does
 * not inject `remote.agentPresets` (it is optional), and Cordis refuses `ctx.remote.agentPresets` without that inject.
 */
export const createComposerAgentPorts = (ctx: Context): ComposerAgentPorts => {
  const api = createApiClient(ctx, agentsApi)
  const drafts = (): SessionDrafts | undefined => ctx.get('sessionDrafts')
  const workspaceRows = () =>
    ctx.workspaces.list.getSnapshot().items.map(item => ({ workspaceId: String(item.workspaceId), path: item.path, sessionIds: item.sessionIds.map(String) }))
  const loadAgents = async (signal: AbortSignal) => (await api.list(undefined, { signal })).agents
  const loadProjectDefaults = async (signal: AbortSignal) => (await api.projectDefaults(undefined, { signal })).projects

  return {
    listAgents: loadAgents,
    hostAgentOf: async (sessionId, signal) => {
      const [defaults, view] = await Promise.all([loadProjectDefaults(signal), api.threadAccess({ sessionId }, { signal }).catch(() => null)])
      // The Host's attribution of the created thread first; the draft's workspace while the Host has none.
      const projectId =
        view?.agent.projectId ??
        ComposerAgent.projectOf({
          workspaces: workspaceRows(),
          sessionId,
          draftWorkspaceId: drafts()?.list.getSnapshot()[sessionId]?.workspaceId,
          cwd: undefined,
        })
      return {
        projectDefault: ComposerAgent.projectDefaultOf(defaults, projectId ?? undefined),
        decided: view?.recorded === true ? view.agent.handle : null,
      }
    },
    choiceOf: ComposerAgentChoices.get,
    clearChoice: sessionId => ComposerAgentChoices.set(sessionId, null),
    modelPicked: sessionId => drafts()?.list.getSnapshot()[sessionId]?.model !== undefined,
    applyPreset: async (sessionId, preset) => {
      // SAFETY: the composer passes the Host Session id it is about to prompt.
      const id = sessionId as SessionId
      const local = drafts()
      if (local?.list.getSnapshot()[sessionId]?.local === true && local.stagePreset(id, preset)) return null
      const presets = ctx.get('remote.agentPresets')
      if (presets === undefined) return 'this Host composes no Agent preset roster'
      const result = await presets.select(id, preset)
      return result.ok ? null : result.error.message
    },
    applyModel: async selection => {
      const local = drafts()
      const { sessionId, ...model } = selection
      if (local?.list.getSnapshot()[sessionId]?.local === true && local.stageModel(sessionId, model)) return null
      const result = await ctx.remote.session.selectModel(selection)
      return result.ok ? null : result.error.message
    },
    recordAgent: async (sessionId, handle) => {
      await api.recordThreadAgent({ sessionId, handle })
    },
    rename: async (sessionId, title) => {
      // SAFETY: the composer passes the Host Session id it is about to prompt.
      const result = await ctx.remote.session.rename({ sessionId: sessionId as SessionId, title })
      return result.ok ? null : result.error.message
    },
  }
}

/** rich-composer's mention colours from the registry: each agent's chosen slot; null when the list did not load. */
export const createAgentMentionToneSource = (
  list: () => Promise<readonly { readonly handle: string; readonly tone?: number | undefined }[] | null>,
): AgentMentionToneSource => ({
  id: '@dshfiles/agents.tones',
  load: async () => {
    const agents = await list()
    return agents === null ? null : new Map(agents.flatMap(agent => (agent.tone === undefined ? [] : [[agent.handle, agent.tone] as const])))
  },
})

/**
 * The composer side of agents: the agent chip of a new thread, the Tools control of a running one (both in the
 * composer's left tool row) and the first-send step that starts a new thread as its agent (rich-composer's
 * `composer-send` registry). `sessionDrafts` (the owned session controller) and the preset Remote are optional: without
 * them a new thread still gets its instructions and recorded agent, and the Host applies the rest it can.
 */
export const registerComposerAgent = (input: {
  readonly ctx: Context
  readonly decorate: <Component>(component: Component) => Component
  readonly plugin: PluginContext | undefined
}): void => {
  const { ctx } = input
  const api = createApiClient(ctx, agentsApi)
  const drafts = (): SessionDrafts | undefined => ctx.get('sessionDrafts')
  const loadAgents = async (signal: AbortSignal) => (await api.list(undefined, { signal })).agents
  const loadProjectDefaults = async (signal: AbortSignal) => (await api.projectDefaults(undefined, { signal })).projects
  input.plugin?.add(ComposerSendPreparers, createComposerAgentPreparer(createComposerAgentPorts(ctx)))
  // A mention in the draft wears the colour the agent chose; agents without one keep their hashed slot.
  input.plugin?.add(
    AgentMentionTones,
    createAgentMentionToneSource(async () => {
      const listed = await api.safe.list()
      return listed.ok ? listed.value.agents : null
    }),
  )

  const Entry = (props: PropsRuntime<'conversation.input.left'>): ReactNode => {
    const sessionId = String(props.sessionId)
    const summary = props.useSessions(state => state.byId[props.sessionId])
    const draftList = drafts()?.list
    const draft = useSyncExternalStore(draftList?.subscribe.bind(draftList) ?? noSubscription, () => draftList?.getSnapshot() ?? EMPTY_DRAFTS)[sessionId]
    const workspaces = useSyncExternalStore(ctx.workspaces.list.subscribe.bind(ctx.workspaces.list), () => ctx.workspaces.list.getSnapshot())
    if (summary === undefined && draft === undefined) return null
    if (summary?.blank !== false) {
      const projectId = ComposerAgent.projectOf({
        workspaces: workspaces.items.map(item => ({ workspaceId: String(item.workspaceId), path: item.path, sessionIds: item.sessionIds.map(String) })),
        sessionId,
        draftWorkspaceId: draft?.workspaceId,
        cwd: summary?.cwd,
      })
      return (
        <PluginQueryProvider>
          <ComposerAgentChip
            sessionId={sessionId}
            projectId={projectId}
            loadAgents={loadAgents}
            loadProjectDefaults={loadProjectDefaults}
            setProjectDefault={(id, handle) => api.setProjectDefault({ projectId: id, handle })}
          />
        </PluginQueryProvider>
      )
    }
    return (
      <PluginQueryProvider>
        <ThreadToolsControl
          sessionId={sessionId}
          loadAgents={loadAgents}
          loadAccess={(id, signal) => api.threadAccess({ sessionId: id }, { signal })}
          setOverride={(id, override) => api.setThreadOverride({ sessionId: id, override })}
        />
      </PluginQueryProvider>
    )
  }
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register({ name: 'conversation.input.left', id: COMPOSER_ENTRY_ID, order: 5 }, input.decorate(Entry)),
  )
}
