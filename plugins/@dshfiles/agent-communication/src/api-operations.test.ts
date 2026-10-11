import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommunicationService, type CommunicationAgent, type CommunicationPrincipal } from '@dshfiles/dshx/communication'
import type { AgentCommunicationSubscriptionInput } from './api.js'
import { createAgentCommunicationOperations } from './api-operations.js'

const temporaryRoots: string[] = []

const createTestOperations = async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-communication-api-'))
  temporaryRoots.push(root)
  const service = new CommunicationService({ statePath: join(root, 'state.json'), now: () => 1_800_000_000_000 })
  const agents: readonly CommunicationAgent[] = [
    { id: 'agent-reader', status: 'idle', workspaceTopic: 'workspace/demo' },
    { id: 'agent-sender', status: 'running', workspaceTopic: 'workspace/demo' },
  ]
  return { service, operations: createAgentCommunicationOperations({ service: () => service, listAgents: () => agents }) }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Agent communication API operations', () => {
  it('only subscribes live Agents and configures passive delivery', async () => {
    const { service, operations } = await createTestOperations()
    const missingTarget: AgentCommunicationSubscriptionInput = { agentId: 'agent-unknown', topic: 'workspace/demo' }
    const request: AgentCommunicationSubscriptionInput = { agentId: 'agent-reader', topic: 'workspace/demo' }

    await expect(operations.setSubscription(missingTarget)).rejects.toMatchObject({ code: 'agent-not-live' })
    expect(await service.diagnostics({ agents: [] })).toMatchObject({ subscriptionCount: 0 })

    const saved = await operations.setSubscription(request)
    const report = await operations.diagnostics(20)

    expect(saved).toMatchObject({ principal: { kind: 'agent', id: 'agent-reader' }, topic: 'workspace/demo', delivery: 'passive' })
    expect(saved).not.toHaveProperty('allowSteerFrom')
    expect(report.subscriptions).toMatchObject([{ principal: { id: 'agent-reader' }, delivery: 'passive' }])
    expect(report.agents[0]).toMatchObject({ id: 'agent-reader', workspaceTopic: 'workspace/demo', workspaceOptedOut: false, workspaceSubscribed: true })
  })

  it('requires a live Agent to unsubscribe and only acknowledges a message recipient', async () => {
    const { service, operations } = await createTestOperations()
    const sender: Extract<CommunicationPrincipal, { readonly kind: 'agent' }> = { kind: 'agent', id: 'agent-sender' }
    const message = await service.send({ sender, toAgentId: 'agent-reader', text: 'Inspect this message.' })

    await expect(operations.unsubscribe({ agentId: 'agent-unknown', topic: 'workspace/demo' })).rejects.toMatchObject({ code: 'agent-not-live' })
    await expect(operations.acknowledge({ agentId: 'agent-sender', messageId: message.id })).rejects.toMatchObject({ code: 'message-not-found' })
    await expect(operations.acknowledge({ agentId: 'agent-reader', messageId: message.id })).resolves.toEqual({ acknowledged: true })
  })
})
