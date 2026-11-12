/**
 * dshfiles (productivity pass T1.5): a reply that only acknowledges its tools. Kept deliberately narrow: "OK." or
 * "Done." can be a real answer to a question, so only the mechanical tool acknowledgements count.
 */
import type { AssistantBlock } from '../contract/snapshot.ts'

const TOOL_ACKNOWLEDGEMENT = /^tool(?: call)?s? (?:finished|completed|done)\.?$/i

/** Every visible block is text and the text, taken together, is one tool acknowledgement. */
export const isToolAcknowledgement = (blocks: readonly AssistantBlock[]): boolean => {
  const visible = blocks.filter(block => block.kind !== 'tool-call' && !(block.kind === 'reasoning' && block.text.trim() === ''))
  if (visible.length === 0 || visible.some(block => block.kind !== 'text')) return false
  const text = visible.map(block => (block.kind === 'text' ? block.text : '')).join(' ').trim()
  return TOOL_ACKNOWLEDGEMENT.test(text)
}
