// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DraftEditorRuntime } from './runtime.js'

vi.mock('./ReferenceChip.js', () => ({ ReferenceChip: () => null }))

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

const runtime = (): DraftEditorRuntime => {
  const editor = new DraftEditorRuntime({
    onUpdate: () => undefined,
    openReference: () => false,
    lexicon: () => new Map(),
    resolveLexicon: () => undefined,
  })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  editor.editor.setRootElement(root)
  disposers.push(editor.register())
  return editor
}

describe('restoreDraft', () => {
  it('rebuilds a reference span as a chip without changing the clipboard text', () => {
    const editor = runtime()
    editor.restoreDraft('look at [Image 1]', [
      {
        source: 'image-attachment',
        ref: 'draft-image-a',
        label: 'Image 1',
        appearance: 'file',
        clipboardText: '[Image 1]',
        offset: 8,
        length: 9,
      },
    ])
    editor.refreshProjection()
    const projection = editor.projection
    expect(projection.clipboardText).toBe('look at [Image 1]')
    expect(projection.occurrences).toHaveLength(1)
    expect(projection.occurrences[0]).toMatchObject({
      source: 'image-attachment',
      ref: 'draft-image-a',
      label: 'Image 1',
      offset: 8,
      length: 9,
    })
    // The detect projection counts the chip as one position, which is what a later span CAS needs.
    expect(projection.detectText).toBe('look at \uFFFC')
  })
})
