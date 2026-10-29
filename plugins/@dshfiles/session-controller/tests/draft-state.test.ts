import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { ClientSessionDrafts, createDraftStorage } from '../src/draft-state.ts'

const workspaceId = brandString<WorkspaceId>('workspace-project')
const id = (n: number): SessionId => brandString<SessionId>(`session-draft-${n}`)
const options = { workspaceId, cwd: '/project' }
const tick = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}
type Metadata = Parameters<NonNullable<ConstructorParameters<typeof ClientSessionDrafts>[1]>['set']>[0][number]

function fixture() {
  let sequence = 0
  let saved: Parameters<NonNullable<ConstructorParameters<typeof ClientSessionDrafts>[1]>['set']>[0] = []
  const materialization = Promise.withResolvers<SessionId>()
  const gates = new Map<SessionId, { created: Promise<SessionId>; beforeRpc: (signal?: AbortSignal) => Promise<void> }>()
  const backend = {
    begin: vi.fn((opts: { cwd: string; sessionId?: SessionId }) => opts.sessionId ?? id(++sequence)),
    defer: (sessionId: SessionId, created: Promise<SessionId>, beforeRpc: (signal?: AbortSignal) => Promise<void>) => {
      gates.set(sessionId, { created, beforeRpc })
    },
    materialize: vi.fn((_metadata: Metadata) => materialization.promise),
    selectModel: vi.fn(async (_sessionId: SessionId, _model: { provider: string; model: string; reasoningEffort?: string }) => {}),
    selectPreset: vi.fn(async (_sessionId: SessionId, _preset: string) => {}),
    failed: vi.fn(),
    finish: vi.fn(),
    discard: vi.fn(),
    lookup: vi.fn<(_id: SessionId) => Metadata | undefined>(() => undefined),
  }
  const storage = {
    get: () => saved,
    set: (next: typeof saved) => {
      saved = next
      return true
    },
  }
  const drafts = new ClientSessionDrafts(backend, storage)
  return { drafts, backend, storage, gates, materialization }
}

