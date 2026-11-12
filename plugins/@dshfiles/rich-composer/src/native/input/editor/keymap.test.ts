// @vitest-environment jsdom
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, createEditor, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND, KEY_ENTER_COMMAND, KEY_ESCAPE_COMMAND } from 'lexical'
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

describe('composer prompt recall keys', () => {
  const recallEditor = (handlers: { recall: (direction: string) => boolean; endRecall: () => boolean }) => {
    const editor = createEditor({ namespace: 'composer-keymap-recall-test' })
    disposers.push(
      registerComposerKeymap(editor, {
        arbitrate: () => 'pass',
        space: () => false,
        dismissPopup: () => undefined,
        canSubmit: () => true,
        submit: () => undefined,
        intakeFiles: () => undefined,
        pasteText: () => undefined,
        ...handlers,
      }),
    )
    return editor
  }
  const dispatch = (editor: ReturnType<typeof createEditor>, command: Parameters<typeof editor.dispatchCommand>[0], event: KeyboardEvent): boolean => {
    let handled = false
    editor.update(() => {
      handled = editor.dispatchCommand(command, event)
    }, { discrete: true })
    return handled
  }

  it('a bare ArrowUp or ArrowDown asks for recall and is consumed only when a prompt was shown', () => {
    const asked: string[] = []
    let shows = true
    const editor = recallEditor({ recall: direction => { asked.push(direction); return shows }, endRecall: () => false })
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    expect(dispatch(editor, KEY_ARROW_UP_COMMAND, up)).toBe(true)
    expect(up.defaultPrevented).toBe(true)
    shows = false
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    expect(dispatch(editor, KEY_ARROW_DOWN_COMMAND, down)).toBe(false)
    expect(down.defaultPrevented).toBe(false)
    expect(asked).toEqual(['older', 'newer'])
  })

  it('a modified arrow keeps selecting text and never recalls', () => {
    const asked: string[] = []
    const editor = recallEditor({ recall: direction => { asked.push(direction); return true }, endRecall: () => false })
    const shiftUp = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, cancelable: true })
    expect(dispatch(editor, KEY_ARROW_UP_COMMAND, shiftUp)).toBe(false)
    expect(asked).toEqual([])
  })

  it('Escape ends recall when no menu takes it', () => {
    let ended = 0
    const editor = recallEditor({ recall: () => false, endRecall: () => { ended += 1; return true } })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    expect(dispatch(editor, KEY_ESCAPE_COMMAND, escape)).toBe(true)
    expect(escape.defaultPrevented).toBe(true)
    expect(ended).toBe(1)
  })
})

describe('composer Enter on a touch keyboard', () => {
  const enterEditor = (enterBreaksLine: boolean) => {
    const sent: boolean[] = []
    const editor = createEditor({ namespace: 'composer-keymap-touch-enter-test' })
    disposers.push(
      registerComposerKeymap(editor, {
        arbitrate: () => 'pass',
        space: () => false,
        dismissPopup: () => undefined,
        canSubmit: () => true,
        submit: accelerated => { sent.push(accelerated) },
        enterBreaksLine: () => enterBreaksLine,
        intakeFiles: () => undefined,
        pasteText: () => undefined,
      }),
    )
    const press = (init: KeyboardEventInit): { handled: boolean; event: KeyboardEvent } => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...init })
      let handled = false
      editor.update(() => { handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event) }, { discrete: true })
      return { handled, event }
    }
    return { sent, press }
  }

  it('leaves a bare return to the line break and never sends', () => {
    const touch = enterEditor(true)
    const bare = touch.press({})
    expect(bare.handled).toBe(false)
    expect(bare.event.defaultPrevented).toBe(false)
    expect(touch.sent).toEqual([])
  })

  it('still sends on a bare Enter with a physical keyboard, and on Ctrl+Enter everywhere', () => {
    const desktop = enterEditor(false)
    expect(desktop.press({}).handled).toBe(true)
    const touch = enterEditor(true)
    expect(touch.press({ ctrlKey: true }).handled).toBe(true)
    expect(desktop.sent).toEqual([false])
    expect(touch.sent).toEqual([true])
  })
})
