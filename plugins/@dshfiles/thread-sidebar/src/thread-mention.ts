export interface TextInsertion {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

export type ComposerSelection =
  | { readonly kind: 'text'; readonly element: HTMLInputElement | HTMLTextAreaElement; readonly start: number; readonly end: number }
  | { readonly kind: 'contenteditable'; readonly element: HTMLElement; readonly range: Range }

export const insertTextAtSelection = ({ value, selectionStart, selectionEnd }: TextInsertion, text: string): TextInsertion => {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))
  const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`
  const caret = start + text.length
  return { value: nextValue, selectionStart: caret, selectionEnd: caret }
}

const isTextInput = (element: Element | null): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'password'].includes(element.type))

const composerSelector = '[role="textbox"]:not([aria-disabled="true"]), textarea:not([disabled])'

export const captureComposerSelection = (): ComposerSelection | null => {
  const activeElement = document.activeElement
  if (isTextInput(activeElement)) {
    return {
      kind: 'text',
      element: activeElement,
      start: activeElement.selectionStart ?? activeElement.value.length,
      end: activeElement.selectionEnd ?? activeElement.value.length,
    }
  }
  if (!(activeElement instanceof HTMLElement) || !activeElement.isContentEditable) return null
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || !activeElement.contains(selection.anchorNode)) return null
  return { kind: 'contenteditable', element: activeElement, range: selection.getRangeAt(0).cloneRange() }
}

const insertIntoTextInput = (element: HTMLInputElement | HTMLTextAreaElement, start: number, end: number, text: string): void => {
  const insertion = insertTextAtSelection({ value: element.value, selectionStart: start, selectionEnd: end }, `${text} `)
  const safeStart = Math.max(0, Math.min(start, element.value.length))
  const safeEnd = Math.max(safeStart, Math.min(end, element.value.length))
  element.focus()
  element.setRangeText(`${text} `, safeStart, safeEnd, 'end')
  element.setSelectionRange(insertion.selectionStart, insertion.selectionEnd)
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: `${text} ` }))
}

export const insertThreadMention = (sessionId: string, savedSelection: ComposerSelection | null): boolean => {
  const selection = savedSelection ?? captureComposerSelection()
  if (selection?.kind === 'text' && selection.element.isConnected) {
    insertIntoTextInput(selection.element, selection.start, selection.end, `@thread:${sessionId}`)
    return true
  }
  if (selection?.kind === 'contenteditable' && selection.element.isConnected) {
    const range = selection.range
    range.deleteContents()
    const node = document.createTextNode(`@thread:${sessionId} `)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    selection.element.focus()
    const browserSelection = window.getSelection()
    browserSelection?.removeAllRanges()
    browserSelection?.addRange(range)
    selection.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: node.textContent }))
    return true
  }
  const composer = document.querySelector<HTMLElement>(composerSelector)
  if (isTextInput(composer)) {
    insertIntoTextInput(composer, composer.selectionStart ?? composer.value.length, composer.selectionEnd ?? composer.value.length, `@thread:${sessionId}`)
    return true
  }
  return false
}
