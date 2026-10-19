import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor } from '@dshfiles/plugin-ui/machine'
import type { PromptStashMutation, PromptStashSnapshot } from './library-api.js'
import { PromptLibraryMigration, type PromptLibraryMigrationClient } from './library-migration-machine.js'
import type { PromptLibraryStore, SavedPrompt } from './library.js'

const savedPrompt = (index: number): SavedPrompt => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  revision: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: `Prompt ${index}`,
  text: `Text ${index}`,
  updatedAt: index,
})

const localStore = (...prompts: SavedPrompt[]): PromptLibraryStore => ({ version: 1, prompts })
const snapshot = (revision: number, ...prompts: SavedPrompt[]): PromptStashSnapshot => ({ revision, prompts })
const actorFor = (client: PromptLibraryMigrationClient) => createActor(PromptLibraryMigration.machine, { input: { client } }).start()
const applied = (revision: number, ...prompts: SavedPrompt[]): PromptStashMutation => ({ kind: 'applied', revision, prompts })
const conflict = (revision: number, ...prompts: SavedPrompt[]): PromptStashMutation => ({ kind: 'conflict', revision, prompts })
const limit = (revision: number, ...prompts: SavedPrompt[]): PromptStashMutation => ({ kind: 'limit', revision, prompts })

afterEach(() => PromptLibraryMigration.stop())

describe('saved prompt library migration', () => {
  it('completes without writing or refetching when there are no local prompts, as on every composer remount', () => {
    const client: PromptLibraryMigrationClient = { savePrompt: vi.fn(), completeMigration: vi.fn(), refresh: vi.fn() }
    const actor = actorFor(client)
    actor.send({ type: 'host.snapshot', snapshot: snapshot(3), localStore: localStore(), localStatus: 'ready' })
    expect(actor.getSnapshot().matches('complete')).toBe(true)
    expect(client.savePrompt).not.toHaveBeenCalled()
    expect(client.refresh).not.toHaveBeenCalled()
    expect(client.completeMigration).toHaveBeenCalledOnce()
    actor.stop()
  })

  it('migrates local prompts sequentially and completes with the exact source store', async () => {
    const first = savedPrompt(1)
    const second = savedPrompt(2)
    const source = localStore(first, second)
    const calls: string[] = []
    let hostPrompts: SavedPrompt[] = []
    const client: PromptLibraryMigrationClient = {
      savePrompt: async ({ prompt }, { signal }) => {
        expect(signal.aborted).toBe(false)
        calls.push(prompt.id)
        hostPrompts = [...hostPrompts, prompt]
        return applied(calls.length + 1, ...hostPrompts)
      },
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: source, localStatus: 'ready' })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('complete')).toBe(true))

    expect(calls).toEqual([first.id, second.id])
    expect(client.completeMigration).toHaveBeenCalledWith(source)
    expect(client.refresh).toHaveBeenCalledOnce()
    actor.stop()
  })

  it('ignores reloads that publish unchanged local library data', async () => {
    const source = localStore()
    let publishReload: () => void = () => undefined
    const client: PromptLibraryMigrationClient = {
      savePrompt: vi.fn(),
      completeMigration: vi.fn(() => publishReload()),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)
    let reloadPublished = false
    publishReload = () => {
      if (reloadPublished) return
      reloadPublished = true
      actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: localStore(), localStatus: 'ready' })
    }

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: source, localStatus: 'ready' })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('complete')).toBe(true))
    expect(client.completeMigration).toHaveBeenCalledOnce()

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: localStore(), localStatus: 'ready' })
    expect(actor.getSnapshot().matches('complete')).toBe(true)
    expect(client.completeMigration).toHaveBeenCalledOnce()
    actor.stop()
  })

  it('accepts only exact Host duplicates and preserves a conflicting local prompt', async () => {
    const prompt = savedPrompt(1)
    const exactClient: PromptLibraryMigrationClient = {
      savePrompt: vi.fn(),
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const exactActor = actorFor(exactClient)
    exactActor.send({ type: 'host.snapshot', snapshot: snapshot(2, prompt), localStore: localStore(prompt), localStatus: 'ready' })
    await vi.waitFor(() => expect(exactActor.getSnapshot().matches('complete')).toBe(true))
    expect(exactClient.savePrompt).not.toHaveBeenCalled()
    exactActor.stop()

    const different = { ...prompt, text: 'Changed elsewhere' }
    const conflictClient: PromptLibraryMigrationClient = {
      savePrompt: vi.fn(async () => conflict(3, different)),
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const conflictActor = actorFor(conflictClient)
    conflictActor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: localStore(prompt), localStatus: 'ready' })
    await vi.waitFor(() => expect(conflictActor.getSnapshot().matches('failed')).toBe(true))
    expect(conflictClient.savePrompt).toHaveBeenCalledOnce()
    expect(conflictClient.completeMigration).not.toHaveBeenCalled()
    conflictActor.stop()
  })

  it('retries partial migration only after newer Host evidence', async () => {
    const first = savedPrompt(1)
    const second = savedPrompt(2)
    const source = localStore(first, second)
    let calls = 0
    const client: PromptLibraryMigrationClient = {
      savePrompt: async () => {
        calls += 1
        if (calls === 1) return applied(2, first)
        if (calls === 2) return limit(2, first)
        return applied(4, first, second)
      },
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: source, localStatus: 'ready' })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('failed')).toBe(true))
    expect(client.completeMigration).not.toHaveBeenCalled()

    actor.send({ type: 'host.snapshot', snapshot: snapshot(3, first), localStore: source, localStatus: 'ready' })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('complete')).toBe(true))
    expect(calls).toBe(3)
    expect(client.completeMigration).toHaveBeenCalledWith(source)
    actor.stop()
  })

  it('preserves invalid local data without attempting migration', async () => {
    const client: PromptLibraryMigrationClient = {
      savePrompt: vi.fn(),
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: localStore(savedPrompt(1)), localStatus: 'invalid' })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('preserved')).toBe(true))

    expect(client.savePrompt).not.toHaveBeenCalled()
    expect(client.completeMigration).not.toHaveBeenCalled()
    actor.stop()
  })

  it('cancels stale migration and restarts from the latest local store', async () => {
    const first = savedPrompt(1)
    const second = savedPrompt(2)
    const latestStore = localStore(first, second)
    let firstCall = true
    let activeSignal: AbortSignal | undefined
    let hostPrompts: SavedPrompt[] = []
    const calls: string[] = []
    const client: PromptLibraryMigrationClient = {
      savePrompt: async ({ prompt }, { signal }) => {
        calls.push(prompt.id)
        if (firstCall) {
          firstCall = false
          activeSignal = signal
          await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
        }
        hostPrompts = [...hostPrompts, prompt]
        return applied(hostPrompts.length + 1, ...hostPrompts)
      },
      completeMigration: vi.fn(),
      refresh: vi.fn(),
    }
    const actor = actorFor(client)

    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: localStore(first), localStatus: 'ready' })
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    actor.send({ type: 'host.snapshot', snapshot: snapshot(1), localStore: latestStore, localStatus: 'ready' })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('complete')).toBe(true))

    expect(activeSignal?.aborted).toBe(true)
    expect(calls).toEqual([first.id, first.id, second.id])
    expect(client.completeMigration).toHaveBeenCalledWith(latestStore)
    actor.stop()
  })
})
