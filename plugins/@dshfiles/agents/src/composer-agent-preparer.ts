import type { ComposerSendPreparer } from '@dshfiles/rich-composer/composer-send'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Agent } from './agent.js'
import { ComposerAgent } from './composer-agent.js'
import { AgentDispatch, type AgentModelSelection } from './dispatch.js'

/** What the first send reads and writes; the client entry binds each to the Host and the composer's draft. */
export interface ComposerAgentPorts {
  readonly listAgents: (signal: AbortSignal) => Promise<readonly Agent[]>
  /** The default agent of the project this Session belongs to, and the agent the Host already recorded for it, if any. */
  readonly hostAgentOf: (sessionId: string, signal: AbortSignal) => Promise<{ readonly projectDefault: string | null; readonly decided: string | null }>
  readonly choiceOf: (sessionId: string) => string | null
  readonly clearChoice: (sessionId: string) => void
  /** True when the person picked a model for this draft themselves: their pick stays. */
  readonly modelPicked: (sessionId: string) => boolean
  /** Apply an Agent preset to the blank Session; resolves to an error message, or null once applied. */
  readonly applyPreset: (sessionId: string, preset: string) => Promise<string | null>
  /** Select the agent's model route; resolves to an error message, or null once selected. */
  readonly applyModel: (selection: AgentModelSelection) => Promise<string | null>
  /** Record the thread's agent on the Host, so its first request already has that agent's tools. */
  readonly recordAgent: (sessionId: string, handle: string) => Promise<void>
  /** Title the thread from the request, as a dispatch does; resolves to an error message, or null once renamed. */
  readonly rename: (sessionId: string, title: string) => Promise<string | null>
}

const warn = (sessionId: string, what: string, reason: string | null): void => {
  if (reason !== null) console.warn(`agents: new thread ${sessionId} ${what}: ${reason}`)
}

/**
 * The composer's first-send step: start the thread as its agent (a leading mention, the chip's pick, else the project
 * default) the way a dispatch does — its Agent preset, model route, recorded agent and an opening message with its
 * instructions. Each Host step that fails is logged and skipped, so the message still goes out.
 */
export const createComposerAgentPreparer = (ports: ComposerAgentPorts): ComposerSendPreparer => ({
  id: '@dshfiles/agents.thread-agent',
  order: 10,
  prepare: async ({ sessionId, text, signal }) => {
    const [agents, host] = await Promise.all([ports.listAgents(signal), ports.hostAgentOf(sessionId, signal)])
    const plan = ComposerAgent.plan({ agents, projectDefault: host.projectDefault, decided: host.decided, choice: ports.choiceOf(sessionId), text })
    if (plan === null) return undefined
    ports.clearChoice(sessionId)
    // SAFETY: the composer passes the Host Session id it is about to prompt.
    const selection = ports.modelPicked(sessionId) ? null : AgentDispatch.modelSelection(sessionId as SessionId, plan.agent.route)
    const record = plan.record
      ? ports.recordAgent(sessionId, plan.agent.handle).catch((cause: unknown) => warn(sessionId, 'kept its default agent', String(cause)))
      : undefined
    if (plan.preset !== null) warn(sessionId, `kept its Agent preset instead of ${plan.preset}`, await ports.applyPreset(sessionId, plan.preset))
    if (selection !== null) warn(sessionId, 'kept its model', await ports.applyModel(selection))
    await record
    if (!plan.introduce) return undefined
    // The opening message starts with the agent's identity, so the thread is titled from the request instead.
    warn(sessionId, 'kept its title', await ports.rename(sessionId, AgentDispatch.title({ agent: plan.agent, prompt: text, target: { kind: 'default' } })))
    return { text: AgentDispatch.composerMessage(plan.agent, text) }
  },
})
