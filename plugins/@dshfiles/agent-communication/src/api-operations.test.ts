import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CommunicationService,
  communicationDiagnosticsSchema,
  communicationMessageRecipientsSchema,
  type CommunicationAgent,
  type CommunicationPrincipal,
} from '@dshfiles/dshx/communication'
import { browseMessagesInputSchema, postMessageInputSchema, type AgentCommunicationSubscriptionInput } from './api.js'
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
  it('decodes legacy Host diagnostics without inferring missing workspace subscriptions', () => {
    const messageId = 'd4a63b74-06d8-46f7-b97b-a43d1581b021'
    const legacyDiagnostics = communicationDiagnosticsSchema.safeParse({
      generatedAt: 1_800_000_000_000,
      agentCount: 1,
      agents: [{ id: 'agent-reader', status: 'idle', workspaceTopic: 'workspace/demo', workspaceOptedOut: false }],
      topicCount: 1,
      topics: [{ topic: 'workspace/demo', subscribers: 1 }],
      subscriptionCount: 1,
      subscriptions: [
        { principal: { kind: 'agent', id: 'agent-reader' }, topic: 'workspace/demo', delivery: 'queue', createdAt: 1_800_000_000_000, allowSteerFromCount: 0 },
      ],
      messageCount: 1,
      pendingMessageCount: 1,
      pendingRecipientCount: 1,
      unnotifiedRecipientCount: 1,
      recentMessages: [
        {
          id: messageId,
          topic: 'workspace/demo',
          sender: { kind: 'agent', id: 'agent-sender' },
          priority: 'urgent',
          createdAt: 1_800_000_000_000,
          recipientCount: 1,
          pendingRecipientCount: 1,
          unnotifiedRecipientCount: 1,
        },
      ],
      activity: { trackingStartedAt: null, oldestRetainedAt: null, retainedCount: 0, events: [] },
      historyNote: 'Legacy diagnostic history.',
    })

    expect(legacyDiagnostics.success).toBe(true)
    if (legacyDiagnostics.success) {
      expect(legacyDiagnostics.data.agents[0]?.workspaceSubscribed).toBeUndefined()
      expect(legacyDiagnostics.data.subscriptions[0]?.delivery).toBe('queue')
      expect(legacyDiagnostics.data.recentMessages[0]?.intent).toBe('notice')
    }

    expect(
      communicationMessageRecipientsSchema.safeParse({
        messageId,
        recipientCount: 1,
        recipients: [
          {
            principal: { kind: 'agent', id: 'agent-reader' },
            delivery: 'queue',
            acknowledgedAt: null,
            notifiedAt: 1_800_000_000_000,
            allowSteerFromCount: 0,
          },
        ],
      }),
    ).toMatchObject({ success: true, data: { recipients: [{ readAt: null }] } })
  })

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

  it('browses pages without reading or acknowledging and posts as a browser principal', async () => {
    const { service, operations } = await createTestOperations()
    const topic = 'workspace/demo'
    await service.ensureSubscription({ kind: 'agent', id: 'agent-reader' }, { topic, delivery: 'passive' })
    const receipt = await operations.postMessage({ topic, text: 'A browser-authored message.' })

    expect(receipt).toMatchObject({ topic, recipientCount: 1 })
    expect(receipt).not.toHaveProperty('text')
    expect(await operations.browseMessages({ topic, limit: 1 })).toMatchObject({
      items: [{ id: receipt.messageId, sender: { kind: 'external', id: 'communication-browser' }, text: 'A browser-authored message.' }],
      nextCursor: null,
      totalMatching: 1,
    })
    expect(await service.messageRecipients(receipt.messageId)).toMatchObject({
      recipients: [{ principal: { id: 'agent-reader' }, readAt: null, acknowledgedAt: null }],
    })

    const directReceipt = await operations.postMessage({ agentId: 'agent-reader', text: 'A direct browser message.' })
    expect(directReceipt).toMatchObject({ topic: null, recipientCount: 1 })
    expect(await operations.browseMessages({ agentId: 'agent-reader' })).toMatchObject({
      items: [{ id: directReceipt.messageId, topic: null, text: 'A direct browser message.' }],
    })

    const offlineReceipt = await operations.postMessage({ agentId: 'agent-offline', text: 'A durable message for an offline Agent.' })
    expect(offlineReceipt).toMatchObject({ topic: null, recipientCount: 1 })
    expect(await service.messageRecipients(offlineReceipt.messageId)).toMatchObject({
      recipients: [{ principal: { id: 'agent-offline' }, readAt: null, acknowledgedAt: null }],
    })
  })

  it('validates message targets and paginates a direct conversation without duplicate pages', async () => {
    const { operations } = await createTestOperations()
    expect(postMessageInputSchema.safeParse({ text: 'missing target' }).success).toBe(false)
    expect(postMessageInputSchema.safeParse({ topic: 'workspace/demo', agentId: 'agent-reader', text: 'ambiguous' }).success).toBe(false)
    expect(browseMessagesInputSchema.safeParse({ topic: 'workspace/demo', agentId: 'agent-reader' }).success).toBe(false)

    for (let index = 0; index < 5; index += 1) {
      await operations.postMessage({ agentId: 'agent-reader', text: `direct ${index}` })
    }
    const newerPage = await operations.browseMessages({ agentId: 'agent-reader', limit: 2 })
    expect(newerPage.items.map(item => item.text)).toEqual(['direct 3', 'direct 4'])
    expect(newerPage.nextCursor).toBe(newerPage.items[0]?.id)

    const olderPage = await operations.browseMessages({
      agentId: 'agent-reader',
      ...(newerPage.nextCursor === null ? {} : { beforeId: newerPage.nextCursor }),
      limit: 2,
    })
    expect(olderPage.items.map(item => item.text)).toEqual(['direct 1', 'direct 2'])
    expect(olderPage.items.some(item => newerPage.items.some(newer => newer.id === item.id))).toBe(false)
    expect(olderPage.nextCursor).toBeDefined()
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
