import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  it('delivers an allow-listed notice once while keeping the durable inbox authoritative', async () => {
    const notifyAgent = vi.fn()
    const service = new CommunicationService({ statePath: await statePath(), now: () => 1_800_000_000_000, notifyAgent })
    const sender = { kind: 'agent' as const, id: 'agent-sender' }
    const recipient = { kind: 'agent' as const, id: 'agent-recipient' }
    await service.subscribe(recipient, { topic: 'workspace/demo', delivery: 'steer', allowSteerFrom: [sender.id] })

    const message = await service.publish({ sender, topic: 'workspace/demo', text: 'Review the deployment plan.', priority: 'urgent' })
    expect(notifyAgent).toHaveBeenCalledExactlyOnceWith(recipient.id, message, 'steer', [sender.id])
    await service.deliverPending(recipient.id)
    expect(notifyAgent).toHaveBeenCalledOnce()
    await expect(service.inbox({ principal: recipient })).resolves.toEqual([message])
    await expect(service.inbox({ principal: { kind: 'external', id: 'cli' } })).resolves.toEqual([])

    await expect(service.acknowledge(recipient, message.id)).resolves.toEqual({ acknowledged: true })
    await expect(service.acknowledge(recipient, message.id)).resolves.toEqual({ acknowledged: false })
    await expect(service.inbox({ principal: recipient })).resolves.toEqual([])
    await expect(service.acknowledge(sender, message.id)).rejects.toMatchObject({ code: 'message-not-found' })
  })

  it('refuses steer delivery to external subscribers and requires an allowlist for agents', async () => {
    const service = new CommunicationService({ statePath: await statePath() })

    await expect(service.subscribe({ kind: 'external', id: 'cli' }, { topic: 'workspace/demo', delivery: 'steer' })).rejects.toMatchObject({
      code: 'invalid-delivery',
    })
    await expect(service.subscribe({ kind: 'agent', id: 'agent-recipient' }, { topic: 'workspace/demo', delivery: 'steer' })).rejects.toMatchObject({
      code: 'sender-allowlist-required',
    })
  })
})
