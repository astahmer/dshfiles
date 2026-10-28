// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionDrafts } from '@dshfiles/session-controller/draft-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionInputShell } from './native/input/facade.ts'
import { InputHub } from './native/input/hub.ts'
import type { DraftAttachmentId, InputTriggerController, SubmitOutcome } from './native/contract/input.ts'
import { observeSessionDraft } from './session-draft-tracking.ts'

// Rendering is outside this routing test; keep the real Lexical nodes, facade and submit machine.
vi.mock('./native/input/editor/ReferenceChip.tsx', () => ({ ReferenceChip: () => null }))
vi.mock('./native/input/editor/CommandChip.tsx', () => ({ CommandChip: () => null }))

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function fixture() {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  // SAFETY: the sink only reads the identity and passes this opaque face to the injected conversation seam.
  const session = { sessionId: 'session-retry' as SessionId } as SessionFace
  const update = vi.fn<SessionDrafts['update']>()
  const retry = vi.fn(async () => session.sessionId)
  const drafts: SessionDrafts = {
    list: createSnapshotStore({}),
    create: vi.fn<SessionDrafts['create']>(),
    update,
    stageModel: vi.fn<SessionDrafts['stageModel']>(),
    stagePreset: vi.fn<SessionDrafts['stagePreset']>(),
    retry,
    whenCreated: vi.fn(async () => undefined),
  }
  const send = vi.fn(async () => ({ kind: 'success' as const }))
  ctx.provide('sessionDrafts', drafts)
  ctx.provide('conversation', { sendSession: send })
  const release = vi.fn()
  const readiness = vi.fn(() => {
    throw new Error('Local submission retention must not await history readiness before retry')
  })
  const retain = vi.fn(() => ({
    release,
    get ready() {
      return readiness()
    },
  }))
  ctx.provide('sessions', { binding: () => ({ session }), retain })
  const hub = new InputHub(ctx, key => key)
  const outcome = Promise.withResolvers<SubmitOutcome>()
  const serialized = Promise.withResolvers<string>()
  const serializeReference = vi.fn(() => serialized.promise)
  const triggers: InputTriggerController = {
    launcher: createSnapshotStore<string | null>(null),
    lexicon: createSnapshotStore<ReadonlyMap<'/' | '@', readonly string[]>>(new Map()),
    track: () => undefined,
    arbitrate: () => 'pass',
    onSpace: () => false,
    serializeReference,
    adjudicate: async () => undefined,
    resolveClaim: async () => undefined,
    openReference: () => false,
    toggleSource: () => undefined,
  }
  const shell = new SessionInputShell({
    actx: ctx,
    inputTriggers: () => triggers,
    defaultSink: (text, attachments, mode, signal) => {
      // Exercise this package's real routing boundary, not a copy of its materialization logic.
      const pending = hub['sink'](session, text, attachments, mode, signal)
      void pending.then(outcome.resolve, outcome.reject)
      return pending
    },
    commandAttachments: { serialize: async () => [], release: () => undefined, unsupportedNotice: token => token },
  })
  cleanups.push(() => {
    shell.dispose()
  })
  cleanups.push(observeSessionDraft({ state: shell.state, update: content => drafts.update(session.sessionId, content) }))
  return { session, drafts, update, retry, send, shell, outcome, serialized, serializeReference, retain, release, readiness }
}

describe('draft retry after the real composer clears its outgoing content', () => {
  it('retains the session through both draft creation and send admission', async () => {
    const { drafts, send, shell, outcome, release } = fixture()
    const created = Promise.withResolvers<void>()
    const admitted = Promise.withResolvers<{ kind: 'success' }>()
    vi.mocked(drafts.whenCreated).mockReturnValue(created.promise)
    send.mockReturnValue(admitted.promise)
    shell.setDraft({ text: 'Pending first send', references: [] })
    shell.submit()
    expect(drafts.whenCreated).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    created.resolve()
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    expect(release).not.toHaveBeenCalled()
    admitted.resolve({ kind: 'success' })
    await expect(outcome.promise).resolves.toEqual({ kind: 'success' })
    expect(release).toHaveBeenCalledOnce()
  })

  it('re-admits attachment-only content before retrying failed creation', async () => {
    const { session, update, retry, send, shell, outcome, retain, release, readiness } = fixture()
    // SAFETY: a synthetic draft attachment identity; no upload or attachment bytes are needed by this routing test.
    const attachment = 'draft-attachment-retry' as DraftAttachmentId
    shell.actions.addAttachments([attachment])
    expect(update).toHaveBeenLastCalledWith(session.sessionId, { text: '', hasAttachments: true })
    update.mockClear()
    shell.submit()
    await expect(outcome.promise).resolves.toEqual({ kind: 'success' })
    expect(shell.snapshot.attachmentIds).toEqual([])
    expect(update.mock.calls).toEqual([
      [session.sessionId, { text: '', hasAttachments: false }],
      [session.sessionId, { text: '', hasAttachments: true }],
    ])
    expect(update.mock.invocationCallOrder.at(-1)).toBeLessThan(retry.mock.invocationCallOrder[0]!)
    expect(send).toHaveBeenCalledOnce()
    expect(retain).toHaveBeenCalledExactlyOnceWith(session.sessionId, { source: 'controllerOperation' })
    expect(release).toHaveBeenCalledOnce()
    expect(readiness).not.toHaveBeenCalled()
  })

  it('re-admits serialized references after the editor clears and before retrying failed selection', async () => {
    const { session, drafts, update, retry, send, shell, outcome, serialized, serializeReference } = fixture()
    shell.setDraft({
      text: '@file',
      references: [{ source: 'files', ref: '/synthetic/file.ts', label: 'file', clipboardText: '@file', offset: 0, length: 5 }],
    })
    update.mockClear()
    shell.submit()
    expect(serializeReference).toHaveBeenCalledOnce()
    expect(shell.snapshot.draft).toBe('')
    expect(update).toHaveBeenLastCalledWith(session.sessionId, { text: '', hasAttachments: false })
    expect(drafts.retry).not.toHaveBeenCalled()
    serialized.resolve('Serialized reference payload')
    await expect(outcome.promise).resolves.toEqual({ kind: 'success' })
    expect(update).toHaveBeenLastCalledWith(session.sessionId, { text: 'Serialized reference payload', hasAttachments: false })
    expect(update.mock.invocationCallOrder.at(-1)).toBeLessThan(retry.mock.invocationCallOrder[0]!)
    expect(send).toHaveBeenCalledOnce()
    // Re-admitting the outgoing payload must not restore or replace the editor's current contents.
    expect(shell.snapshot.draft).toBe('')
  })
})
