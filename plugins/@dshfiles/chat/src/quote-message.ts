import type { ComposerService } from '@dshfiles/dshx/client'

export type MessageQuoteSource =
  | { readonly role: 'user'; readonly sessionId: string; readonly seq: number }
  | { readonly role: 'assistant'; readonly sessionId: string; readonly seq: number; readonly turn: number }

const flowNodeSelector = '[data-chat-flow-kind]'
const messageActionsSelector = 'button, [data-message-actions]'

export const selectedMessageText = (input: {
  readonly button: HTMLElement
  readonly source: MessageQuoteSource
  readonly selection: Selection | null
}): { readonly text: string; readonly source: MessageQuoteSource } | undefined => {
  const selection = input.selection
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return undefined
  const range = selection.getRangeAt(0)
  const elementOf = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement)
  const startElement = elementOf(range.startContainer)
  const endElement = elementOf(range.endContainer)
  const start = startElement?.closest(flowNodeSelector)
  const end = endElement?.closest(flowNodeSelector)
  const actionNode = input.button.closest(flowNodeSelector)
  if (start === undefined || start === null || start !== end || actionNode === null) return undefined
  if (start.closest('[data-chat-flow]') !== actionNode.closest('[data-chat-flow]')) return undefined
  if (startElement?.closest(messageActionsSelector) !== null || endElement?.closest(messageActionsSelector) !== null) return undefined
  let source = input.source
  if (source.role === 'user' && start !== actionNode) return undefined
  if (source.role === 'assistant') {
    if (start.getAttribute('data-chat-flow-kind') !== 'assistant-step' || start.getAttribute('data-chat-turn') !== String(source.turn)) return undefined
    const sequence = start.getAttribute('data-chat-message-seq')
    if (sequence === null || !/^\d+$/u.test(sequence)) return undefined
    const seq = Number(sequence)
    if (!Number.isSafeInteger(seq)) return undefined
    source = { ...source, seq }
  }
  const text = selection.toString()
  return text.trim() === '' ? undefined : { text, source }
}

export const insertMessageQuote = (input: {
  readonly composer: Pick<ComposerService, 'insert' | 'focus' | 'text'>
  readonly source: MessageQuoteSource
  readonly text: string
  readonly attribution: string
}): boolean => {
  const text = input.text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
  const separator = input.composer.text({ sessionId: input.source.sessionId }) ? '\n\n' : ''
  const inserted = input.composer.insert({
    sessionId: input.source.sessionId,
    selection: 'keep',
    text: `${separator}> ${input.attribution}\n>\n${text}\n\n`,
  })
  if (inserted) input.composer.focus({ sessionId: input.source.sessionId })
  return inserted
}
