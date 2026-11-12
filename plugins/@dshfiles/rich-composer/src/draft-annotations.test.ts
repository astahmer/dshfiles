// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionInputShell } from './native/input/facade.ts'
import { DraftAnnotations } from './native/input/draft-annotations.ts'
import type { InputTriggerController, SubmitOutcome } from './native/contract/input.ts'

vi.mock('./native/input/editor/ReferenceChip.tsx', () => ({ ReferenceChip: () => null }))
vi.mock('./native/input/editor/CommandChip.tsx', () => ({ CommandChip: () => null }))

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const shellSendingTo = (sink: (text: string) => Promise<SubmitOutcome>): SessionInputShell => {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const triggers: InputTriggerController = {
    launcher: createSnapshotStore<string | null>(null),
    lexicon: createSnapshotStore<ReadonlyMap<'/' | '@', readonly string[]>>(new Map()),
    track: () => undefined,
    arbitrate: () => 'pass',
    onSpace: () => false,
    restoreReferences: () => [],
    serializeReference: async () => '',
    adjudicate: async () => undefined,
    resolveClaim: async () => undefined,
    openReference: () => false,
    toggleSource: () => undefined,
  }
  const shell = new SessionInputShell({
    actx: ctx,
    inputTriggers: () => triggers,
    defaultSink: text => sink(text),
    commandAttachments: { serialize: async () => [], release: () => undefined, unsupportedNotice: token => token },
  })
  cleanups.push(() => shell.dispose())
  return shell
}

describe('draft annotations', () => {
  it('sends each quoted passage and its comment ahead of the message', async () => {
    const sent: string[] = []
    const shell = shellSendingTo(async text => {
      sent.push(text)
      return { kind: 'success' }
    })
    shell.annotations.add({ text: 'aucune trace de 400,', source: '' })
    shell.annotations.add({ text: 'second\npassage', source: '' })
    const first = shell.annotations.snapshot()[0]
    if (first === undefined) throw new Error('annotation missing')
    shell.annotations.setComment({ id: first.id, comment: '  why?  ' })
    shell.setDraft('Fix it')
    shell.submit()

    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toBe(
      'Annotation 1 on your previous reply:\n> aucune trace de 400,\n\nComment: why?\n\n' +
        'Annotation 2 on your previous reply:\n> second\n> passage\n\nFix it',
    )
    expect(shell.annotations.snapshot()).toEqual([])
  })

  it('sends annotations alone when the draft is empty', async () => {
    const sent: string[] = []
    const shell = shellSendingTo(async text => {
      sent.push(text)
      return { kind: 'success' }
    })
    shell.annotations.add({ text: 'only this', source: '' })
    shell.submit()

    await vi.waitFor(() => expect(sent).toEqual(['Annotation 1 on your previous reply:\n> only this']))
  })

  it('keeps the annotations on the draft when the send fails', async () => {
    const admitted = Promise.withResolvers<SubmitOutcome>()
    const shell = shellSendingTo(() => admitted.promise)
    shell.annotations.add({ text: 'kept', source: 'step-key' })
    shell.setDraft('message')
    shell.submit()
    expect(shell.snapshot.phase).toBe('sending')
    expect(shell.annotations.snapshot().map(annotation => annotation.text)).toEqual(['kept'])

    admitted.resolve({ kind: 'error', text: 'refused' })

    await vi.waitFor(() => expect(shell.annotations.snapshot().map(annotation => annotation.text)).toEqual(['kept']))
    expect(shell.annotations.snapshot()[0]?.source).toBe('step-key')
  })

  it('leaves a message without annotations unchanged', () => {
    expect(DraftAnnotations.compose({ annotations: [], text: 'plain' })).toBe('plain')
  })
})
