const stepSelector = '[data-chat-flow-kind="assistant-step"]'
const blockSelector = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, pre'

export interface AssistantSelection {
  readonly text: string
  readonly rect: DOMRect
}

const elementOf = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement)
const stepOf = (node: Node): Element | null => elementOf(node)?.closest(stepSelector) ?? null
const squash = (text: string | null): string => (text ?? '').replace(/\s+/gu, '')

/** Quote annotations on assistant text: what a selection covers, where a quote lives in the chat, and how an open request reads. */
export class SelectionAnnotation {
  /**
   * The assistant text a selection covers, when it lies inside one assistant step of the container.
   * @param input - the chat container and the current window selection.
   * @returns the selected text and its viewport rectangle, or undefined.
   */
  static selected = (input: { readonly container: Element; readonly selection: Selection | null }): AssistantSelection | undefined => {
    const selection = input.selection
    if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return undefined
    const range = selection.getRangeAt(0)
    const step = stepOf(range.startContainer)
    if (step === null || step !== stepOf(range.endContainer) || !input.container.contains(step)) return undefined
    const text = selection.toString().trim()
    return text === '' ? undefined : { text, rect: range.getBoundingClientRect() }
  }

  /**
   * The element an annotation points at: the smallest block of the assistant step that holds the quoted text,
   * or the step itself when the text crosses blocks. Whitespace is ignored, since rendered markup and a selection's text differ in line breaks.
   * @param input - the chat container and the quoted text.
   * @returns the element to scroll to and highlight, or undefined when no step holds the text.
   */
  static targetOf = (input: { readonly container: Element; readonly text: string }): Element | undefined => {
    const needle = squash(input.text)
    if (needle === '') return undefined
    const step = [...input.container.querySelectorAll(stepSelector)].find(candidate => squash(candidate.textContent).includes(needle))
    if (step === undefined) return undefined
    return [...step.querySelectorAll(blockSelector)]
      .filter(block => squash(block.textContent).includes(needle))
      .reduce<Element>((best, block) => (squash(block.textContent).length < squash(best.textContent).length ? block : best), step)
  }
}
