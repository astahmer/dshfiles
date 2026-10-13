import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { communicationActivity, communicationMessage, integrationActivity, sessionActivity } from './adapters.js'
import { condenseEvents } from './condensation.js'
import { createActivityTimelineService } from './service.js'
import type { ActivityIngest } from './types.js'

const temporaryRoots: string[] = []
const now = 1_800_000_000_000

const statePath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'activity-timeline-'))
  temporaryRoots.push(root)
  return join(root, 'state.json')
}

const routine = (index: number, at: number, sessionId = 'session-a', correlationId?: string): ActivityIngest => ({
  id: `routine-${String(index)}`,
  at,
  source: 'communication',
  type: 'communication.activity',
  level: 'routine',
  sessionId,
  ...(correlationId === undefined ? {} : { correlationId }),
  summary: `read ${String(index)}`,
  metadata: {},
  references: [],
  provenance: 'observed',
})

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('activity timeline service', () => {
  it('interleaves events from multiple agents in chronological order', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await service.ingestMany([routine(1, now + 300, 'session-b'), routine(2, now + 100, 'session-a'), routine(3, now + 200, 'session-c')])
    const page = await service.page({ detailed: true })
    expect(page.items.map(item => item.sessionId)).toEqual(['session-a', 'session-c', 'session-b'])
    expect(page.items.map(item => item.at)).toEqual([now + 100, now + 200, now + 300])
  })

  it('deduplicates repeated delivery of the same event id', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    const first = await service.ingest(routine(1, now))
    const second = await service.ingest(routine(1, now))
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    const stats = await service.stats()
    expect(stats.retained).toBe(1)
    expect(stats.duplicates).toBe(1)
  })

  it('orders out-of-order timestamps and preserves references', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await service.ingest(
      integrationActivity({
        id: 'evt-2',
        at: now + 500,
        type: 'integration.completed',
        workspaceId: 'workspace-1',
        sessionId: 'session-a',
        candidateId: 'candidate-1',
        correlationId: 'corr-1',
        detail: 'Integrated as abc123',
        outcome: 'integrated',
      }),
    )
    await service.ingest(sessionActivity({ kind: 'created', at: now + 100, sessionId: 'session-a' }))
    const page = await service.page({ detailed: true })
    expect(page.items.map(item => item.type)).toEqual(['session.started', 'integration.completed'])
    expect(page.items[1]?.references.map(reference => reference.kind)).toEqual(['integration-candidate', 'workspace'])
  })

  it('replays retained history after a coordinator restart', async () => {
    const path = await statePath()
    const first = createActivityTimelineService({ statePath: path, now: () => now })
    await first.ingestMany([routine(1, now), routine(2, now + 1)])
    const restarted = createActivityTimelineService({ statePath: path, now: () => now })
    const page = await restarted.page({ detailed: true })
    expect(page.totalRetained).toBe(2)
    expect(page.items).toHaveLength(2)
  })

  it('paginates history newest-first with an older cursor', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await service.ingestMany(Array.from({ length: 200 }, (_, index) => routine(index, now + index)))
    const newest = await service.page({ limit: 60, detailed: true })
    expect(newest.items).toHaveLength(60)
    expect(newest.hasMore).toBe(true)
    expect(newest.nextCursor).not.toBeNull()
    expect(newest.items[59]?.at).toBe(now + 199)
    const older = await service.page({ limit: 60, detailed: true, ...(newest.nextCursor === null ? {} : { cursor: newest.nextCursor }) })
    expect(older.items[older.items.length - 1]?.at).toBe(now + 139)
    const seen = new Set([...newest.items, ...older.items].map(item => item.id))
    expect(seen.size).toBe(120)
  })

  it('condenses routine runs and keeps attention events individual', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await service.ingestMany([
      routine(1, now, 'session-a'),
      routine(2, now + 1, 'session-a'),
      routine(3, now + 2, 'session-a'),
      sessionActivity({ kind: 'error', at: now + 3, sessionId: 'session-a', detail: 'boom' }),
      routine(4, now + 4, 'session-a'),
    ])
    const condensed = await service.page({})
    const group = condensed.items.find(item => item.kind === 'group')
    expect(group?.count).toBe(3)
    expect(group?.eventIds).toHaveLength(3)
    expect(condensed.items.some(item => item.level === 'attention' && item.type === 'session.error')).toBe(true)
    const detailed = await service.page({ detailed: true })
    expect(detailed.items).toHaveLength(5)
  })

  it('groups correlated events and expands to their ids', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await service.ingestMany([
      { ...routine(1, now, 'session-a', 'corr-9'), level: 'notable' },
      { ...routine(2, now + 1, 'session-a', 'corr-9'), level: 'notable' },
    ])
    const page = await service.page({})
    const group = page.items.find(item => item.correlationId === 'corr-9')
    expect(group?.count).toBe(2)
    expect(group?.eventIds).toHaveLength(2)
  })

  it('exposes attention events even when routine events are condensed away', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await service.ingestMany([
      routine(1, now, 'session-a'),
      integrationActivity({
        id: 'evt-block',
        at: now + 1,
        type: 'integration.blocked',
        workspaceId: 'ws-1',
        sessionId: 'session-a',
        candidateId: 'cand-1',
        correlationId: null,
        detail: 'conflict in shared.txt',
        outcome: 'blocked',
      }),
      routine(2, now + 2, 'session-a'),
    ])
    const page = await service.page({})
    expect(page.items.some(item => item.type === 'integration.blocked')).toBe(true)
    const attention = await service.attention()
    expect(attention.map(event => event.type)).toEqual(['integration.blocked'])
  })

  it('filters and searches without scanning the whole history on the client', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await service.ingestMany([
      sessionActivity({ kind: 'created', at: now, sessionId: 'session-a' }),
      communicationMessage({
        at: now + 1,
        messageId: 'message-1',
        senderId: 'session-a',
        recipientCount: 1,
        intent: 'request',
        topic: null,
        sessionId: 'session-a',
      }),
      integrationActivity({
        id: 'evt-1',
        at: now + 2,
        type: 'integration.completed',
        workspaceId: 'ws-1',
        sessionId: 'session-b',
        candidateId: 'cand-1',
        correlationId: null,
        detail: 'Integrated as abc123',
        outcome: 'integrated',
      }),
    ])
    const bySource = await service.page({ sources: ['communication'], detailed: true })
    expect(bySource.items.map(item => item.type)).toEqual(['communication.message'])
    const bySession = await service.page({ sessionId: 'session-b', detailed: true })
    expect(bySession.items.map(item => item.type)).toEqual(['integration.completed'])
    const bySearch = await service.page({ search: 'integrated', detailed: true })
    expect(bySearch.items.map(item => item.type)).toEqual(['integration.completed'])
    const noMatch = await service.page({ search: 'nothing-matches' })
    expect(noMatch.items).toHaveLength(0)
  })

  // Heavy by design: every ingest durably rewrites the whole state document. The budget absorbs a
  // fully parallel workspace run, and the size bound still fails a window that stops trimming.
  it('keeps a bounded in-memory window under high volume', { timeout: 30_000 }, async () => {
    const path = await statePath()
    const service = createActivityTimelineService({ statePath: path, now: () => now, maxEvents: 500 })
    const events = Array.from({ length: 1200 }, (_, index) => routine(index, now + index))
    await service.ingestMany(events.slice(0, 600))
    const filledBytes = (await stat(path)).size
    await service.ingestMany(events.slice(600))
    const stats = await service.stats()
    expect(stats.retained).toBe(500)
    expect(stats.ingested).toBe(1200)
    const page = await service.page({ limit: 200, detailed: true })
    expect(page.items).toHaveLength(200)
    expect(page.totalRetained).toBe(500)
    // The window trims instead of accumulating: the document does not grow with the ingested total.
    expect((await stat(path)).size).toBeLessThan(filledBytes * 1.5)
  })

  it('does not require any agent, session, or jj source to be present', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    const page = await service.page({})
    expect(page.items).toHaveLength(0)
    expect(page.totalRetained).toBe(0)
    const stats = await service.stats()
    expect(stats.sources).toEqual({})
  })

  it('rejects malformed ingest payloads instead of storing them', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await expect(service.ingest({ id: '', at: now, source: 'session', type: 'x', summary: 'x' } as ActivityIngest)).rejects.toThrow()
    expect((await service.stats()).retained).toBe(0)
  })
})

