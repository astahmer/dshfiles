import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

interface LiveAgentDirectoryRecord {
  readonly id: string
  readonly status: string
  readonly createdAt: number
  readonly cwd?: string | undefined
}

export class LiveAgentDirectoryModel {
  static readonly projectAgents = (input: {
    readonly agents: readonly {
      readonly id: string
      readonly title: string
      readonly status: string
      readonly createdAt: number
      readonly cwd?: string | undefined
      readonly parentSessionId?: string | undefined
    }[]
    readonly callerId?: string | undefined
    readonly callerParentSessionId?: string | undefined
    readonly callerCwd?: string | undefined
    readonly includeAll: boolean
  }) => {
    const callerWorkspace = LiveAgentDirectoryModel.communicationWorkspaceTopic(input.callerCwd)
    const relationOf = (agent: (typeof input.agents)[number]) => {
      if (agent.id === input.callerId) return 'self'
      if (input.callerParentSessionId === agent.id) return 'parent'
      if (agent.parentSessionId === input.callerId && input.callerId !== undefined) return 'child'
      if (agent.parentSessionId !== undefined && agent.parentSessionId === input.callerParentSessionId) return 'sibling'
      return 'other'
    }
    const relations = input.agents.map(agent => {
      const relation = relationOf(agent)
      const workspace = LiveAgentDirectoryModel.communicationWorkspaceTopic(agent.cwd)
      return {
        agent,
        relation,
        sameWorkspace: callerWorkspace !== undefined && workspace === callerWorkspace,
      }
    })
    const relationOrder = new Map([
      ['self', 0],
      ['parent', 1],
      ['child', 2],
      ['sibling', 3],
      ['other', 4],
    ])
    const visible = input.includeAll ? relations : relations.filter(({ agent }) => agent.status !== 'finished' && agent.status !== 'archived')
    return visible
      .sort(
        (left, right) =>
          Number(right.sameWorkspace) - Number(left.sameWorkspace) ||
          (relationOrder.get(left.relation) ?? 4) - (relationOrder.get(right.relation) ?? 4) ||
          right.agent.createdAt - left.agent.createdAt,
      )
      .slice(0, 100)
      .map(({ agent, relation }) => ({
        id: agent.id,
        title: agent.title,
        status: agent.status,
        created_at: agent.createdAt,
        parent_session_id: agent.parentSessionId ?? null,
        relation,
      }))
  }

  static readonly communicationWorkspaceTopic = (cwd: string | undefined): string | undefined => {
    if (cwd === undefined || cwd.length === 0) return undefined
    const digest = createHash('sha256').update(resolve(cwd)).digest('hex').slice(0, 24)
    return `workspace/${digest}`
  }

  static readonly findOwnedLiveAgents = <Agent extends { readonly id: string }>(input: {
    readonly caller: Agent
    readonly liveAgents: readonly Agent[]
    readonly isOwnedBy: (candidate: Agent, owner: Agent) => boolean
  }) => {
    const visited = new Set([input.caller.id])
    const pendingOwners = [input.caller]
    const descendants: Array<{ readonly agent: Agent; readonly owner: Agent }> = []

    while (pendingOwners.length > 0) {
      const owner = pendingOwners.shift()
      if (owner === undefined) continue

      for (const candidate of input.liveAgents) {
        if (visited.has(candidate.id) || !input.isOwnedBy(candidate, owner)) continue
        visited.add(candidate.id)
        descendants.push({ agent: candidate, owner })
        pendingOwners.push(candidate)
      }
    }

    return descendants
  }

  static readonly findOwnedLiveAgent = <Agent extends { readonly id: string }>(input: {
    readonly caller: Agent
    readonly liveAgents: readonly Agent[]
    readonly targetId: string
    readonly isOwnedBy: (candidate: Agent, owner: Agent) => boolean
  }) =>
    LiveAgentDirectoryModel.findOwnedLiveAgents({
      caller: input.caller,
      liveAgents: input.liveAgents,
      isOwnedBy: input.isOwnedBy,
    }).find(({ agent }) => agent.id === input.targetId)

  static readonly observeLiveAgent = (agent: LiveAgentDirectoryRecord) => ({
    id: agent.id,
    status: agent.status,
    createdAt: agent.createdAt,
    workspaceTopic: LiveAgentDirectoryModel.communicationWorkspaceTopic(agent.cwd) ?? null,
  })

  static readonly projectRegisteredWorkspace = (workspace: Pick<Workspace, 'id' | 'title'>) => ({
    workspace_id: workspace.id,
    workspace_title: workspace.title,
  })

  static readonly projectDurableSubagentDescendants = (entries: readonly SubagentDescendantListEntry[]) =>
    entries.map(entry => {
      if (entry.kind === 'diagnostic') {
        return {
          kind: 'diagnostic',
          id: entry.id,
          parent_session_id: entry.parentId,
          depth: entry.depth,
          reason: entry.reason,
        }
      }

      return {
        kind: 'child',
        id: entry.id,
        parent_session_id: entry.parentId,
        depth: entry.depth,
        mode: entry.mode,
        activity: entry.activity,
        has_children: entry.hasChildren,
      }
    })
}
