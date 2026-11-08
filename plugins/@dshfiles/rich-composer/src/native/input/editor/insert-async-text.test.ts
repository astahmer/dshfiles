// @vitest-environment jsdom
import { $getRoot, $isElementNode, $isLineBreakNode, type LexicalNode } from 'lexical'
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

const lineBreaks = (editor: DraftEditorRuntime): number =>
  editor.editor.getEditorState().read(() => {
    const count = (node: LexicalNode): number =>
      ($isLineBreakNode(node) ? 1 : 0) + ($isElementNode(node) ? node.getChildren().reduce((sum, child) => sum + count(child), 0) : 0)
    return count($getRoot())
  })

describe('insertAsyncText', () => {
  it('turns line breaks into line-break nodes and keeps the caret after a trailing blank line', () => {
    const editor = runtime()
    editor.setDraft('before')
    editor.refreshProjection()
    const end = editor.projection.detectText.length
    expect(editor.insertAsyncText({ start: end, end }, '\n\n> quoted\n— You\n\n')).toBe(true)
    editor.refreshProjection()
    expect(editor.projection.clipboardText).toBe('before\n\n> quoted\n— You\n\n')
    expect(lineBreaks(editor)).toBe(5)
    // The caret sits after the last break, so the reply starts on the fresh line.
    const caret = editor.caretSpan()
    expect(caret).toEqual({ start: editor.projection.detectText.length, end: editor.projection.detectText.length })
  })

  it('keeps a single-line insert as plain text', () => {
    const editor = runtime()
    editor.setDraft('ab')
    editor.refreshProjection()
    expect(editor.insertAsyncText({ start: 1, end: 1 }, 'X')).toBe(true)
    editor.refreshProjection()
    expect(editor.projection.clipboardText).toBe('aXb')
    expect(lineBreaks(editor)).toBe(0)
  })
})
