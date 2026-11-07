// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imageAttachmentReferences } from './native/image-attachment-references.ts'
import { SessionInputShell } from './native/input/facade.ts'
import type { InputTriggerController } from './native/contract/input.ts'

vi.mock('./native/input/editor/ReferenceChip.tsx', () => ({ ReferenceChip: () => null }))

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const triggers = (): InputTriggerController => ({
  launcher: createSnapshotStore<string | null>(null),
  lexicon: createSnapshotStore<ReadonlyMap<'/' | '@', readonly string[]>>(new Map()),
  track: () => undefined,
  arbitrate: () => 'pass',
  onSpace: () => false,
  serializeReference: async () => '',
  adjudicate: async () => undefined,
  resolveClaim: async () => undefined,
  openReference: () => false,
  toggleSource: () => undefined,
})

const shellWithRoot = () => {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const shell = new SessionInputShell({
    actx: ctx,
    inputTriggers: triggers,
    defaultSink: async () => ({ kind: 'success' }),
    commandAttachments: { serialize: async () => [], release: () => undefined, unsupportedNotice: token => token },
  })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  shell.editor.setRootElement(root)
  cleanups.push(() => shell.dispose())
  return { shell, root }
}

describe('restoring a queued image token', () => {
  it('renders it as the same attachment reference a normal composer message shows', () => {
    const { shell, root } = shellWithRoot()
    const text = 'look [Image 1]'
    shell.setDraft(text)
    const [reference] = imageAttachmentReferences([{ id: 'draft-image-1' }], 0)
    expect(reference).toBeDefined()
    if (reference === undefined) return

    const inserted = shell.insertReference(reference, {
      start: text.indexOf('[Image 1]'),
      end: text.indexOf('[Image 1]') + 9,
      draftRev: shell.state.getSnapshot().draftRev,
    })

    expect(inserted).toBe(true)
    expect(shell.state.getSnapshot().draft).toBe(`${text} `)
    expect(root.querySelectorAll('[data-composer-chip="image-attachment"]')).toHaveLength(1)
    expect(root.textContent).not.toContain('[Image 1]')
  })
})
