import { describe, expect, it } from 'vitest'
import { createAnnotationStore } from '../src/store.js'
import type { AnnotationDraft, AnnotationTarget } from '../src/schema.js'
import { fakeTable } from './fake-table.js'

const target: AnnotationTarget = {
  surface: 'dsh',
  url: 'http://127.0.0.1:3080/',
  selector: 'button.primary',
  tag: 'button',
  text: 'Rebase',
  rect: { x: 0, y: 0, width: 10, height: 10 },
}

const draft = (note = 'note'): AnnotationDraft => ({ kind: 'element', target, note })

const setup = () => {
  let clock = 1_000
  const store = createAnnotationStore({
    annotations: fakeTable(),
    unassigned: fakeTable(),
    meta: fakeTable(),
    now: () => {
      clock += 1
      return clock
    },
    reportError: error => {
      throw error
    },
  })
  return store
}

const sessionId = 'session-1'

describe('annotation store', () => {
  it('creates a pending annotation with a stable id', async () => {
    const store = setup()
    const created = await store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
    if (!created.ok) throw new Error('create failed')
    expect(created.value).toHaveLength(1)
    expect(created.value[0]?.id).toBe('ann_1')
    expect(created.value[0]?.status).toBe('pending')
    expect(created.value[0]?.revision).toBe(1)
    const second = await store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
    if (!second.ok) throw new Error('create failed')
    expect(second.value[0]?.id).toBe('ann_2')
  })

  it('acknowledges only open annotations', async () => {
    const store = setup()
    await store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
    const acked = await store.ack({ sessionId, ids: ['ann_1'] })
    if (!acked.ok) throw new Error('ack failed')
    expect(acked.value[0]?.status).toBe('acknowledged')
    expect(acked.value[0]?.revision).toBeGreaterThan(1)
    const again = await store.ack({ sessionId, ids: ['ann_1'] })
    if (!again.ok) throw new Error('ack failed')
    expect(again.value).toHaveLength(0)
  })

  it('refuses to resolve a stale revision', async () => {
    const store = setup()
    const created = await store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
    if (!created.ok) throw new Error('create failed')
    const record = created.value[0]
    if (record === undefined) throw new Error('missing record')
    const resolved = await store.resolve({ sessionId, id: record.id, revision: record.revision, summary: 'fixed', resolvedBy: 'agent' })
    if (!resolved.ok) throw new Error('resolve failed')
    expect(resolved.value.status).toBe('resolved')
    expect(resolved.value.resolvedBy).toBe('agent')
    expect(resolved.value.resolution?.summary).toBe('fixed')
    const again = await store.resolve({ sessionId, id: record.id, revision: record.revision, resolvedBy: 'agent' })
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.error).toBe('revision')
  })

  it('dismisses once and refuses a second dismiss', async () => {
    const store = setup()
    await store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
    const dismissed = await store.dismiss({ sessionId, id: 'ann_1', reason: 'wont fix' })
    if (!dismissed.ok) throw new Error('dismiss failed')
    expect(dismissed.value.status).toBe('dismissed')
    expect(dismissed.value.thread.at(-1)?.body).toContain('wont fix')
    const again = await store.dismiss({ sessionId, id: 'ann_1', reason: 'again' })
    expect(again.ok).toBe(false)
  })

  it('marks an element stale without resolving it', async () => {
    const store = setup()
    await store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
    const stale = await store.markStale({ sessionId, id: 'ann_1', reason: 'element-missing' })
    if (!stale.ok) throw new Error('stale failed')
    expect(stale.value.status).toBe('stale')
    expect(stale.value.target.staleReason).toBe('element-missing')
    expect(store.counts(sessionId).stale).toBe(1)
  })

  it('keeps sessions apart', async () => {
    const store = setup()
    await store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
    await store.create({ sessionId: 'session-2', drafts: [draft(), draft()], origin: 'dsh' })
    expect(store.list({ sessionId })).toHaveLength(1)
    expect(store.list({ sessionId: 'session-2' })).toHaveLength(2)
    expect(store.list({ sessionId: 'session-3' })).toHaveLength(0)
  })

  it('ingests unattached extension feedback and attaches it to a chosen Session', async () => {
    const store = setup()
    const accepted = await store.ingest({ drafts: [draft('from chrome')], extensionOrigin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' })
    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.draft.target.surface).toBe('external')
    expect(store.intake()).toHaveLength(1)
    const attached = await store.attach({ sessionId, ids: [accepted[0]?.id ?? ''] })
    if (!attached.ok) throw new Error('attach failed')
    expect(attached.value[0]?.origin).toBe('extension')
    expect(attached.value[0]?.sessionId).toBe(sessionId)
    expect(store.intake()).toHaveLength(0)
  })

  it('rotates the extension token', async () => {
    const store = setup()
    const first = store.token()
    expect(first.length).toBeGreaterThan(20)
    const rotated = await store.rotateToken()
    expect(rotated).not.toBe(first)
    expect(store.token()).toBe(rotated)
  })

  it('reports a missing annotation', async () => {
    const store = setup()
    const result = await store.resolve({ sessionId, id: 'ann_99', revision: 1, resolvedBy: 'agent' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('missing')
  })
})
