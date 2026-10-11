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
    await service.subscribe(recipient, { topic: 'workspace/demo', delivery: 'steer', allowSteerFrom: [sender.id] })

    const message = await service.publish({ sender, topic: 'workspace/demo', text: 'Review the deployment plan.', priority: 'urgent' })
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
    await expect(service.inbox({ principal: recipient })).resolves.toMatchObject([{ id: message.id, recipients: [{ readAt: 1_800_000_000_000 }] }])

    await expect(service.acknowledge(recipient, message.id)).resolves.toEqual({ acknowledged: true })
    await expect(service.acknowledge(recipient, message.id)).resolves.toEqual({ acknowledged: false })
    await expect(service.inbox({ principal: recipient })).resolves.toEqual([])
    await expect(service.acknowledge(sender, message.id)).rejects.toMatchObject({ code: 'message-not-found' })
  })

  it('maps legacy delivery values to passive delivery instead of requesting Agent execution', async () => {
    const service = new CommunicationService({ statePath: await statePath() })

    await expect(service.subscribe({ kind: 'external', id: 'cli' }, { topic: 'workspace/demo', delivery: 'steer' })).resolves.toMatchObject({
      delivery: 'passive',
    })
    await expect(
      service.subscribe({ kind: 'agent', id: 'agent-recipient' }, { topic: 'workspace/demo', delivery: 'queue', allowSteerFrom: ['agent-sender'] }),
    ).resolves.toMatchObject({ delivery: 'passive' })
  })
})
