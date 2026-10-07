import { describe, expect, it } from 'vitest'
import {
  createParentFeedbackService,
  type ParentFeedbackAgent,
  type ParentFeedbackRuntime,
} from './revisioned-feedback.js'
import type { MarkdownFeedbackAnchor, RevisionedFeedbackRecord, RevisionedFeedbackTable } from './store.js'

const root: ParentFeedbackAgent = { id: 'root-session' }
const firstChild: ParentFeedbackAgent = { id: 'child-session-a' }
const secondChild: ParentFeedbackAgent = { id: 'child-session-b' }
const unrelatedAgent: ParentFeedbackAgent = { id: 'unrelated-session' }
const firstRevision = 'a'.repeat(64)
const changedRevision = 'b'.repeat(64)

const createMemoryTable = (): RevisionedFeedbackTable => {
  const records = new Map<string, RevisionedFeedbackRecord>()
  return {
    get: key => records.get(key),
    entries: () => new Map(records).entries(),
    keys: () => new Map(records).keys(),
    get size() {
      return records.size
    },
    put: async (key, record) => {
      records.set(key, record)
    },
    delete: async key => records.delete(key),
    update: async (key, transform) => {
      const current = records.get(key)
      if (current === undefined) throw new Error(`Feedback row ${key} is missing.`)
      const updated = transform(current)
      records.set(key, updated)
      return updated
    },
  }
}

const createRuntime = () => {
  const liveAgents = new Map<string, ParentFeedbackAgent>([
    [root.id, root],
    [firstChild.id, firstChild],
    [secondChild.id, secondChild],
    [unrelatedAgent.id, unrelatedAgent],
  ])
  const parentByChild = new Map([
    [firstChild.id, root.id],
    [secondChild.id, root.id],
  ])
  const revisions = new Map<string, string | null>()
  const parentMessages: string[] = []
  const childMessages: string[] = []
  const keyFor = (childId: string, path: string): string => `${childId}:${path}`
  const runtime: ParentFeedbackRuntime = {
    isLive: agent => liveAgents.get(agent.id) === agent,
    parentSessionId: childId => parentByChild.get(childId),
    isDirectChild: (childId, parentId) =>
      liveAgents.has(childId) && liveAgents.has(parentId) && parentByChild.get(childId) === parentId,
    currentRevision: async ({ childSessionId, path }) => revisions.get(keyFor(childSessionId, path)) ?? null,
    sendToParent: async ({ record, signal }) => {
      signal.throwIfAborted()
      parentMessages.push(record.feedbackId)
      return `parent-message-${record.feedbackId}`
    },
    sendToChild: async ({ parentSessionId, childSessionId, record, signal }) => {
      signal.throwIfAborted()
      if (!liveAgents.has(parentSessionId) || parentByChild.get(childSessionId) !== parentSessionId) {
        throw new Error('The direct child is unavailable.')
      }
      childMessages.push(record.feedbackId)
    },
  }
  return {
    runtime,
    parentMessages,
    childMessages,
    setRevision: (childId: string, path: string, revision: string | null) => {
      revisions.set(keyFor(childId, path), revision)
    },
    stopAgent: (agentId: string) => liveAgents.delete(agentId),
    resumeAgent: (agent: ParentFeedbackAgent) => liveAgents.set(agent.id, agent),
  }
}

const anchorFor = (revision = firstRevision): MarkdownFeedbackAnchor => ({
  kind: 'markdown',
  path: 'docs/guide.md',
  revision,
  startLine: 12,
  endLine: 14,
  excerpt: '12. Keep the first sentence.\n13. Keep the second sentence.\n14. Keep the third sentence.',
})

const makeService = (table: RevisionedFeedbackTable, runtime: ParentFeedbackRuntime) =>
  createParentFeedbackService({ table: async () => table, runtime, now: () => 1_000 })

const submit = (service: ReturnType<typeof makeService>, input: {
  readonly agent?: ParentFeedbackAgent
  readonly operationId?: string
  readonly anchor?: MarkdownFeedbackAnchor
  readonly comment?: string
}) => service.submit({
  agent: input.agent ?? firstChild,
  operationId: input.operationId ?? 'call-1',
  anchor: input.anchor ?? anchorFor(),
  comment: input.comment ?? 'Clarify the recovery behavior.',
  signal: new AbortController().signal,
})

const answerMany = (
  service: ReturnType<typeof makeService>,
  agent: ParentFeedbackAgent,
  responses: readonly { readonly feedbackId: string; readonly disposition: 'accepted' | 'rejected' | 'deferred'; readonly note?: string }[],
) => service.answerMany({ agent, responses, signal: new AbortController().signal })

