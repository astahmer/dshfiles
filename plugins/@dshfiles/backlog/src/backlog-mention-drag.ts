import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'

import { BacklogMentions } from './backlog-mentions.js'
import { BacklogReference } from './backlog-reference.js'

const MIME = 'application/x-dshfiles-backlog-mention'

interface DragSink {
  effectAllowed: string
  setData: (format: string, value: string) => void
}

interface DragSource {
  readonly types: readonly string[]
  getData: (format: string) => string
}

/**
 * A dragged item carries `b:<ref>` as plain text, so any text field gets the reference the renderers already link,
 * and its own type, so a thread composer inserts the same chip the `@b:` picker does.
 */
const write = (dataTransfer: DragSink, item: { readonly id: number; readonly ref?: string | undefined; readonly title: string }): void => {
  const ref = BacklogReference.refOf(item)
  dataTransfer.setData(MIME, JSON.stringify({ ref, title: item.title }))
  dataTransfer.setData('text/plain', BacklogReference.label(ref))
  dataTransfer.effectAllowed = 'copy'
}

const has = (dataTransfer: DragSource | null | undefined): boolean => dataTransfer?.types.includes(MIME) === true

const read = (dataTransfer: DragSource | null | undefined): ReferenceInsert | null => {
  if (dataTransfer === null || dataTransfer === undefined || !has(dataTransfer)) return null
  const value = BacklogMentions.decodeRef(dataTransfer.getData(MIME))
  return value === null ? null : BacklogMentions.referenceInsert(value)
}

export const BacklogMentionDrag = { MIME, write, has, read }
