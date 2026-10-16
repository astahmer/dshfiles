import { describe, expect, it } from 'vitest'
import { transferComposerDraft, type DraftHandoffPort } from './composer-draft-handoff.js'

type DraftSnapshot = DraftHandoffPort['snapshot']

const draftPort = (initial: DraftSnapshot, acceptAttachments = true): DraftHandoffPort => {
  let snapshot = initial
  return {
    get snapshot() {
      return snapshot
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
      snapshot = { ...snapshot, draft }
    },
  }
}

describe('composer draft handoff', () => {
  it('keeps source text and attachments when destination input is busy', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'submitting' })
    const refused: string[] = []

    expect(() =>
      transferComposerDraft({
        source,
        destination,
        sourceSessionId: 'source',
        destinationSessionId: 'destination',
        destinationSessionReady: true,
        rebindAttachments: () => refused.push('rebound'),
        onRefused: () => refused.push('notified'),
      }),
    ).toThrow('source draft remains unchanged')
    expect(source.snapshot).toEqual({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    expect(destination.snapshot).toEqual({ draft: '', attachmentIds: [], phase: 'submitting' })
    expect(refused).toEqual(['notified'])
  })

  it('keeps source content when destination refuses attachment ids', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'plain' }, false)
    const refused: string[] = []

    expect(() =>
      transferComposerDraft({
        source,
        destination,
        sourceSessionId: 'source',
        destinationSessionId: 'destination',
        destinationSessionReady: true,
        rebindAttachments: () => refused.push('rebound'),
        onRefused: () => refused.push('notified'),
      }),
    ).toThrow('source draft remains unchanged')
    expect(source.snapshot).toEqual({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    expect(destination.snapshot).toEqual({ draft: '', attachmentIds: [], phase: 'plain' })
    expect(refused).toEqual(['notified'])
  })

  it('restores source upload ownership when destination rebinding fails', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: ['file'], phase: 'plain' })
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'plain' })
    const rebound: string[] = []

    expect(() =>
      transferComposerDraft({
        source,
        destination,
        sourceSessionId: 'source',
        destinationSessionId: 'destination',
        destinationSessionReady: true,
        rebindAttachments: sessionId => {
          rebound.push(sessionId)
          if (sessionId === 'destination') throw new Error('upload service unavailable')
        },
        onRefused: () => undefined,
      }),
    ).toThrow('upload service unavailable')
    expect(source.snapshot).toEqual({ draft: 'keep me', attachmentIds: ['file'], phase: 'plain' })
    expect(destination.snapshot).toEqual({ draft: '', attachmentIds: [], phase: 'plain' })
    expect(rebound).toEqual(['destination', 'source'])
  })

  it('moves text and attachments and rebinds uploads after destination is ready', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    const destination = draftPort({ draft: '', attachmentIds: [], phase: 'plain' })
    const rebound: { readonly sessionId: string; readonly ids: readonly string[] }[] = []

    transferComposerDraft({
      source,
      destination,
      sourceSessionId: 'source',
      destinationSessionId: 'destination',
      destinationSessionReady: true,
      rebindAttachments: (sessionId, ids) => rebound.push({ sessionId, ids }),
      onRefused: () => {
        throw new Error('unexpected refusal')
      },
    })

    expect(source.snapshot).toEqual({ draft: '', attachmentIds: [], phase: 'plain' })
    expect(destination.snapshot).toEqual({ draft: 'keep me', attachmentIds: ['image', 'file'], phase: 'plain' })
    expect(rebound).toEqual([{ sessionId: 'destination', ids: ['image', 'file'] }])
  })

  it('refuses to overwrite an existing destination draft', () => {
    const source = draftPort({ draft: 'keep me', attachmentIds: [], phase: 'plain' })
    const destination = draftPort({ draft: 'destination draft', attachmentIds: [], phase: 'plain' })

    expect(() =>
      transferComposerDraft({
        source,
        destination,
        sourceSessionId: 'source',
        destinationSessionId: 'destination',
        destinationSessionReady: true,
        rebindAttachments: () => undefined,
        onRefused: () => undefined,
      }),
    ).toThrow('source draft remains unchanged')
    expect(source.snapshot.draft).toBe('keep me')
    expect(destination.snapshot.draft).toBe('destination draft')
  })
})
