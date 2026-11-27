import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommunicationService } from '../src/communication/service.js'

const temporaryRoots: string[] = []

const statePath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-communication-'))
  temporaryRoots.push(root)
  return join(root, 'state.json')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Host communication service', () => {
  it('stores a notice once in the durable inbox and marks it read before acknowledgement', async () => {
    const service = new CommunicationService({ statePath: await statePath(), now: () => 1_800_000_000_000 })
    const sender = { kind: 'agent' as const, id: 'agent-sender' }
    const recipient = { kind: 'agent' as const, id: 'agent-recipient' }

    const message = await service.send({ sender, toAgentId: recipient.id, text: 'Review the deployment plan.', priority: 'urgent' })
    expect(message.recipients).toEqual([{ principal: recipient, delivery: 'passive', readAt: null }])
    await expect(service.inbox({ principal: { kind: 'external', id: 'cli' } })).resolves.toEqual([])

    await expect(service.inbox({ principal: recipient })).resolves.toMatchObject([
      {
        id: message.id,
        text: 'Review the deployment plan.',
        priority: 'urgent',
        recipients: [{ principal: recipient, delivery: 'passive', readAt: 1_800_000_000_000 }],
      },
    ])
    await expect(service.inbox({ principal: recipient })).resolves.toEqual([])
    await expect(service.inbox({ principal: recipient, includeSeen: true })).resolves.toMatchObject([
      { id: message.id, recipients: [{ readAt: 1_800_000_000_000 }] },
    ])

    await expect(service.acknowledge(recipient, message.id)).resolves.toEqual({ acknowledged: true })
    await expect(service.acknowledge(recipient, message.id)).resolves.toEqual({ acknowledged: false })
    await expect(service.inbox({ principal: recipient })).resolves.toEqual([])
    await expect(service.acknowledge(sender, message.id)).rejects.toMatchObject({ code: 'message-not-found' })
  })

  it('refuses a direct message to itself and keeps request intent on delivery', async () => {
    const service = new CommunicationService({ statePath: await statePath() })
    const sender = { kind: 'agent' as const, id: 'agent-sender' }

    await expect(service.send({ sender, toAgentId: sender.id, text: 'hello' })).rejects.toMatchObject({ code: 'self-message' })
    await expect(service.send({ sender, toAgentId: 'agent-recipient', text: 'Please review.', intent: 'request' })).resolves.toMatchObject({
      intent: 'request',
    })
  })
})
