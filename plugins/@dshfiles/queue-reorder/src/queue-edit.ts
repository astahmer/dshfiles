interface QueueTextBlock {
  readonly type: string
  readonly text?: string
}

export const editableQueueText = (content: readonly QueueTextBlock[]): string | null => {
  if (content.some(block => block.type !== 'text')) return null
  const text = content.map(block => block.text ?? '').join('')
  return text.trim().length > 0 ? text : null
}