describe('activity condensation primitives', () => {
  it('is deterministic and traceable to underlying event ids', () => {
    const events = [routine(1, now, 'session-a'), routine(2, now + 1, 'session-a')].map(input => ({
      id: input.id,
      at: input.at,
      source: input.source,
      type: input.type,
      level: input.level ?? 'routine',
      sessionId: input.sessionId ?? null,
      workspaceId: null,
      taskId: null,
      correlationId: null,
      causationId: null,
      summary: input.summary,
      detail: null,
      metadata: {},
      references: [],
      provenance: 'observed' as const,
    }))
    const first = condenseEvents(events)
    const second = condenseEvents(events)
    expect(first).toEqual(second)
    expect(first[0]?.eventIds).toEqual(['routine-1', 'routine-2'])
    expect(condenseEvents(events, { detailed: true })).toHaveLength(2)
  })

  it('maps adapters with authoritative levels', () => {
    expect(sessionActivity({ kind: 'error', at: now, sessionId: 's' }).level).toBe('attention')
    expect(communicationActivity({ at: now, sessionId: 's', operation: 'dshx_comm_inbox', outcome: 'failure', callId: 'c1', rootCallId: null }).level).toBe(
      'attention',
    )
    expect(communicationMessage({ at: now, messageId: 'm1', senderId: 's', recipientCount: 2, intent: 'request', topic: null }).level).toBe('notable')
    expect(
      integrationActivity({
        id: 'e',
        at: now,
        type: 'integration.completed',
        workspaceId: null,
        sessionId: null,
        candidateId: null,
        correlationId: null,
        detail: null,
        outcome: 'integrated',
      }).level,
    ).toBe('routine')
  })
})
