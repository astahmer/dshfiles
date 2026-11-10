const stepSelector = '[data-chat-flow-kind="assistant-step"]'
const blockSelector = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, pre'

export interface AssistantSelection {
  readonly text: string
  readonly rect: DOMRect
  /** Locator of the selection: its assistant step's flow key and the index of the block it sits in, as URL search params. */
  readonly source: string
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
    if (text === '') return undefined
    const startBlock = elementOf(range.startContainer)?.closest(blockSelector) ?? null
    const endBlock = elementOf(range.endContainer)?.closest(blockSelector) ?? null
    const block = startBlock !== null && startBlock === endBlock ? [...step.querySelectorAll(blockSelector)].indexOf(startBlock) : -1
    const source = new URLSearchParams({ step: step.getAttribute('data-chat-flow-key') ?? '', block: String(block) }).toString()
    return { text, rect: range.getBoundingClientRect(), source }
  }

  /**
   * The element an annotation points at: the block the selection was taken from while it still holds the text,
   * else the smallest block of its assistant step that holds it, or the step itself when the text crosses blocks.
   * The step is the one `source` names while it is rendered, else the first that holds the text. Whitespace is
   * ignored, since rendered markup and a selection's text differ in line breaks.
   * @param input - the chat container, the quoted text and the locator recorded with it.
   * @returns the element to scroll to and highlight, or undefined when no step holds the text.
   */
  static targetOf = (input: { readonly container: Element; readonly text: string; readonly source: string }): Element | undefined => {
    const needle = squash(input.text)
    if (needle === '') return undefined
    const locator = new URLSearchParams(input.source)
    const stepKey = locator.get('step') ?? ''
    const holders = [...input.container.querySelectorAll(stepSelector)].filter(candidate => squash(candidate.textContent).includes(needle))
    const named = holders.find(candidate => stepKey !== '' && candidate.getAttribute('data-chat-flow-key') === stepKey)
    const step = named ?? holders[0]
    if (step === undefined) return undefined
    const blocks = [...step.querySelectorAll(blockSelector)]
    const recorded = named === undefined ? undefined : blocks[Number(locator.get('block') ?? '-1')]
    if (recorded !== undefined && squash(recorded.textContent).includes(needle)) return recorded
    return blocks
      .filter(block => squash(block.textContent).includes(needle))
      .reduce<Element>((best, block) => (squash(block.textContent).length < squash(best.textContent).length ? block : best), step)
  }
}
