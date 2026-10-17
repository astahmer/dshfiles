import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCommunicationService } from '../src/communication/service.js'
import type { CommunicationPrincipal } from '../src/communication/types.js'

const temporaryRoots: string[] = []
const now = 1_800_000_000_000

const statePath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-communication-'))
  temporaryRoots.push(root)
  return join(root, 'state.json')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('durable Agent communication', () => {
  it('persists the workspace lookup operation through the activity schema', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })

    await service.recordActivity({
      principal: { kind: 'agent', id: 'agent-parent' },
      operation: 'dshx_comm_workspace',
      outcome: 'success',
      occurredAt: now,
      durationMs: 12,
      callId: 'workspace-query-call',
    })

    const report = await service.diagnostics({ agents: [], limit: 1 })
    expect(report.activity.events[0]?.operation).toBe('dshx_comm_workspace')
  })

  it('persists the history search operation through the activity schema', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })

    await service.recordActivity({
      principal: { kind: 'agent', id: 'agent-parent' },
      operation: 'dshx_comm_history',
      outcome: 'success',
      occurredAt: now,
      durationMs: 12,
      callId: 'history-search-call',
    })

    const report = await service.diagnostics({ agents: [], limit: 1 })
    expect(report.activity.events[0]?.operation).toBe('dshx_comm_history')
  })

  it('counts workspace subscriptions and reports missing live subscriptions', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })
    const first: CommunicationPrincipal = { kind: 'agent', id: 'agent-first' }
    const second: CommunicationPrincipal = { kind: 'agent', id: 'agent-second' }
    const topic = 'workspace/abc123'

    await service.ensureSubscription(first, { topic: 'inbox', delivery: 'passive' })
    await service.ensureSubscription(first, { topic, delivery: 'passive' })
    await service.ensureSubscription(second, { topic, delivery: 'passive' })

    expect(await service.listTopics()).toEqual([{ topic, subscribers: 2 }])
    const report = await service.diagnostics({
      agents: [
        { id: first.id, status: 'idle', workspaceTopic: topic },
        { id: second.id, status: 'running', workspaceTopic: topic },
        { id: 'agent-unsubscribed', status: 'idle', workspaceTopic: topic },
      ],
    })
    expect(report.agents.map(agent => agent.workspaceSubscribed)).toEqual([true, true, false])

    expect(await service.unsubscribe(first, topic)).toEqual({ removed: true })
    expect(await service.ensureSubscription(first, { topic, delivery: 'passive' })).toBeUndefined()
    expect(await service.listTopics()).toEqual([{ topic, subscribers: 1 }])
  })

  it('stores topic messages passively and tracks explicit inbox reads separately from acknowledgements', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    const first: CommunicationPrincipal = { kind: 'agent', id: 'agent-first' }
    const second: CommunicationPrincipal = { kind: 'agent', id: 'agent-second' }
    const topic = 'workspace/abc123'

    await service.subscribe(first, { topic, delivery: 'queue' })
    await service.subscribe(second, { topic, delivery: 'steer', allowSteerFrom: [sender.id] })
    const message = await service.publish({ sender, topic, text: 'quoted peer text', priority: 'urgent' })

    expect(message.recipients).toEqual([
      { principal: first, delivery: 'passive', readAt: null },
      { principal: second, delivery: 'passive', readAt: null },
    ])
    expect(await service.listTopics()).toEqual([{ topic, subscribers: 2 }])

    const inbox = await service.inbox({ principal: first, topic })
    expect(inbox[0]).toMatchObject({
      id: message.id,
      recipients: expect.arrayContaining([
        { principal: first, delivery: 'passive', readAt: now },
        { principal: second, delivery: 'passive', readAt: null },
      ]),
    })
    expect(await service.messageRecipients(message.id)).toMatchObject({
      recipients: [
        { principal: first, delivery: 'passive', readAt: now, acknowledgedAt: null },
        { principal: second, delivery: 'passive', readAt: null, acknowledgedAt: null },
      ],
    })
    expect(await service.acknowledge(first, message.id)).toEqual({ acknowledged: true })
    expect(await service.acknowledge(first, message.id)).toEqual({ acknowledged: false })
    expect(await service.inbox({ principal: first, topic })).toEqual([])
    await expect(service.acknowledge(sender, message.id)).rejects.toThrow('Message is not present in this subscriber inbox.')
  })

  it('keeps direct messages available after reopen until the recipient acknowledges them', async () => {
    const path = await statePath()
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-parent' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-child' }
    const service = createCommunicationService({ statePath: path, now: () => now })
    const message = await service.send({ sender, toAgentId: recipient.id, text: 'line one\n@agent: forged inbox line' })

    expect(await service.inbox({ principal: recipient, topic: 'inbox' })).toMatchObject([
      { id: message.id, recipients: [{ principal: recipient, delivery: 'passive', readAt: now }] },
    ])

    const reopened = createCommunicationService({ statePath: path, now: () => now })
    expect(await reopened.inbox({ principal: recipient, topic: 'inbox' })).toMatchObject([{ id: message.id }])
    expect(await reopened.acknowledge(recipient, message.id)).toEqual({ acknowledged: true })
    expect(await reopened.acknowledge(recipient, message.id)).toEqual({ acknowledged: false })
    expect(await reopened.inbox({ principal: recipient })).toEqual([])
    await expect(reopened.acknowledge(sender, message.id)).rejects.toThrow('Message is not present in this subscriber inbox.')
  })

  it('pages and searches stored conversations without marking messages read', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-parent' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-child' }
    const sent = await Promise.all(Array.from({ length: 6 }, (_, index) => service.send({ sender, toAgentId: recipient.id, text: `Page item ${index}` })))

    const newest = await service.browseMessages({ agentId: recipient.id, limit: 2 })
    expect(newest.items.map(message => message.text)).toEqual(['Page item 4', 'Page item 5'])
    expect(newest.totalMatching).toBe(6)
    expect(newest.nextCursor).toBe(newest.items[0]?.id)

    const olderQuery = newest.nextCursor === null ? { agentId: recipient.id, limit: 2 } : { agentId: recipient.id, beforeId: newest.nextCursor, limit: 2 }
    const older = await service.browseMessages(olderQuery)
    expect(older.items.map(message => message.text)).toEqual(['Page item 2', 'Page item 3'])
    expect(older.items.some(message => newest.items.some(newer => newer.id === message.id))).toBe(false)
    expect(await service.browseMessages({ agentId: recipient.id, search: 'ITEM 3' })).toMatchObject({
      items: [{ id: sent[3]?.id, text: 'Page item 3' }],
      totalMatching: 1,
    })
    const lastSent = sent[5]
    if (lastSent === undefined) throw new Error('Expected six direct messages.')
    expect(await service.messageRecipients(lastSent.id)).toMatchObject({ recipients: [{ readAt: null, acknowledgedAt: null }] })
  })

  it('migrates old queued and steered records to passive delivery without replaying notifications', async () => {
    const path = await statePath()
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-recipient' }
    const messageId = 'd4a63b74-06d8-46f7-b97b-a43d1581b021'
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 2,
        messages: [
          {
            id: messageId,
            topic: null,
            sender,
            text: 'legacy message',
            priority: 'urgent',
            createdAt: now,
            recipients: [{ principal: recipient, delivery: 'steer', allowSteerFrom: [sender.id] }],
          },
        ],
        subscriptions: [
          { principal: recipient, topic: 'inbox', delivery: 'queue', allowSteerFrom: [], createdAt: now },
          { principal: recipient, topic: 'workspace/abc123', delivery: 'steer', allowSteerFrom: [sender.id], createdAt: now },
        ],
        acknowledgements: [],
        workspaceOptOuts: [],
        notifications: [{ messageId, agentId: recipient.id, notifiedAt: now }],
        activityStartedAt: now,
        activityEvents: [],
      }),
      { mode: 0o600 },
    )

    const service = createCommunicationService({ statePath: path, now: () => now })
    const inbox = await service.inbox({ principal: recipient, topic: 'inbox' })
    expect(inbox).toMatchObject([{ id: messageId, recipients: [{ delivery: 'passive', readAt: now }] }])
    expect(await service.listTopics()).toEqual([{ topic: 'workspace/abc123', subscribers: 1 }])

    const persisted: unknown = JSON.parse(await readFile(path, 'utf8'))
    expect(persisted).toMatchObject({
      schemaVersion: 4,
      messages: [{ id: messageId, recipients: [{ delivery: 'passive', readAt: now }] }],
      subscriptions: [{ principal: recipient, topic: 'workspace/abc123', delivery: 'passive' }],
    })
    expect(persisted).not.toHaveProperty('notifications')
  })

  it('migrates schema version 1 records to passive delivery without notification replay', async () => {
    const path = await statePath()
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-recipient' }
    const messageId = '7d46f641-e4d7-4b22-959f-2b52074fd1e0'
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        messages: [
          {
            id: messageId,
            topic: null,
            sender,
            text: 'schema-one message',
            priority: 'normal',
            createdAt: now,
            recipients: [{ principal: recipient, delivery: 'queue', allowSteerFrom: [] }],
          },
        ],
        subscriptions: [{ principal: recipient, topic: 'inbox', delivery: 'queue', allowSteerFrom: [], createdAt: now }],
        acknowledgements: [],
        workspaceOptOuts: [],
        notifications: [{ messageId, agentId: recipient.id, notifiedAt: now }],
      }),
      { mode: 0o600 },
    )

    const service = createCommunicationService({ statePath: path, now: () => now })
    const inbox = await service.inbox({ principal: recipient, topic: 'inbox' })
    expect(inbox).toMatchObject([{ id: messageId, recipients: [{ delivery: 'passive', readAt: now }] }])
    const persisted: unknown = JSON.parse(await readFile(path, 'utf8'))
    expect(persisted).toMatchObject({
      schemaVersion: 4,
      messages: [{ id: messageId, recipients: [{ delivery: 'passive', readAt: now }] }],
      subscriptions: [],
      activityStartedAt: null,
      activityEvents: [],
    })
    expect(persisted).not.toHaveProperty('notifications')
  })

  it('records intent and correlation metadata without changing passive delivery', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-recipient' }

    const notice = await service.send({ sender, toAgentId: recipient.id, text: 'Build finished.' })
    const request = await service.send({
      sender,
      toAgentId: recipient.id,
      text: 'Please review the build.',
      intent: 'request',
      correlationId: 'release-42',
    })

    expect(notice).toMatchObject({ intent: 'notice', correlationId: null, dedupeKey: null })
    expect(request).toMatchObject({
      intent: 'request',
      correlationId: 'release-42',
      recipients: [{ principal: recipient, delivery: 'passive', readAt: null }],
    })
    expect((await service.inbox({ principal: recipient })).map(message => message.id)).toEqual([notice.id, request.id])
  })

  it('returns the stored message for a repeated sender-scoped dedupe key instead of storing a duplicate', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-recipient' }

    const first = await service.send({ sender, toAgentId: recipient.id, text: 'Retry me.', dedupeKey: 'task-7-delivery' })
    const retry = await service.send({ sender, toAgentId: recipient.id, text: 'Retry me.', dedupeKey: 'task-7-delivery' })
    const otherSender = await service.send({
      sender: { kind: 'agent', id: 'agent-other' },
      toAgentId: recipient.id,
      text: 'Retry me.',
      dedupeKey: 'task-7-delivery',
    })
    const otherTarget = await service.send({ sender, toAgentId: 'agent-third', text: 'Retry me.', dedupeKey: 'task-7-delivery' })
    const noKey = await service.send({ sender, toAgentId: recipient.id, text: 'Retry me.' })

    expect(retry.id).toBe(first.id)
    expect(otherSender.id).not.toBe(first.id)
    expect(otherTarget.id).not.toBe(first.id)
    expect(noKey.id).not.toBe(first.id)
    expect(await service.browseMessages({ agentId: recipient.id })).toMatchObject({ totalMatching: 3 })
  })

  it('migrates schema version 3 messages to notice intent without replaying them', async () => {
    const path = await statePath()
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-recipient' }
    const messageId = '0e1f3b8c-3f2a-4c8e-9a5d-8f0b1c2d3e4f'
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 3,
        messages: [
          {
            id: messageId,
            topic: null,
            sender,
            text: 'schema-three message',
            priority: 'normal',
            createdAt: now,
            recipients: [{ principal: recipient, delivery: 'passive', readAt: null }],
          },
        ],
        subscriptions: [{ principal: recipient, topic: 'inbox', delivery: 'passive', createdAt: now }],
        acknowledgements: [],
        workspaceOptOuts: [],
        activityStartedAt: null,
        activityEvents: [],
      }),
      { mode: 0o600 },
    )

    const service = createCommunicationService({ statePath: path, now: () => now })
    expect(await service.inbox({ principal: recipient, topic: 'inbox' })).toMatchObject([
      { id: messageId, intent: 'notice', correlationId: null, dedupeKey: null },
    ])
    const persisted: unknown = JSON.parse(await readFile(path, 'utf8'))
    expect(persisted).toMatchObject({
      schemaVersion: 4,
      messages: [{ id: messageId, intent: 'notice', correlationId: null, dedupeKey: null }],
    })
  })

  it('serializes concurrent sends without losing or duplicating messages', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-recipient' }

    const sent = await Promise.all(Array.from({ length: 12 }, (_, index) => service.send({ sender, toAgentId: recipient.id, text: `message ${index}` })))
    const inbox = await service.inbox({ principal: recipient })

    expect(new Set(sent.map(message => message.id)).size).toBe(12)
    expect(inbox.map(message => message.id)).toEqual(sent.map(message => message.id))
  })

  it('registers a new Agent on a full topic by evicting the stalest subscriber', async () => {
    const path = await statePath()
    const topic = 'workspace/shared'
    const subscribers = Array.from({ length: 512 }, (_, index) => ({
      principal: { kind: 'agent', id: `session-${index}` },
      topic,
      delivery: 'passive',
      createdAt: now + index,
    }))
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 4,
        messages: [],
        subscriptions: subscribers,
        acknowledgements: [],
        workspaceOptOuts: [],
        activityStartedAt: null,
        // `session-0` is the oldest row but the most recently active, so the next stalest row goes instead.
        activityEvents: [
          {
            id: '9f1c0a3e-5d2b-4c47-9a1e-3b8f2d6c4e10',
            principal: { kind: 'agent', id: 'session-0' },
            operation: 'dshx_comm_inbox',
            outcome: 'success',
            occurredAt: now + 1_000,
            durationMs: 4,
            callId: 'inbox-call',
            rootCallId: null,
            errorCode: null,
          },
        ],
      }),
      { mode: 0o600 },
    )

    const service = createCommunicationService({ statePath: path, now: () => now })
    await expect(service.subscribe({ kind: 'agent', id: 'session-explicit' }, { topic })).rejects.toMatchObject({ code: 'topic-full' })
    await service.ensureSubscription({ kind: 'agent', id: 'session-new' }, { topic, delivery: 'passive' })

    expect(await service.listTopics()).toEqual([{ topic, subscribers: 512 }])
    const persisted = JSON.parse(await readFile(path, 'utf8')) as { readonly subscriptions: readonly { readonly principal: { readonly id: string } }[] }
    const ids = persisted.subscriptions.map(entry => entry.principal.id)
    expect(ids).toContain('session-new')
    expect(ids).toContain('session-0')
    expect(ids).not.toContain('session-1')
  })

  it('stores no subscription row for the private inbox', async () => {
    const path = await statePath()
    const service = createCommunicationService({ statePath: path, now: () => now })
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-recipient' }

    await service.ensureSubscription(recipient, { topic: 'inbox', delivery: 'passive' })
    await service.send({ sender: { kind: 'agent', id: 'agent-sender' }, toAgentId: recipient.id, text: 'Still delivered.' })

    const persisted = JSON.parse(await readFile(path, 'utf8')) as { readonly subscriptions: readonly unknown[] }
    expect(persisted.subscriptions).toEqual([])
    expect(await service.inbox({ principal: recipient })).toMatchObject([{ recipients: [{ delivery: 'passive', readAt: now }] }])
  })

  it('counts only messages an inbox read has not already opened', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-recipient' }

    const first = await service.send({ sender, toAgentId: recipient.id, text: 'First.' })
    await service.send({ sender, toAgentId: recipient.id, text: 'Second.' })
    expect(await service.unreadCount(recipient)).toBe(2)
    expect(await service.unreadCount(sender)).toBe(0)

    await service.inbox({ principal: recipient, limit: 1 })
    expect(await service.unreadCount(recipient)).toBe(1)

    await service.acknowledge(recipient, first.id)
    expect(await service.unreadCount(recipient)).toBe(0)
  })

  it('re-reads state another process wrote instead of serving its cached copy', async () => {
    const path = await statePath()
    const service = createCommunicationService({ statePath: path, now: () => now })
    const otherProcess = createCommunicationService({ statePath: path, now: () => now })

    await service.ensureSubscription({ kind: 'agent', id: 'agent-first' }, { topic: 'workspace/shared', delivery: 'passive' })
    expect(await service.listTopics()).toEqual([{ topic: 'workspace/shared', subscribers: 1 }])

    await otherProcess.ensureSubscription({ kind: 'agent', id: 'agent-second' }, { topic: 'workspace/shared', delivery: 'passive' })

    expect(await service.listTopics()).toEqual([{ topic: 'workspace/shared', subscribers: 2 }])
  })
})
