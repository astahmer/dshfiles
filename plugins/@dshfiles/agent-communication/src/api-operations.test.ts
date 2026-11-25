import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, Schema } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CommunicationService,
  communicationDiagnosticsSchema,
  communicationMessageRecipientsSchema,
  type CommunicationAgent,
  type CommunicationPrincipal,
} from '@dshfiles/dshx/communication'
import { postMessageInputSchema, type AgentCommunicationBrowseInput, type AgentCommunicationPostInput } from './api.js'
import { CommunicationOperations } from './api-operations.js'
import { CommunicationHub } from './communication-hub-promise.js'
import { HostAgents } from './host-edge-promise.js'

const temporaryRoots: string[] = []

const operationsOver = (service: CommunicationService, agents: readonly CommunicationAgent[]) => {
  const layer = CommunicationOperations.layer.pipe(Layer.provide(Layer.merge(CommunicationHub.fromService(service), HostAgents.layerTest(agents))))
  const run = <A, E>(body: (operations: CommunicationOperations['Service']) => Effect.Effect<A, E>) =>
    Effect.runPromise(CommunicationOperations.use(body).pipe(Effect.provide(layer)))
  return {
    diagnostics: (limit?: number) => run(operations => operations.diagnostics(limit)),
    browseMessages: (request: AgentCommunicationBrowseInput) => run(operations => operations.browseMessages(request)),
    postMessage: (request: AgentCommunicationPostInput) => run(operations => operations.postMessage(request)),
    acknowledge: (request: { readonly agentId: string; readonly messageId: string }) => run(operations => operations.acknowledge(request)),
  }
}

const createTestOperations = async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-communication-api-'))
  temporaryRoots.push(root)
  const service = new CommunicationService({ statePath: join(root, 'state.json'), now: () => 1_800_000_000_000 })
  const agents: readonly CommunicationAgent[] = [
    { id: 'agent-reader', status: 'idle', workspaceTopic: 'workspace/demo' },
    { id: 'agent-sender', status: 'running', workspaceTopic: 'workspace/demo' },
  ]
  return { service, operations: operationsOver(service, agents) }
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
      agents: [{ id: 'agent-reader', status: 'idle' }],
      messageCount: 1,
      pendingMessageCount: 1,
      pendingRecipientCount: 1,
      unnotifiedRecipientCount: 1,
      recentMessages: [
        {
          id: messageId,
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
      expect(legacyDiagnostics.data.agents[0]?.id).toBe('agent-reader')
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

  it('browses pages without reading or acknowledging and posts as a browser principal', async () => {
    const { service, operations } = await createTestOperations()
    const receipt = await operations.postMessage({ agentId: 'agent-reader', text: 'A browser-authored message.' })

    expect(receipt).toMatchObject({ recipientCount: 1 })
    expect(receipt).not.toHaveProperty('text')
    const firstPage = await operations.browseMessages({ agentId: 'agent-reader', limit: 1 })
    expect(firstPage.items).toContainEqual(expect.objectContaining({ id: receipt.messageId, sender: { kind: 'external', id: 'communication-browser' } }))
    expect(firstPage.totalMatching).toBeGreaterThanOrEqual(1)
    expect(await service.messageRecipients(receipt.messageId)).toMatchObject({
      recipients: [{ principal: { id: 'agent-reader' }, readAt: null, acknowledgedAt: null }],
    })

    const directReceipt = await operations.postMessage({ agentId: 'agent-reader', text: 'A direct browser message.' })
    expect(directReceipt).toMatchObject({ recipientCount: 1 })
    expect((await operations.browseMessages({ agentId: 'agent-reader' })).items).toContainEqual(
      expect.objectContaining({ id: directReceipt.messageId, text: 'A direct browser message.' }),
    )

    const offlineReceipt = await operations.postMessage({ agentId: 'agent-offline', text: 'A durable message for an offline Agent.' })
    expect(offlineReceipt).toMatchObject({ recipientCount: 1 })
    expect(await service.messageRecipients(offlineReceipt.messageId)).toMatchObject({
      recipients: [{ principal: { id: 'agent-offline' }, readAt: null, acknowledgedAt: null }],
    })
  })

  it('validates message targets and paginates a direct conversation without duplicate pages', async () => {
    const { operations } = await createTestOperations()
    expect(Schema.is(postMessageInputSchema)({ text: 'missing target' })).toBe(false)
    expect(Schema.is(postMessageInputSchema)({ text: 'no recipient' })).toBe(false)

    for (let index = 0; index < 5; index += 1) {
      await operations.postMessage({ agentId: 'agent-reader', text: `direct ${index}` })
    }
    const newerPage = await operations.browseMessages({ agentId: 'agent-reader', limit: 2 })
    expect(newerPage.items.map(item => item.text)).toEqual(['direct 3', 'direct 4'])
    expect(newerPage.nextCursor).toBe(newerPage.items[0]?.id)

    const olderPage = await operations.browseMessages({
      agentId: 'agent-reader',
      ...(newerPage.nextCursor !== null && { beforeId: newerPage.nextCursor }),
      limit: 2,
    })
    expect(olderPage.items.map(item => item.text)).toEqual(['direct 1', 'direct 2'])
    expect(olderPage.items.some(item => newerPage.items.some(newer => newer.id === item.id))).toBe(false)
    expect(olderPage.nextCursor).toBeDefined()
  })

  it('only acknowledges a message recipient', async () => {
    const { service, operations } = await createTestOperations()
    const sender: Extract<CommunicationPrincipal, { readonly kind: 'agent' }> = { kind: 'agent', id: 'agent-sender' }
    const message = await service.send({ sender, toAgentId: 'agent-reader', text: 'Inspect this message.' })

    await expect(operations.acknowledge({ agentId: 'agent-sender', messageId: message.id })).rejects.toMatchObject({ code: 'message-not-found' })
    await expect(operations.acknowledge({ agentId: 'agent-reader', messageId: message.id })).resolves.toEqual({ acknowledged: true })
  })
})
