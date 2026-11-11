import { BacklogReference } from './backlog-reference.js'
import { backlogItemMarkdown } from './item-markdown.js'

type CopySelection = readonly { readonly id: number; readonly ref?: string | undefined }[]

type ItemCopyEntry = {
  readonly key: 'id' | 'link' | 'markdown'
  readonly label: string
  readonly text: () => string
}

/** What the item menu's Copy submenu offers, in order; the selection decides plural labels. */
export const itemCopyEntries = (input: {
  readonly item: Parameters<typeof backlogItemMarkdown>[0]
  readonly selection: CopySelection
}): readonly ItemCopyEntry[] => {
  const many = input.selection.length > 1
  return [
    { key: 'id', label: many ? 'Item IDs' : 'Item ID', text: () => input.selection.map(BacklogReference.refOf).join(', ') },
    { key: 'link', label: many ? 'Links' : 'Link', text: () => input.selection.map(BacklogReference.labelOf).join(' ') },
    { key: 'markdown', label: 'Markdown', text: () => backlogItemMarkdown(input.item) },
  ]
}
