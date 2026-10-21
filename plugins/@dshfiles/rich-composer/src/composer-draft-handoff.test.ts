import { describe, expect, it } from 'vitest'
import { transferComposerDraft, type DraftHandoffPort } from './composer-draft-handoff.js'

type DraftSnapshot = DraftHandoffPort['snapshot']
type DraftDocument = DraftHandoffPort['draftSnapshot']

const draftPort = (
  initial: DraftSnapshot,
  acceptAttachments = true,
  initialDocument: DraftDocument = { text: initial.draft, references: [] },
): DraftHandoffPort & { readonly draftSnapshot: DraftDocument } => {
  let snapshot = initial
  let document = initialDocument
  return {
    get snapshot() {
      return snapshot
    },
    get draftSnapshot() {
      return document
    },
    addAttachments(ids) {
      if (!acceptAttachments || snapshot.phase !== 'plain') return false
      snapshot = { ...snapshot, attachmentIds: [...snapshot.attachmentIds, ...ids] }
      return true
    },
    removeAttachment(id) {
      if (snapshot.phase !== 'plain') return false
      snapshot = { ...snapshot, attachmentIds: snapshot.attachmentIds.filter(candidate => candidate !== id) }
      return true
    },
    setDraft(draft) {
      document = draft === '' ? { text: '', references: [] } : draft
      snapshot = { ...snapshot, draft: document.text }
    },
  }
}

describe('composer draft handoff', () => {
  it('keeps source text and attachments when destination input is busy', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'submitting' })

    const outcome = transferComposerDraft({
      source,
      destination,
      sourceSessionId: 'source',
      destinationSessionId: 'destination',
      destinationSessionReady: true,
      rebindAttachments: () => undefined,
    })

    expect(outcome).toBe('kept')
    expect(source.snapshot).toEqual({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    expect(destination.snapshot).toEqual({ draft: '', attachmentIds: [], phase: 'submitting' })
  })

  it('keeps source content when destination refuses attachment ids', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'plain' }, false)

    const outcome = transferComposerDraft({
      source,
      destination,
      sourceSessionId: 'source',
      destinationSessionId: 'destination',
      destinationSessionReady: true,
      rebindAttachments: () => undefined,
    })

    expect(outcome).toBe('kept')
    expect(source.snapshot).toEqual({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    expect(destination.snapshot).toEqual({ draft: '', attachmentIds: [], phase: 'plain' })
  })

  it('restores source upload ownership when destination rebinding fails', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: ['file'], phase: 'plain' })
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'plain' })
    const rebound: string[] = []

    const outcome = transferComposerDraft({
      source,
      destination,
      sourceSessionId: 'source',
      destinationSessionId: 'destination',
      destinationSessionReady: true,
      rebindAttachments: sessionId => {
        rebound.push(sessionId)
        if (sessionId === 'destination') throw new Error('upload service unavailable')
      },
    })

    expect(outcome).toBe('kept')
    expect(source.snapshot).toEqual({ draft: 'keep me', attachmentIds: ['file'], phase: 'plain' })
    expect(destination.snapshot).toEqual({ draft: '', attachmentIds: [], phase: 'plain' })
    expect(rebound).toEqual(['destination', 'source'])
  })

  it('moves text and attachments and rebinds uploads after destination is ready', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'plain' })
    const rebound: { readonly sessionId: string; readonly ids: readonly string[] }[] = []

    const outcome = transferComposerDraft({
      source,
      destination,
      sourceSessionId: 'source',
      destinationSessionId: 'destination',
      destinationSessionReady: true,
      rebindAttachments: (sessionId, ids) => rebound.push({ sessionId, ids }),
    })

    expect(outcome).toBe('transferred')
    expect(source.snapshot).toEqual({ draft: '', attachmentIds: [], phase: 'plain' })
    expect(destination.snapshot).toEqual({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    expect(rebound).toEqual([{ sessionId: 'destination', ids: ['image', 'file'] }])
  })

  it('carries reference chips and the command chip with the moved draft', () => {
    const document: DraftDocument = {
      text: '/goal see @[Plan](dsh-session:abc)',
      references: [{ source: 'session', ref: 'abc', offset: 10, length: 24, label: 'Plan', clipboardText: '@[Plan](dsh-session:abc)' }],
      command: { token: '/goal ' },
    }
    const source = draftPort({ draft: document.text, attachmentIds: [], phase: 'plain' }, true, document)
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'plain' })

    const outcome = transferComposerDraft({
      source,
      destination,
      sourceSessionId: 'source',
      destinationSessionId: 'destination',
      destinationSessionReady: true,
      rebindAttachments: () => undefined,
    })

    expect(outcome).toBe('transferred')
    expect(destination.draftSnapshot).toEqual(document)
    expect(source.draftSnapshot).toEqual({ text: '', references: [] })
  })

  it('keeps both drafts when the destination already contains content', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: [], phase: 'plain' })
    const destination = draftPort({ draft: 'destination draft', attachmentIds: [], phase: 'plain' })

    const outcome = transferComposerDraft({
      source,
      destination,
      sourceSessionId: 'source',
      destinationSessionId: 'destination',
      destinationSessionReady: true,
      rebindAttachments: () => undefined,
    })

    expect(outcome).toBe('kept')
    expect(source.snapshot.draft).toBe('keep me')
    expect(destination.snapshot.draft).toBe('destination draft')
  })

  it('reports a kept empty source instead of blocking navigation', () => {
    const source = draftPort({ draft: '', attachmentIds: [], phase: 'plain' })
    const destination = draftPort({ draft: 'destination draft', attachmentIds: [], phase: 'plain' })

    const outcome = transferComposerDraft({
      source,
      destination,
      sourceSessionId: 'source',
      destinationSessionId: 'destination',
      destinationSessionReady: true,
      rebindAttachments: () => undefined,
    })

    expect(outcome).toBe('kept')
    expect(destination.snapshot.draft).toBe('destination draft')
  })

  it('reports a kept handoff when the destination session is not ready', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: [], phase: 'plain' })
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'plain' })

    const outcome = transferComposerDraft({
      source,
      destination,
      sourceSessionId: 'source',
      destinationSessionId: 'destination',
      destinationSessionReady: false,
      rebindAttachments: () => undefined,
    })

    expect(outcome).toBe('kept')
    expect(source.snapshot.draft).toBe('keep me')
  })
})