describe('client-only draft lifecycle', () => {
  it('retries failed creation only after an attachment-only send re-admits its captured content', async () => {
    const { drafts, backend, storage } = fixture()
    const handle = drafts.create(options)
    const outgoing = { text: '', hasAttachments: true }
    backend.materialize.mockRejectedValueOnce(new Error('creation unavailable'))
    drafts.update(handle.sessionId, outgoing)
    await expect(drafts.whenCreated(handle.sessionId)).rejects.toThrow('creation unavailable')

    // SessionInputShell.commitSend removes attachments before defaultSink runs.
    drafts.update(handle.sessionId, { text: '', hasAttachments: false })
    void drafts.retry(handle.sessionId)
    await tick()
    expect(backend.materialize).toHaveBeenCalledTimes(1)
    await expect(drafts.whenCreated(handle.sessionId)).rejects.toThrow('creation unavailable')

    backend.materialize.mockResolvedValueOnce(handle.sessionId)
    drafts.update(handle.sessionId, outgoing)
    await drafts.retry(handle.sessionId)
    await expect(handle.settled).resolves.toBe(handle.sessionId)
    expect(backend.materialize).toHaveBeenCalledTimes(2)
    expect(storage.get()[0]?.preview).toBe('Attachment draft')
  })

  it('retries failed staged selection after the reference serializer re-admits text cleared by the editor', async () => {
    const { drafts, backend, materialization } = fixture()
    const handle = drafts.create(options)
    drafts.stageModel(handle.sessionId, { provider: 'account', model: 'chosen' })
    backend.selectModel.mockRejectedValueOnce(new Error('selection unavailable'))
    drafts.update(handle.sessionId, { text: '@file', hasAttachments: false })
    materialization.resolve(handle.sessionId)
    await expect(drafts.whenCreated(handle.sessionId)).rejects.toThrow('selection unavailable')

    // The submit machine clears the editor while reference serialization is pending.
    drafts.update(handle.sessionId, { text: '', hasAttachments: false })
    void drafts.retry(handle.sessionId)
    await tick()
    expect(backend.selectModel).toHaveBeenCalledTimes(1)
    await expect(drafts.whenCreated(handle.sessionId)).rejects.toThrow('selection unavailable')

    drafts.update(handle.sessionId, { text: 'Serialized reference payload', hasAttachments: false })
    await drafts.retry(handle.sessionId)
    await expect(handle.settled).resolves.toBe(handle.sessionId)
    expect(backend.materialize).toHaveBeenCalledTimes(1)
    expect(backend.selectModel).toHaveBeenCalledTimes(2)
  })

  it('re-reads browser storage before merging even without a delivered storage event', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    })
    try {
      const first = createDraftStorage()
      const second = createDraftStorage()
      expect(first.get()).toEqual([])
      const metadata = [{ ...options, sessionId: id(99), preview: 'other browser context' }]
      second.set(metadata)
      expect(first.get()).toEqual(metadata)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves independent tabs on interleaved writes and removes only explicitly cleared or retired identities', async () => {
    const { drafts: firstTab, backend, storage } = fixture()
    backend.materialize.mockImplementation(async metadata => metadata.sessionId)
    const secondTab = new ClientSessionDrafts(backend, storage)
    const first = firstTab.create(options)
    const second = secondTab.create(options)
    firstTab.update(first.sessionId, { text: 'first tab', hasAttachments: false })
    secondTab.update(second.sessionId, { text: 'second tab', hasAttachments: false })
    await Promise.all([firstTab.whenCreated(first.sessionId), secondTab.whenCreated(second.sessionId)])
    expect(storage.get().map(metadata => metadata.sessionId)).toEqual([first.sessionId, second.sessionId])

    // This tab has stale restored records. Touching its new draft must not overwrite them.
    const restoredTab = new ClientSessionDrafts(backend, storage)
    secondTab.update(second.sessionId, { text: 'newer second tab', hasAttachments: false })
    const third = restoredTab.create(options)
    restoredTab.update(third.sessionId, { text: 'third tab', hasAttachments: false })
    await restoredTab.whenCreated(third.sessionId)
    expect(storage.get().find(metadata => metadata.sessionId === second.sessionId)?.preview).toBe('newer second tab')
    firstTab.update(first.sessionId, { text: '', hasAttachments: false })
    expect(storage.get().map(metadata => metadata.sessionId)).toEqual([second.sessionId, third.sessionId])
    secondTab.reconcile(new Set([second.sessionId]), new Set([second.sessionId]))
    expect(storage.get().map(metadata => metadata.sessionId)).toEqual([third.sessionId])
    restoredTab.update(third.sessionId, { text: 'latest third tab', hasAttachments: false })
    expect(storage.get().map(metadata => metadata.sessionId)).toEqual([third.sessionId])
    expect(new ClientSessionDrafts(backend, storage).list.getSnapshot()[third.sessionId]?.preview).toBe('latest third tab')
  })

  it('warns once on rejected metadata writes and retries dirty changes without dropping other tabs', async () => {
    const { backend, storage } = fixture()
    const accepted = vi.fn(storage.set)
    const rejected = { get: storage.get, set: vi.fn<typeof storage.set>(() => false) }
    const drafts = new ClientSessionDrafts(backend, rejected)
    const handle = drafts.create(options)
    drafts.update(handle.sessionId, { text: 'not saved yet', hasAttachments: false })
    expect(backend.failed).toHaveBeenCalledExactlyOnceWith(
      handle.sessionId,
      expect.objectContaining({ message: expect.stringContaining('Could not save draft metadata') }),
    )
    expect(storage.get()).toEqual([])
    drafts.update(handle.sessionId, { text: 'still in memory', hasAttachments: false })
    expect(backend.failed).toHaveBeenCalledTimes(1)
    expect(drafts.list.getSnapshot()[handle.sessionId]?.preview).toBe('still in memory')
    storage.set([{ ...options, sessionId: id(99), preview: 'other tab' }])
    rejected.set.mockImplementation(accepted)
    drafts.stagePreset(handle.sessionId, 'retry-save')
    expect(storage.get().map(metadata => metadata.sessionId)).toEqual([id(99), handle.sessionId])
    expect(storage.get()[1]?.preview).toBe('still in memory')
  })

  it('stages choices without Host calls or persistence until typing; latest choices fence first send', async () => {
    const { drafts, backend, storage, materialization, gates } = fixture()
    const handle = drafts.create(options)
    const first = { provider: 'account', model: 'first' }
    const latest = { provider: 'account', model: 'latest', reasoningEffort: 'high' }
    expect(drafts.stageModel(handle.sessionId, first)).toBe(true)
    expect(drafts.stagePreset(handle.sessionId, 'first-preset')).toBe(true)
    expect(storage.get()).toEqual([])
    expect(backend.materialize).not.toHaveBeenCalled()
    expect(backend.selectModel).not.toHaveBeenCalled()
    expect(backend.selectPreset).not.toHaveBeenCalled()
    drafts.update(handle.sessionId, { text: 'send now', hasAttachments: false })
    await tick()
    expect(backend.materialize.mock.calls[0]?.[0].agentPreset).toBe('first-preset')
    drafts.stageModel(handle.sessionId, latest)
    drafts.stagePreset(handle.sessionId, 'latest-preset')
    drafts.reconcile(new Set(), new Set([handle.sessionId]))
    expect(drafts.list.getSnapshot()[handle.sessionId]?.local).toBe(true)
    expect(backend.finish).not.toHaveBeenCalled()
    let ready = false
    void handle.settled.then(() => {
      ready = true
    })
    const selected = Promise.withResolvers<void>()
    backend.selectModel.mockImplementation(() => selected.promise)
    materialization.resolve(handle.sessionId)
    await tick()
    await tick()
    expect(backend.selectPreset).toHaveBeenCalledExactlyOnceWith(handle.sessionId, 'latest-preset')
    expect(backend.selectModel).toHaveBeenCalledExactlyOnceWith(handle.sessionId, latest)
    expect(ready).toBe(false)
    selected.resolve()
    await gates.get(handle.sessionId)!.beforeRpc()
    expect(ready).toBe(true)
    expect(drafts.list.getSnapshot()[handle.sessionId]?.local).toBe(false)
    expect(drafts.stageModel(handle.sessionId, first)).toBe(false)
    expect(drafts.stagePreset(handle.sessionId, 'other')).toBe(false)
    expect(storage.get()[0]?.model).toEqual(latest)
  })

  it('drains a newer model chosen while selection is pending before releasing readiness', async () => {
    const { drafts, backend, materialization } = fixture()
    const handle = drafts.create(options)
    const first = { provider: 'account', model: 'first' }
    const latest = { provider: 'account', model: 'latest' }
    drafts.stageModel(handle.sessionId, first)
    drafts.update(handle.sessionId, { text: 'ready', hasAttachments: false })
    const selected = Promise.withResolvers<void>()
    backend.selectModel.mockImplementationOnce(() => selected.promise)
    materialization.resolve(handle.sessionId)
    await tick()
    await tick()
    expect(backend.selectModel).toHaveBeenCalledWith(handle.sessionId, first)
    drafts.stageModel(handle.sessionId, latest)
    selected.resolve()
    await handle.settled
    expect(backend.selectModel).toHaveBeenLastCalledWith(handle.sessionId, latest)
    expect(backend.materialize).toHaveBeenCalledTimes(1)
  })

  it('retries selection failures without re-creating the existing Host identity', async () => {
    const { drafts, backend, materialization } = fixture()
    const handle = drafts.create(options)
    drafts.stageModel(handle.sessionId, { provider: 'account', model: 'chosen' })
    drafts.update(handle.sessionId, { text: 'keep', hasAttachments: false })
    backend.selectModel.mockRejectedValueOnce(new Error('model unavailable'))
    materialization.resolve(handle.sessionId)
    await expect(drafts.whenCreated(handle.sessionId)).rejects.toThrow('model unavailable')
    drafts.reconcile(new Set(), new Set([handle.sessionId]))
    expect(drafts.list.getSnapshot()[handle.sessionId]?.local).toBe(true)
    await drafts.retry(handle.sessionId)
    await handle.settled
    expect(backend.materialize).toHaveBeenCalledTimes(1)
    expect(backend.selectModel).toHaveBeenCalledTimes(2)
  })

  it('forgets an abandoned empty local, while preserving typed and in-flight drafts', async () => {
    const { drafts, backend, storage } = fixture()
    const empty = drafts.create(options)
    const typed = drafts.create(options)
    drafts.update(typed.sessionId, { text: 'keep me', hasAttachments: false })
    drafts.abandonEmpty(empty.sessionId)
    drafts.abandonEmpty(typed.sessionId)
    await expect(empty.settled).rejects.toThrow('discarded')
    expect(drafts.list.getSnapshot()[empty.sessionId]).toBeUndefined()
    expect(drafts.list.getSnapshot()[typed.sessionId]?.preview).toBe('keep me')
    expect(backend.discard).toHaveBeenCalledExactlyOnceWith(empty.sessionId)
    expect(storage.get()).toHaveLength(1)
  })

  it('adopts an existing Host blank when its composer changes, without creating it again', async () => {
    const { drafts, backend, storage } = fixture()
    backend.lookup.mockReturnValue({ ...options, sessionId: id(99), preview: '' })
    drafts.update(id(99), { text: 'existing conversation', hasAttachments: false })
    expect(storage.get()[0]?.sessionId).toBe(id(99))
    expect(drafts.list.getSnapshot()[id(99)]?.workspaceId).toBe(workspaceId)
    await drafts.whenCreated(id(99))
    await tick()
    expect(backend.materialize).not.toHaveBeenCalled()
  })

  it('stages a model on an existing Host blank and attaches it before first send', async () => {
    const { drafts, backend } = fixture()
    const existingId = id(100)
    const chosen = { provider: 'account', model: 'chosen', reasoningEffort: 'high' }
    backend.lookup.mockReturnValue({ ...options, sessionId: existingId, preview: '' })
    backend.materialize.mockImplementation(async metadata => metadata.sessionId)

    drafts.update(existingId, { text: '', hasAttachments: false })

    expect(drafts.stageModel(existingId, chosen)).toBe(true)
    drafts.reconcile(new Set(), new Set([existingId]))
    expect(backend.materialize).not.toHaveBeenCalled()
    expect(backend.selectModel).not.toHaveBeenCalled()

    drafts.update(existingId, { text: 'first message', hasAttachments: false })
    await drafts.whenCreated(existingId)

    expect(backend.materialize).toHaveBeenCalledExactlyOnceWith({ ...options, sessionId: existingId, preview: 'first message', model: chosen })
    expect(backend.selectModel).toHaveBeenCalledExactlyOnceWith(existingId, chosen)
  })

  it('resolves restored readiness from actual Host presence and releases the provisional overlay', async () => {
    const { drafts, backend, storage } = fixture()
    const original = drafts.create(options)
    drafts.update(original.sessionId, { text: 'stored', hasAttachments: false })
    const restored = new ClientSessionDrafts(backend, storage)
    const ready = restored.whenCreated(original.sessionId)
    restored.reconcile(new Set(), new Set([original.sessionId]))
    await ready
    expect(backend.finish).toHaveBeenCalledWith(original.sessionId)
    expect(storage.get()).toHaveLength(1)
  })

  it('disposes pending local gates without erasing stored typed metadata', async () => {
    const { drafts, storage } = fixture()
    const empty = drafts.create(options)
    const typed = drafts.create(options)
    drafts.update(typed.sessionId, { text: 'survives reload', hasAttachments: false })
    drafts.dispose()
    await expect(empty.settled).rejects.toThrow('disposed')
    expect(storage.get()[0]?.preview).toBe('survives reload')
    expect(() => drafts.create(options)).toThrow('disposed')
  })

  it('allocates independent blanks without a Host call or stored metadata, including whitespace', () => {
    const { drafts, backend, storage } = fixture()
    const first = drafts.create(options)
    const second = drafts.create(options)
    drafts.update(first.sessionId, { text: ' \n ', hasAttachments: false })
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(Object.values(drafts.list.getSnapshot()).map(row => row.preview)).toEqual(['', ''])
    expect(backend.materialize).not.toHaveBeenCalled()
    expect(storage.get()).toEqual([])
  })

  it('persists bounded preview metadata before starting exactly one materialization', async () => {
    const { drafts, backend, storage, materialization, gates } = fixture()
    const handle = drafts.create(options)
    drafts.update(handle.sessionId, { text: 'x'.repeat(200), hasAttachments: false })
    expect(storage.get()).toEqual([{ ...options, sessionId: handle.sessionId, preview: 'x'.repeat(80) }])
    drafts.update(handle.sessionId, { text: 'changed', hasAttachments: false })
    await tick()
    expect(backend.materialize).toHaveBeenCalledTimes(1)
    expect(drafts.list.getSnapshot()[handle.sessionId]?.preview).toBe('changed')
    materialization.resolve(handle.sessionId)
    await expect(handle.settled).resolves.toBe(handle.sessionId)
    await expect(gates.get(handle.sessionId)?.beforeRpc()).resolves.toBeUndefined()
    // Host blank, including after local send optimism, is not evidence to retire a draft.
    drafts.reconcile(new Set(), new Set([handle.sessionId]))
    expect(storage.get()).toHaveLength(1)
    drafts.reconcile(new Set([handle.sessionId]), new Set([handle.sessionId]))
    expect(storage.get()).toEqual([])
    expect(drafts.list.getSnapshot()).toEqual({})
  })

  it('treats attachments as content without caching bytes or complete text', async () => {
    const { drafts, backend, storage } = fixture()
    const handle = drafts.create(options)
    drafts.update(handle.sessionId, { text: '', hasAttachments: true })
    await tick()
    expect(backend.materialize).toHaveBeenCalledTimes(1)
    expect(storage.get()[0]?.preview).toBe('Attachment draft')
    expect(Object.keys(storage.get()[0] ?? {}).sort()).toEqual(['cwd', 'preview', 'sessionId', 'workspaceId'])
  })

  it('keeps identity, preview, and success gate after failure; next send retries', async () => {
    const { drafts, backend, storage, gates, materialization } = fixture()
    const handle = drafts.create(options)
    drafts.update(handle.sessionId, { text: 'keep this', hasAttachments: false })
    materialization.reject(new Error('offline'))
    await expect(drafts.whenCreated(handle.sessionId)).rejects.toThrow('offline')
    expect(backend.failed).toHaveBeenCalledWith(handle.sessionId, expect.objectContaining({ message: 'offline' }))
    expect(storage.get()[0]?.preview).toBe('keep this')
    expect(drafts.list.getSnapshot()[handle.sessionId]?.sessionId).toBe(handle.sessionId)
    const retry = Promise.withResolvers<SessionId>()
    backend.materialize.mockImplementation(() => retry.promise)
    const sent = gates.get(handle.sessionId)!.beforeRpc()
    await tick()
    retry.resolve(handle.sessionId)
    await sent
    await expect(handle.settled).resolves.toBe(handle.sessionId)
    expect(backend.materialize).toHaveBeenCalledTimes(2)
  })

  it('restores addressable identities and preview, not another text buffer', async () => {
    const { drafts, backend, storage } = fixture()
    const handle = drafts.create(options)
    drafts.update(handle.sessionId, { text: 'restored title', hasAttachments: false })
    const restored = new ClientSessionDrafts(backend, storage)
    expect(restored.list.getSnapshot()[handle.sessionId]?.preview).toBe('restored title')
    expect(backend.begin).toHaveBeenLastCalledWith({ sessionId: handle.sessionId, cwd: '/project' })
    await tick()
    expect(backend.materialize).toHaveBeenCalledTimes(1)
  })

  it('cancels one blank readiness waiter without materializing or cancelling others', async () => {
    const { drafts, backend, materialization, gates } = fixture()
    const handle = drafts.create(options)
    const controller = new AbortController()
    const waiting = drafts.whenCreated(handle.sessionId, controller.signal)
    controller.abort(new Error('switched away'))
    await expect(waiting).rejects.toThrow('switched away')
    expect(backend.materialize).not.toHaveBeenCalled()
    await expect(gates.get(handle.sessionId)!.beforeRpc(controller.signal)).rejects.toThrow('switched away')
    drafts.update(handle.sessionId, { text: 'later', hasAttachments: false })
    materialization.resolve(handle.sessionId)
    await expect(handle.settled).resolves.toBe(handle.sessionId)
  })
})
