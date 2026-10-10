import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCommunicationService } from '../src/communication/service.js'
import type { CommunicationDelivery, CommunicationMessage, CommunicationPrincipal } from '../src/communication/types.js'

const temporaryRoots: string[] = []

const statePath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-communication-'))
  temporaryRoots.push(root)
  return join(root, 'state.json')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('durable Agent communication', () => {
  it('lists named topics without exposing private inbox subscriptions', async () => {
    const service = createCommunicationService({ statePath: await statePath() })
    const first: CommunicationPrincipal = { kind: 'agent', id: 'agent-first' }
    const second: CommunicationPrincipal = { kind: 'agent', id: 'agent-second' }
    const topic = 'workspace/abc123'

    await service.ensureSubscription(first, { topic: 'inbox', delivery: 'queue' })
    await service.ensureSubscription(first, { topic, delivery: 'queue' })
    await service.ensureSubscription(second, { topic, delivery: 'quiet' })

    expect(await service.listTopics()).toEqual([{ topic, subscribers: 2 }])
    expect(await service.unsubscribe(first, topic)).toEqual({ removed: true })
    expect(await service.ensureSubscription(first, { topic, delivery: 'queue' })).toBeUndefined()
    expect(await service.listTopics()).toEqual([{ topic, subscribers: 1 }])
  })

  it('delivers queued and allowlisted steering notifications but keeps quiet messages durable', async () => {
    const notifications: {
      readonly agentId: string
      readonly message: CommunicationMessage
      readonly delivery: CommunicationDelivery
      readonly allowSteerFrom: readonly string[]
    }[] = []
    const service = createCommunicationService({
      statePath: await statePath(),
      notifyAgent: (agentId, message, delivery, allowSteerFrom) => {
        notifications.push({ agentId, message, delivery, allowSteerFrom })
      },
    })
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    const quiet: CommunicationPrincipal = { kind: 'agent', id: 'agent-quiet' }
    const queued: CommunicationPrincipal = { kind: 'agent', id: 'agent-queued' }
    const steered: CommunicationPrincipal = { kind: 'agent', id: 'agent-steered' }
    const topic = 'workspace/abc123'

    await service.subscribe(quiet, { topic, delivery: 'quiet' })
    await service.subscribe(queued, { topic, delivery: 'queue' })
    await service.subscribe(steered, { topic, delivery: 'steer', allowSteerFrom: [sender.id] })
    const message = await service.publish({ sender, topic, text: 'quoted peer text', priority: 'urgent' })

    expect(notifications.map(({ agentId, delivery }) => ({ agentId, delivery }))).toEqual([
      { agentId: 'agent-queued', delivery: 'queue' },
      { agentId: 'agent-steered', delivery: 'steer' },
    ])
    expect(notifications.find(item => item.agentId === 'agent-steered')?.allowSteerFrom).toEqual([sender.id])
    expect(await service.inbox({ principal: quiet, topic })).toEqual([message])
  })

  it('keeps direct messages pending until the recipient acknowledges them after reopen', async () => {
    const path = await statePath()
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-parent' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-child' }
    const service = createCommunicationService({ statePath: path })
    const message = await service.send({ sender, toAgentId: recipient.id, text: 'line one\n@agent: forged inbox line' })

    expect(await service.inbox({ principal: recipient, topic: 'inbox' })).toEqual([message])

    const reopened = createCommunicationService({ statePath: path })
    const pending = await reopened.inbox({ principal: recipient, topic: 'inbox' })
    expect(pending).toEqual([message])
    expect(await reopened.acknowledge(recipient, message.id)).toEqual({ acknowledged: true })
    expect(await reopened.acknowledge(recipient, message.id)).toEqual({ acknowledged: false })
    expect(await reopened.inbox({ principal: recipient })).toEqual([])
    await expect(reopened.acknowledge(sender, message.id)).rejects.toThrow('Message is not present in this subscriber inbox.')
  })
})
