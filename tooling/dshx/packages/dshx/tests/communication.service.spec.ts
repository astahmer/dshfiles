import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCommunicationService } from '../src/communication/service.js'
import { decodeJson } from '../src/json.js'
import type { CommunicationPrincipal } from '../src/communication/types.js'

const temporaryRoots: string[] = []
const now = 1_800_000_000_000

const statePath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-communication-'))
  temporaryRoots.push(root)
  return join(root, 'state.json')
}

const persistedRecipientSchema = Schema.Struct({ delivery: Schema.String, readAt: Schema.optionalKey(Schema.NullOr(Schema.Number)) })

/** The persisted file is a boundary this suite asserts on, so decode it instead of casting a parse result. */
const persistedStateSchema = Schema.Struct({
  schemaVersion: Schema.Number,
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      intent: Schema.optionalKey(Schema.String),
      correlationId: Schema.optionalKey(Schema.NullOr(Schema.String)),
      dedupeKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
      recipients: Schema.Array(persistedRecipientSchema),
    }),
  ),
  subscriptions: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        principal: Schema.Struct({ kind: Schema.String, id: Schema.String }),
        topic: Schema.String,
        delivery: Schema.String,
      }),
    ),
  ),
  acknowledgements: Schema.optionalKey(Schema.Array(Schema.Struct({ messageId: Schema.String }))),
  notifications: Schema.optionalKey(Schema.Array(Schema.Json)),
  activityStartedAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  activityEvents: Schema.optionalKey(Schema.Array(Schema.Json)),
})
type PersistedState = Schema.Schema.Type<typeof persistedStateSchema>

