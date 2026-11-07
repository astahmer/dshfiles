import type { ComposerService } from '@dshfiles/dshx/client'

export interface MessageQuoteSource {
  readonly sessionId: string
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly turn?: number
}

export const selectedMessageText = (input: {
  readonly button: HTMLElement
  readonly source: MessageQuoteSource
  readonly selection: Selection | null
}): string | undefined => {
  const selection = input.selection
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return undefined
  const range = selection.getRangeAt(0)
  const elementOf = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement)
  const start = elementOf(range.startContainer)?.closest('[data-chat-flow-kind]')
  const end = elementOf(range.endContainer)?.closest('[data-chat-flow-kind]')
  const actionNode = input.button.closest('[data-chat-flow-kind]')
  if (start === undefined || start === null || start !== end || actionNode === null) return undefined
  if (start.closest('[data-chat-flow]') !== actionNode.closest('[data-chat-flow]')) return undefined
  if (input.source.role === 'user' && start !== actionNode) return undefined
  if (
    input.source.role === 'assistant' &&
    (start.getAttribute('data-chat-flow-kind') !== 'assistant-step' ||
      start.getAttribute('data-chat-turn') !== String(input.source.turn) ||
      start.getAttribute('data-chat-message-seq') !== String(input.source.seq))
  )
    return undefined
  if (
    elementOf(range.startContainer)?.closest('button, [data-message-actions]') !== null ||
    elementOf(range.endContainer)?.closest('button, [data-message-actions]') !== null
  )
    return undefined
  const text = selection.toString()
  return text.trim() === '' ? undefined : text
}

export const insertMessageQuote = (input: {
  readonly composer: Pick<ComposerService, 'insert' | 'focus'>
  readonly source: MessageQuoteSource
  readonly text: string
  readonly attribution: string
}): boolean => {
  const text = input.text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
  const inserted = input.composer.insert({
    sessionId: input.source.sessionId,
    replaceSelection: false,
    text: `\n\n> ${input.attribution}\n>\n${text}\n\n`,
  })
  if (inserted) input.composer.focus({ sessionId: input.source.sessionId })
  return inserted
}
