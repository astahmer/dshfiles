import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

export const communicationWorkspaceTopic = (cwd: string | undefined): string | undefined => {
  if (cwd === undefined || cwd.length === 0) return undefined
  const digest = createHash('sha256').update(resolve(cwd)).digest('hex').slice(0, 24)
  return `workspace/${digest}`
}

interface LiveAgentDirectoryRecord {
  readonly id: string
  readonly status: string
  readonly createdAt: number
  readonly cwd?: string
}

export const findOwnedLiveAgents = <Agent extends { readonly id: string }>(input: {
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

export const findOwnedLiveAgent = <Agent extends { readonly id: string }>(input: {
  readonly caller: Agent
  readonly liveAgents: readonly Agent[]
  readonly targetId: string
  readonly isOwnedBy: (candidate: Agent, owner: Agent) => boolean
}) =>
  findOwnedLiveAgents({
    caller: input.caller,
    liveAgents: input.liveAgents,
    isOwnedBy: input.isOwnedBy,
  }).find(({ agent }) => agent.id === input.targetId)

export const observeLiveAgent = (agent: LiveAgentDirectoryRecord) => ({
  id: agent.id,
  status: agent.status,
  createdAt: agent.createdAt,
  workspaceTopic: communicationWorkspaceTopic(agent.cwd) ?? null,
})

export const projectRegisteredWorkspace = (workspace: Pick<Workspace, 'id' | 'title'>) => ({
  workspace_id: workspace.id,
  workspace_title: workspace.title,
})

export const projectDurableSubagentDescendants = (entries: readonly SubagentDescendantListEntry[]) =>
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