const readPersistedState = async (path: string): Promise<PersistedState> => decodeJson(persistedStateSchema, await readFile(path, 'utf8'))

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

  it('keeps direct messages available after reopen until the recipient acknowledges them', async () => {
    const path = await statePath()
    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-parent' }
    const recipient: CommunicationPrincipal = { kind: 'agent', id: 'agent-child' }
    const service = createCommunicationService({ statePath: path, now: () => now })
    const message = await service.send({ sender, toAgentId: recipient.id, text: 'line one\n@agent: forged inbox line' })

    expect(await service.inbox({ principal: recipient })).toMatchObject([
      { id: message.id, recipients: [{ principal: recipient, delivery: 'passive', readAt: now }] },
    ])

    const reopened = createCommunicationService({ statePath: path, now: () => now })
    // A plain read returns only messages not shown yet; an earlier, un-acknowledged one comes back with includeSeen.
    expect(await reopened.inbox({ principal: recipient })).toEqual([])
    expect(await reopened.inbox({ principal: recipient, includeSeen: true })).toMatchObject([{ id: message.id }])
    expect(await reopened.acknowledge(recipient, message.id)).toEqual({ acknowledged: true })
    expect(await reopened.acknowledge(recipient, message.id)).toEqual({ acknowledged: false })
    expect(await reopened.inbox({ principal: recipient, includeSeen: true })).toEqual([])
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
    const inbox = await service.inbox({ principal: recipient })
    expect(inbox).toMatchObject([{ id: messageId, recipients: [{ delivery: 'passive', readAt: now }] }])

    const persisted = await readPersistedState(path)
    expect(persisted).toMatchObject({
      schemaVersion: 5,
      messages: [{ id: messageId, recipients: [{ delivery: 'passive', readAt: now }] }],
      activityStartedAt: now,
      activityEvents: [],
    })
    expect(persisted).not.toHaveProperty('notifications')
    expect(persisted).not.toHaveProperty('subscriptions')
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
    const inbox = await service.inbox({ principal: recipient })
    expect(inbox).toMatchObject([{ id: messageId, recipients: [{ delivery: 'passive', readAt: now }] }])
    const persisted = await readPersistedState(path)
    expect(persisted).toMatchObject({
      schemaVersion: 5,
      messages: [{ id: messageId, recipients: [{ delivery: 'passive', readAt: now }] }],
      activityStartedAt: null,
      activityEvents: [],
    })
    expect(persisted).not.toHaveProperty('notifications')
    expect(persisted).not.toHaveProperty('subscriptions')
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
    expect(await service.inbox({ principal: recipient })).toMatchObject([{ id: messageId, intent: 'notice', correlationId: null, dedupeKey: null }])
    const persisted = await readPersistedState(path)
    expect(persisted).toMatchObject({
      schemaVersion: 5,
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

  it('reads many principals in one pass with the same counts as one at a time', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })
    const first: CommunicationPrincipal = { kind: 'agent', id: 'agent-first' }
    const second: CommunicationPrincipal = { kind: 'agent', id: 'agent-second' }
    const quiet: CommunicationPrincipal = { kind: 'agent', id: 'agent-quiet' }

    await service.send({ sender: second, toAgentId: first.id, text: 'For the first agent.' })
    const acknowledged = await service.send({ sender: first, toAgentId: second.id, text: 'For the second agent.' })
    await service.send({ sender: first, toAgentId: second.id, text: 'A second one for the second agent.' })
    await service.acknowledge(second, acknowledged.id)

    const bulk = await service.unreadCounts([first, second, quiet])
    expect(bulk.map(entry => [entry.principal.id, entry.count])).toEqual([
      ['agent-first', 1],
      ['agent-second', 1],
      ['agent-quiet', 0],
    ])
    for (const entry of bulk) expect(entry.count).toBe(await service.unreadCount(entry.principal))
    expect(await service.unreadCounts([])).toEqual([])
    // The batch result equals the per-principal read, duplicates included.
    expect((await service.unreadCounts([quiet, quiet])).map(entry => entry.count)).toEqual([0, 0])
  })

  it('writes a telemetry burst as one state update and resolves only after it is durable', async () => {
    const path = await statePath()
    const service = createCommunicationService({ statePath: path, now: () => now })
    const writes = vi.spyOn(service, 'recordActivities')
    const activity = (index: number) => ({
      principal: { kind: 'agent' as const, id: 'agent-telemetry' },
      operation: 'dshx_comm_inbox' as const,
      outcome: 'success' as const,
      occurredAt: now + index,
      durationMs: index,
      callId: `call-${String(index)}`,
    })

    await Promise.all(Array.from({ length: 25 }, (_unused, index) => service.enqueueActivity(activity(index))))
    expect(writes).toHaveBeenCalledTimes(1)
    expect(writes.mock.calls[0]?.[0]).toHaveLength(25)
    const persisted = await readPersistedState(path)
    expect(persisted.activityEvents).toHaveLength(25)

    // A single record is durable by the time its promise settles, and a drain stores what is still buffered.
    const buffered = service.enqueueActivity(activity(30))
    await service.drainActivity()
    await buffered
    expect((await readPersistedState(path)).activityEvents).toHaveLength(26)
  })

  it('rejects every caller whose telemetry batch failed to flush', async () => {
    const service = createCommunicationService({ statePath: await statePath(), now: () => now })
    vi.spyOn(service, 'recordActivities').mockRejectedValue(new Error('disk full'))
    await expect(
      service.enqueueActivity({
        principal: { kind: 'agent', id: 'agent-telemetry' },
        operation: 'dshx_comm_send',
        outcome: 'success',
        occurredAt: now,
        durationMs: 1,
        callId: 'call-1',
      }),
    ).rejects.toThrow('disk full')
  })

  it('re-reads state another process wrote instead of serving its cached copy', async () => {
    const path = await statePath()
    const service = createCommunicationService({ statePath: path, now: () => now })
    const otherProcess = createCommunicationService({ statePath: path, now: () => now })

    const sender: CommunicationPrincipal = { kind: 'agent', id: 'agent-sender' }
    await service.send({ sender, toAgentId: 'agent-first', text: 'first' })
    expect((await service.diagnostics({ agents: [] })).messageCount).toBe(1)

    await otherProcess.send({ sender, toAgentId: 'agent-second', text: 'second' })

    expect((await service.diagnostics({ agents: [] })).messageCount).toBe(2)
  })
})
