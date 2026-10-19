import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor } from '@dshfiles/plugin-ui/machine'
import type { DraftMutation, DraftSnapshot } from './library-api.js'
import { PromptDraftMigration, type PromptDraftMigrationClient } from './draft-migration-machine.js'
import type { DraftStore, SavedDraft } from './draft-store.js'

const savedDraft = (index: number): SavedDraft => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: `Draft ${index}`,
  text: `Prompt ${index}`,
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z',
})

const localStore = (...drafts: SavedDraft[]): DraftStore => ({ schemaVersion: 1, drafts })
const snapshot = (revision: number, ...drafts: SavedDraft[]): DraftSnapshot => ({ revision, drafts })

const actorFor = (client: PromptDraftMigrationClient) => createActor(PromptDraftMigration.machine, { input: { client } }).start()

const applied = (revision: number, ...drafts: SavedDraft[]): DraftMutation => ({ kind: 'applied', revision, drafts })

const rejected = (reason: 'duplicate-id' | 'limit' | 'too-large' | 'invalid-title', revision: number, ...drafts: SavedDraft[]): DraftMutation => ({
  kind: 'rejected',
  reason,
  revision,
  drafts,
})

afterEach(() => PromptDraftMigration.stop())

describe('prompt draft migration', () => {
  it('completes without writing or refetching when there are no local drafts, as on every composer remount', () => {
    const client: PromptDraftMigrationClient = { saveDraft: vi.fn(), completeMigration: vi.fn(), refresh: vi.fn() }
    const actor = actorFor(client)
    actor.send({ type: 'host.snapshot', snapshot: snapshot(3), localStore: localStore() })
    expect(actor.getSnapshot().matches('complete')).toBe(true)
    expect(client.saveDraft).not.toHaveBeenCalled()
    expect(client.refresh).not.toHaveBeenCalled()
    expect(client.completeMigration).toHaveBeenCalledOnce()
    actor.stop()
  })

  it('migrates drafts in order and clears fallback only after every write succeeds', async () => {
    const first = savedDraft(1)
    const second = savedDraft(2)
    const calls: string[] = []
    const migratedLocalStore = localStore(first, second)
    let hostDrafts: SavedDraft[] = []
    const client: PromptDraftMigrationClient = {
      saveDraft: async ({ draft }, { signal }) => {
        expect(signal.aborted).toBe(false)
        calls.push(draft.id)
        const saved = { id: draft.id, title: draft.title, text: draft.text, createdAt: draft.now, updatedAt: draft.now }
        hostDrafts = [...hostDrafts, saved]
        return applied(calls.length + 1, ...hostDrafts)
      },
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: migratedLocalStore })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('complete')).toBe(true))

    expect(calls).toEqual([first.id, second.id])
    expect(client.completeMigration).toHaveBeenCalledOnce()
    expect(client.completeMigration).toHaveBeenCalledWith(migratedLocalStore)
    expect(client.refresh).toHaveBeenCalledOnce()
    actor.stop()
  })

  it('treats only an exact Host duplicate as already migrated', async () => {
    const draft = savedDraft(1)
    const client: PromptDraftMigrationClient = {
      saveDraft: vi.fn(async () => rejected('duplicate-id', 2, { ...draft, text: 'Different prompt' })),
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1, { ...draft, text: 'Different prompt' }), localStore: localStore(draft) })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('failed')).toBe(true))

    expect(client.saveDraft).not.toHaveBeenCalled()
    expect(client.completeMigration).not.toHaveBeenCalled()
    actor.stop()
  })

  it('retains fallback when a concurrent duplicate has different contents', async () => {
    const draft = savedDraft(1)
    const client: PromptDraftMigrationClient = {
      saveDraft: vi.fn(async () => rejected('duplicate-id', 2, { ...draft, text: 'Changed by another client' })),
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: localStore(draft) })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('failed')).toBe(true))

    expect(client.saveDraft).toHaveBeenCalledOnce()
    expect(client.completeMigration).not.toHaveBeenCalled()
    actor.stop()
  })

  it('retries a partial migration only after newer Host evidence', async () => {
    const first = savedDraft(1)
    const second = savedDraft(2)
    let calls = 0
    const client: PromptDraftMigrationClient = {
      saveDraft: async () => {
        calls += 1
        if (calls === 1) return applied(2, first)
        if (calls === 2) return rejected('limit', 2, first)
        return applied(4, first, second)
      },
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)
    const local = localStore(first, second)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: local })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('failed')).toBe(true))
    expect(client.completeMigration).not.toHaveBeenCalled()

    actor.send({ type: 'host.snapshot', snapshot: snapshot(2, first), localStore: local })
    await Promise.resolve()
    expect(calls).toBe(2)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(3, first), localStore: local })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('complete')).toBe(true))

    expect(calls).toBe(3)
    expect(client.completeMigration).toHaveBeenCalledOnce()
    actor.stop()
  })

  it('restarts an in-flight migration against the latest local store', async () => {
    const first = savedDraft(1)
    const second = savedDraft(2)
    const latestStore = localStore(first, second)
    let firstCall = true
    let activeSignal: AbortSignal | undefined
    let hostDrafts: SavedDraft[] = []
    const calls: string[] = []
    const client: PromptDraftMigrationClient = {
      saveDraft: async ({ draft }, { signal }) => {
        calls.push(draft.id)
        if (firstCall) {
          firstCall = false
          activeSignal = signal
          await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
        }
        const saved = { id: draft.id, title: draft.title, text: draft.text, createdAt: draft.now, updatedAt: draft.now }
        hostDrafts = [...hostDrafts, saved]
        return applied(hostDrafts.length + 1, ...hostDrafts)
      },
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: localStore(first) })
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: latestStore })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('complete')).toBe(true))

    expect(activeSignal?.aborted).toBe(true)
    expect(calls).toEqual([first.id, first.id, second.id])
    expect(client.completeMigration).toHaveBeenCalledWith(latestStore)
    actor.stop()
  })

  it('shares one migration and cancels it when the final owner releases', async () => {
    const draft = savedDraft(1)
    let activeSignal: AbortSignal | undefined
    const client: PromptDraftMigrationClient = {
      saveDraft: (_input, { signal }) => {
        activeSignal = signal
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      },
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const releaseFirst = PromptDraftMigration.retain()
    const releaseSecond = PromptDraftMigration.retain()
    const hostSnapshot = snapshot(1)
    const local = localStore(draft)

    PromptDraftMigration.dispatch({ client, snapshot: hostSnapshot, localStore: local })
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    PromptDraftMigration.dispatch({ client, snapshot: hostSnapshot, localStore: local })
    releaseFirst()
    expect(activeSignal?.aborted).toBe(false)

    releaseSecond()
    expect(activeSignal?.aborted).toBe(true)
    expect(client.completeMigration).not.toHaveBeenCalled()
  })
})
