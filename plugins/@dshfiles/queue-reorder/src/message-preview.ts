export const messagePreview = (content: readonly { readonly type: string; readonly text?: string }[], limit: number): string => {
  const flat = content
    .filter(block => block.type !== 'image' && block.type !== 'file')
    .map(block => (block.type === 'text' ? (block.text ?? '') : `[${block.type}]`))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const chars = Array.from(flat)
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : flat
}