describe('revisioned Markdown feedback', () => {
  it('stores an exact direct-parent request and deduplicates the parent wakeup', async () => {
    const table = createMemoryTable()
    const runtime = createRuntime()
    runtime.setRevision(firstChild.id, 'docs/guide.md', firstRevision)
    const service = makeService(table, runtime.runtime)

    const first = await submit(service, {})
    const duplicate = await submit(service, {})

    expect(first.feedbackId).toBe(duplicate.feedbackId)
    expect(first.status).toBe('pending')
    expect(first.notificationMessageId).toBe(`parent-message-${first.feedbackId}`)
    expect(runtime.parentMessages).toEqual([first.feedbackId])
    await expect(service.read({ agent: secondChild, feedbackId: first.feedbackId })).rejects.toThrow(/Only the requesting direct child/)
  })

  it('records batch resolutions with current or stale revision receipts', async () => {
    const table = createMemoryTable()
    const runtime = createRuntime()
    runtime.setRevision(firstChild.id, 'docs/guide.md', firstRevision)
    runtime.setRevision(secondChild.id, 'docs/guide.md', firstRevision)
    const service = makeService(table, runtime.runtime)
    const current = await submit(service, { operationId: 'current' })
    const stale = await submit(service, { agent: secondChild, operationId: 'stale' })
    runtime.setRevision(secondChild.id, 'docs/guide.md', changedRevision)

    const results = await answerMany(service, root, [
        { feedbackId: current.feedbackId, disposition: 'accepted', note: 'Apply after review.' },
        { feedbackId: stale.feedbackId, disposition: 'accepted', note: 'Apply after review.' },
    ])

    expect(results).toEqual([
      { feedbackId: current.feedbackId, status: 'resolved', notified: true },
      { feedbackId: stale.feedbackId, status: 'stale', notified: true },
    ])
    expect((await service.read({ agent: firstChild, feedbackId: current.feedbackId })).resolutionReceipt).toMatchObject({
      baseRevision: firstRevision,
      observedRevision: firstRevision,
      disposition: 'accepted',
    })
    expect((await service.read({ agent: secondChild, feedbackId: stale.feedbackId })).resolutionReceipt).toMatchObject({
      baseRevision: firstRevision,
      observedRevision: changedRevision,
      disposition: 'accepted',
    })
    expect(runtime.childMessages).toEqual([current.feedbackId, stale.feedbackId])
  })

  it('turns a previously current receipt stale if the document changes before retrieval', async () => {
    const table = createMemoryTable()
    const runtime = createRuntime()
    runtime.setRevision(firstChild.id, 'docs/guide.md', firstRevision)
    const service = makeService(table, runtime.runtime)
    const record = await submit(service, {})
    await answerMany(service, root, [{ feedbackId: record.feedbackId, disposition: 'rejected', note: 'Keep the existing text.' }])

    runtime.setRevision(firstChild.id, 'docs/guide.md', changedRevision)
    const refreshed = await service.read({ agent: firstChild, feedbackId: record.feedbackId })

    expect(refreshed.status).toBe('stale')
    expect(refreshed.resolutionReceipt).toMatchObject({
      baseRevision: firstRevision,
      observedRevision: changedRevision,
    })
  })

  it('deduplicates concurrent parent resolutions and child wakeups', async () => {
    const table = createMemoryTable()
    const runtime = createRuntime()
    runtime.setRevision(firstChild.id, 'docs/guide.md', firstRevision)
    const service = makeService(table, runtime.runtime)
    const record = await submit(service, {})
    const response = [{ feedbackId: record.feedbackId, disposition: 'accepted' as const }]

    const results = await Promise.all([
      answerMany(service, root, response),
      answerMany(service, root, response),
    ])

    expect(results.flat()).toEqual([
      { feedbackId: record.feedbackId, status: 'resolved', notified: true },
      { feedbackId: record.feedbackId, status: 'resolved', notified: false },
    ])
    expect(runtime.childMessages).toEqual([record.feedbackId])
  })

  it('resolves after child shutdown and lets the reattached child retrieve the durable receipt', async () => {
    const table = createMemoryTable()
    const runtime = createRuntime()
    runtime.setRevision(firstChild.id, 'docs/guide.md', firstRevision)
    const firstService = makeService(table, runtime.runtime)
    const record = await submit(firstService, {})
    await firstService.close()
    runtime.stopAgent(firstChild.id)
    const resumedService = makeService(table, runtime.runtime)

    const result = await answerMany(resumedService, root, [{ feedbackId: record.feedbackId, disposition: 'deferred' }])

    expect(result).toEqual([{ feedbackId: record.feedbackId, status: 'resolved', notified: true }])
    runtime.resumeAgent(firstChild)
    expect((await resumedService.read({ agent: firstChild, feedbackId: record.feedbackId })).resolutionReceipt)
      .toMatchObject({ disposition: 'deferred', baseRevision: firstRevision, observedRevision: firstRevision })
  })

  it('rejects a changed document before admission and a conflicting late resolution', async () => {
    const table = createMemoryTable()
    const runtime = createRuntime()
    runtime.setRevision(firstChild.id, 'docs/guide.md', changedRevision)
    const service = makeService(table, runtime.runtime)

    await expect(submit(service, {})).rejects.toThrow(/changed before feedback/)
    runtime.setRevision(firstChild.id, 'docs/guide.md', firstRevision)
    const record = await submit(service, {})
    await answerMany(service, root, [{ feedbackId: record.feedbackId, disposition: 'accepted' }])
    const conflicting = await answerMany(service, root, [{ feedbackId: record.feedbackId, disposition: 'rejected' }])

    expect(conflicting).toEqual([{ feedbackId: record.feedbackId, status: 'rejected', notified: false }])
  })

  it('lets only the direct parent resolve and the owning child cancel pending feedback', async () => {
    const table = createMemoryTable()
    const runtime = createRuntime()
    runtime.setRevision(firstChild.id, 'docs/guide.md', firstRevision)
    const service = makeService(table, runtime.runtime)
    const record = await submit(service, {})

    const unauthorized = await answerMany(service, unrelatedAgent, [
      { feedbackId: record.feedbackId, disposition: 'accepted' },
    ])
    expect(unauthorized).toEqual([{ feedbackId: record.feedbackId, status: 'rejected', notified: false }])

    const cancelled = await service.cancel({ agent: firstChild, feedbackId: record.feedbackId })
    expect(cancelled.status).toBe('cancelled')
    expect((await answerMany(service, root, [{ feedbackId: record.feedbackId, disposition: 'accepted' }]))[0]?.status)
      .toBe('rejected')
  })
})
