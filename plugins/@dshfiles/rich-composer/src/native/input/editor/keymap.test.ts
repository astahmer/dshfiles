// @vitest-environment jsdom
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, createEditor, KEY_ENTER_COMMAND } from 'lexical'
import { afterEach, describe, expect, it } from 'vitest'

import { registerComposerKeymap } from './keymap.js'

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('composer list continuation', () => {
  it.each(['- ', '1. '])('removes an empty list marker on Shift+Enter: %s', marker => {
    const editor = createEditor({ namespace: 'composer-keymap-empty-list-test' })
    disposers.push(
      registerComposerKeymap(editor, {
        arbitrate: () => 'pass',
        space: () => false,
        dismissPopup: () => undefined,
        canSubmit: () => true,
        submit: () => undefined,
        intakeFiles: () => undefined,
        pasteText: () => undefined,
      }),
    )
    const rootElement = document.createElement('div')
    rootElement.contentEditable = 'true'
    editor.setRootElement(rootElement)
    editor.setEditable(true)
    disposers.push(() => editor.setRootElement(null))
    editor.update(() => {
      const paragraph = $createParagraphNode()
      const text = $createTextNode(marker)
      paragraph.append(text)
      $getRoot().append(paragraph)
      text.selectEnd()
    }, { discrete: true })

    const enter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    editor.update(() => {
      editor.dispatchCommand(KEY_ENTER_COMMAND, enter)
    }, { discrete: true })

    expect(enter.defaultPrevented).toBe(true)
    editor.getEditorState().read(() => {
      expect($getRoot().getChildren().map(paragraph => paragraph.getTextContent())).toEqual([''])
    })
  })

  it('prevents the browser from adding a second line break after the continued marker', () => {
    const editor = createEditor({ namespace: 'composer-keymap-test' })
    disposers.push(
      registerComposerKeymap(editor, {
        arbitrate: () => 'pass',
        space: () => false,
        dismissPopup: () => undefined,
        canSubmit: () => true,
        submit: () => undefined,
        intakeFiles: () => undefined,
        pasteText: () => undefined,
      }),
    )
    const rootElement = document.createElement('div')
    rootElement.contentEditable = 'true'
    editor.setRootElement(rootElement)
    editor.setEditable(true)
    disposers.push(() => editor.setRootElement(null))
    editor.update(() => {
      const paragraph = $createParagraphNode()
      const text = $createTextNode('1. aaa')
      paragraph.append(text)
      $getRoot().append(paragraph)
      text.selectEnd()
    }, { discrete: true })

    const enter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    editor.update(() => {
      editor.dispatchCommand(KEY_ENTER_COMMAND, enter)
    }, { discrete: true })

    expect(enter.defaultPrevented).toBe(true)
    editor.getEditorState().read(() => {
      expect($getRoot().getChildren().map(paragraph => paragraph.getTextContent())).toEqual(['1. aaa', '2. '])
      const selection = $getSelection()
      expect($isRangeSelection(selection) ? selection.anchor.getNode().getTextContent() : null).toBe('2. ')
      expect($isRangeSelection(selection) ? selection.anchor.offset : null).toBe(3)
    })
  })
})
