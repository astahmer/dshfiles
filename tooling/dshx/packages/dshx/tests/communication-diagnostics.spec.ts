import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommunicationService } from '../src/communication/service.js'
import { communicationStateSchema, type CommunicationPrincipal } from '../src/communication/types.js'

const temporaryRoots: string[] = []

const statePath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-communication-diagnostics-'))
  temporaryRoots.push(root)
  return join(root, 'state.json')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('communication diagnostics', () => {
  it('records Agent tool activity and returns bounded metadata without mutating state', async () => {
    const path = await statePath()
    const now = 1_800_000_000_000
    const service = new CommunicationService({ statePath: path, now: () => now })
    const reader: Extract<CommunicationPrincipal, { readonly kind: 'agent' }> = { kind: 'agent', id: 'agent-reader' }
    const sender: Extract<CommunicationPrincipal, { readonly kind: 'agent' }> = { kind: 'agent', id: 'agent-sender' }
    await service.subscribe(reader, { topic: 'workspace/demo' })
    await service.publish({ sender, topic: 'workspace/demo', text: 'private-message-body' })
    await service.recordActivity({
      principal: reader,
      operation: 'dshx_comm_inbox',
      outcome: 'success',
      occurredAt: now,
      durationMs: 12,
      callId: 'tool-call-1',
      rootCallId: 'root-call-1',
    })
    await service.recordActivity({
      principal: reader,
      operation: 'dshx_comm_send',
      outcome: 'failure',
      occurredAt: now + 1,
      durationMs: 8,
      callId: 'tool-call-2',
      errorCode: 'self-message',
    })
    const beforeReport = await readFile(path, 'utf8')

    const report = await service.diagnostics({ agents: [{ id: reader.id, status: 'idle' }], limit: 2 })

    expect(await readFile(path, 'utf8')).toBe(beforeReport)
    expect(report).toMatchObject({
      agentCount: 1,
      topicCount: 1,
      subscriptionCount: 1,
      messageCount: 1,
      pendingMessageCount: 1,
      pendingRecipientCount: 1,
      activity: {
        trackingStartedAt: now,
        oldestRetainedAt: now,
        retainedCount: 2,
        events: [
          { principal: reader, operation: 'dshx_comm_send', outcome: 'failure', callId: 'tool-call-2', errorCode: 'self-message' },
          { principal: reader, operation: 'dshx_comm_inbox', outcome: 'success', callId: 'tool-call-1' },
        ],
      },
    })
    expect(JSON.stringify(report)).not.toContain('private-message-body')
    expect(report.recentMessages[0]).not.toHaveProperty('text')
    const firstMessage = report.recentMessages[0]
    if (firstMessage === undefined) throw new Error('Expected a recent message.')
    const messageId = firstMessage.id
    const recipients = await service.messageRecipients(messageId)
    expect(recipients).toMatchObject({
      messageId,
      recipientCount: 1,
      recipients: [{ principal: reader, delivery: 'passive', readAt: null, acknowledgedAt: null }],
    })
    expect(await service.revealMessageBody(messageId)).toEqual({ messageId, text: 'private-message-body' })
    expect(await readFile(path, 'utf8')).toBe(beforeReport)

    await service.acknowledge(reader, messageId)
    expect((await service.messageRecipients(messageId)).recipients[0]?.acknowledgedAt).toBe(now)
    await expect(service.revealMessageBody('11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({ code: 'message-not-found' })
  })

  it('reads legacy version-one state without writing and upgrades it on the next mutation', async () => {
    const path = await statePath()
    const messageId = '11111111-1111-4111-8111-111111111111'
    const principal: Extract<CommunicationPrincipal, { readonly kind: 'agent' }> = { kind: 'agent', id: 'agent-reader' }
    const legacyState = {
      schemaVersion: 1,
      messages: [
        {
          id: messageId,
          topic: 'workspace/demo',
          sender: { kind: 'agent', id: 'agent-sender' },
          text: 'legacy message body',
          priority: 'normal',
          createdAt: 1_800_000_000_000,
          recipients: [{ principal, delivery: 'queue', allowSteerFrom: [] }],
        },
      ],
      subscriptions: [{ principal, topic: 'workspace/demo', delivery: 'queue', allowSteerFrom: [], createdAt: 1_800_000_000_000 }],
      acknowledgements: [{ messageId, principal, acknowledgedAt: 1_800_000_000_000 }],
      workspaceOptOuts: ['agent-opted-out'],
      notifications: [{ messageId, agentId: principal.id, notifiedAt: 1_800_000_000_000 }],
    }
    await writeFile(path, `${JSON.stringify(legacyState)}\n`, { mode: 0o600 })
    const service = new CommunicationService({ statePath: path, now: () => 1_800_000_000_000 })
    const beforeReport = await readFile(path, 'utf8')

    const report = await service.diagnostics({ agents: [], limit: 1 })

    expect(report.activity).toMatchObject({ trackingStartedAt: null, retainedCount: 0, events: [] })
    expect(await readFile(path, 'utf8')).toBe(beforeReport)

    await service.subscribe({ kind: 'agent', id: 'agent-reader' }, { topic: 'builds.ready' })
    const upgraded = communicationStateSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    expect(upgraded).toMatchObject({
      schemaVersion: 3,
      activityStartedAt: null,
      activityEvents: [],
      workspaceOptOuts: ['agent-opted-out'],
    })
    expect(upgraded).not.toHaveProperty('notifications')
    expect(upgraded.messages).toMatchObject([{ text: 'legacy message body', recipients: [{ principal, delivery: 'passive', readAt: null }] }])
    expect(upgraded.subscriptions).toMatchObject([
      { principal, topic: 'workspace/demo', delivery: 'passive' },
      { principal, topic: 'builds.ready', delivery: 'passive' },
    ])
    expect(upgraded.subscriptions).toHaveLength(2)
    expect(upgraded.acknowledgements).toHaveLength(1)
  })

  it('reports workspace opt-out state and clears it when the Agent rejoins', async () => {
    const service = new CommunicationService({ statePath: await statePath(), now: () => 1_800_000_000_000 })
    const agent: Extract<CommunicationPrincipal, { readonly kind: 'agent' }> = { kind: 'agent', id: 'agent-reader' }
    await service.subscribe(agent, { topic: 'workspace/demo' })
    await service.unsubscribe(agent, 'workspace/demo')

    const optedOut = await service.diagnostics({ agents: [{ id: agent.id, workspaceTopic: 'workspace/demo' }] })
    expect(optedOut.agents).toMatchObject([{ id: agent.id, workspaceTopic: 'workspace/demo', workspaceOptedOut: true }])

    await service.subscribe(agent, { topic: 'workspace/demo' })
    const rejoined = await service.diagnostics({ agents: [{ id: agent.id, workspaceTopic: 'workspace/demo' }] })
    expect(rejoined.agents).toMatchObject([{ id: agent.id, workspaceTopic: 'workspace/demo', workspaceOptedOut: false }])
  })

  it('excludes activity older than the 30-day retention window without writing during diagnostics', async () => {
    const path = await statePath()
    const now = 1_800_000_000_000
    const firstRecordedAt = now - 30 * 24 * 60 * 60 * 1000 - 1
    const service = new CommunicationService({ statePath: path, now: () => now })
    await service.recordActivity({
      principal: { kind: 'agent', id: 'agent-reader' },
      operation: 'dshx_comm_inbox',
      outcome: 'success',
      occurredAt: firstRecordedAt,
      durationMs: 1,
      callId: 'expired-tool-call',
    })
    const beforeReport = await readFile(path, 'utf8')

    const report = await service.diagnostics({ agents: [] })

    expect(report.activity).toMatchObject({ trackingStartedAt: firstRecordedAt, oldestRetainedAt: null, retainedCount: 0, events: [] })
    expect(await readFile(path, 'utf8')).toBe(beforeReport)
  })

  it('rejects diagnostic limits outside the bounded range', async () => {
    const service = new CommunicationService({ statePath: await statePath() })
    await expect(service.diagnostics({ agents: [], limit: 101 })).rejects.toMatchObject({ code: 'invalid-limit' })
  })
})
