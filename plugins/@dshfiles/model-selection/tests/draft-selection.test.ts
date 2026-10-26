import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelCatalog, ModelSelection, ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, type TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionDraft, SessionDrafts } from '@dshfiles/session-controller/draft-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelCatalogDirectory } from '../src/native/catalog.ts'
import { ModelDirectory } from '../src/native/directory.ts'

// SAFETY: branding only; the RPC seam receives the same identity the client draft owns.
const sessionId = 'session-local-model' as SessionId
const initial: ModelSelection = { provider: 'provider', model: 'first' }
const chosen: ModelSelection = { provider: 'provider', model: 'second', reasoningEffort: 'high' }
const catalogValue: ModelCatalog = {
  default: initial,
  routableProviders: ['provider'],
  groups: [
    {
      id: 'provider',
      name: 'Provider',
      models: [
        { id: 'first', name: 'First' },
        {
          id: 'second',
          name: 'Second',
          reasoning: {
            defaultEffort: 'low',
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
          },
        },
      ],
    },
  ],
  failures: [],
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function fixture(local = true) {
  const ctx = new Context()
  const modelCatalog = vi.fn(async () => ({ ok: true as const, value: catalogValue }))
  const disposeRemote = ctx.provide('remote', { session: { modelCatalog } })
  const catalog = new ModelCatalogDirectory(ctx)
  const projected = createSnapshotStore<ModelSelectionProjection | undefined>(undefined)
  const list = createSnapshotStore<Readonly<Record<string, SessionDraft>>>({
    [sessionId]: { sessionId, local, preview: '' },
  })
  const stageModel = vi.fn((id: SessionId, model: ModelSelection) => {
    const draft = list.getSnapshot()[id]
    if (!draft?.local) return false
    list.set({ ...list.getSnapshot(), [id]: { ...draft, model } })
    return true
  })
  const drafts: SessionDrafts = {
    list,
    stageModel,
    stagePreset: () => false,
    create: () => {
      throw new Error('selection must not create a draft')
    },
    update: () => {
      throw new Error('selection must not add content')
    },
    whenCreated: async () => {},
    retry: async () => sessionId,
  }
  const selectModel = vi.fn<TypertClientRemote['session']['selectModel']>(async selection => ({ ok: true, value: { selected: selection } }))
  const directory = new ModelDirectory(
    { selectModel },
    sessionId,
    () => true,
    catalog,
    projected,
    () => true,
    undefined,
    drafts,
  )
  cleanups.push(() => {
    directory.dispose()
    disposeRemote()
  })
  return { catalog, directory, drafts, list, modelCatalog, projected, selectModel, stageModel }
}

describe('shared model directory for local drafts', () => {
  it('loads the default without a Host projection and stages model plus effort without an RPC', async () => {
    const { directory, list, selectModel, stageModel } = fixture()
    expect((await directory.load()).current).toEqual(initial)
    expect(directory.store.getSnapshot().status).toBe('ready')
    await expect(directory.select(chosen)).resolves.toEqual({ ok: true, value: undefined })
    expect(stageModel).toHaveBeenCalledExactlyOnceWith(sessionId, chosen)
    expect(list.getSnapshot()[sessionId]?.model).toEqual(chosen)
    expect(directory.store.getSnapshot()).toMatchObject({ current: chosen, retainedEffort: 'High', status: 'ready', routable: true })
    expect(selectModel).not.toHaveBeenCalled()
  })

  it('retains staged selection across connection reset and catalog replacement', async () => {
    const { catalog, directory, list, selectModel } = fixture()
    await directory.load()
    await directory.select(chosen)
    catalog.resetGeneration()
    directory.resetConnected()
    expect(directory.store.getSnapshot().current).toEqual(chosen)
    expect(list.getSnapshot()[sessionId]?.model).toEqual(chosen)
    await directory.load()
    expect(directory.store.getSnapshot()).toMatchObject({ current: chosen, retainedEffort: 'High', status: 'ready' })
    expect(selectModel).not.toHaveBeenCalled()
  })

  it('observes staged state shared by another entry and retains unavailable models', async () => {
    const { directory, drafts, selectModel } = fixture()
    await directory.load()
    const unavailable = { provider: 'gone', model: 'missing', reasoningEffort: 'custom' }
    drafts.stageModel(sessionId, unavailable)
    expect(directory.store.getSnapshot()).toMatchObject({ current: unavailable, retainedEffort: 'custom', routable: false })
    expect(selectModel).not.toHaveBeenCalled()
  })

  it('leaves real Host selection and projection ownership unchanged', async () => {
    const { directory, projected, selectModel, stageModel } = fixture(false)
    await directory.load()
    expect(directory.store.getSnapshot().status).toBe('loading')
    projected.set({ lastUsed: null, next: initial })
    await directory.select(chosen)
    expect(stageModel).toHaveBeenCalledExactlyOnceWith(sessionId, chosen)
    expect(selectModel).toHaveBeenCalledExactlyOnceWith({ sessionId, ...chosen })
    expect(directory.store.getSnapshot().current).toEqual(initial)
    projected.set({ lastUsed: null, next: chosen })
    expect(directory.store.getSnapshot().current).toEqual(chosen)
  })

  it('preserves real Host selection failures without changing the projection', async () => {
    const { directory, projected, selectModel } = fixture(false)
    await directory.load()
    projected.set({ lastUsed: null, next: initial })
    const failure = { ok: false as const, error: new RemoteError('session/writer-held', 'Session is in use', { sessionId }) }
    selectModel.mockResolvedValueOnce(failure)
    await expect(directory.select(chosen)).resolves.toEqual(failure)
    expect(directory.store.getSnapshot()).toMatchObject({ current: initial, status: 'error', pending: null, error: 'session/writer-held: Session is in use' })
  })

  it('uses the Host once a local draft materializes, and unsubscribes on disposal', async () => {
    const { directory, list, projected, selectModel } = fixture()
    await directory.load()
    await directory.select(chosen)
    list.set({ [sessionId]: { sessionId, local: false, preview: 'typed', model: chosen } })
    projected.set({ lastUsed: null, next: chosen })
    await directory.select(initial)
    expect(selectModel).toHaveBeenCalledExactlyOnceWith({ sessionId, ...initial })
    directory.dispose()
    const snapshot = directory.store.getSnapshot()
    list.set({})
    projected.set({ lastUsed: null, next: initial })
    expect(directory.store.getSnapshot()).toBe(snapshot)
  })
})
