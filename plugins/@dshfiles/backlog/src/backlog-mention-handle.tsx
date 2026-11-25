import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'

import { BacklogMentionDrag } from './backlog-mention-drag.js'
import { BacklogReference } from './backlog-reference.js'

/** An item's `b:<ref>` label (or `children` in its place); dragging it onto a thread composer mentions the item. */
export const BacklogMentionHandle = (props: {
  readonly item: { readonly id: number; readonly ref?: string | undefined; readonly title: string }
  readonly className?: string
  readonly children?: ReactNode
}): JSX.Element => (
  <span
    draggable
    onDragStart={event => BacklogMentionDrag.write(event.dataTransfer, props.item)}
    data-backlog-mention-handle=""
    className={cn('dshx:cursor-grab dshx:font-mono!', props.className)}
  >
    {props.children ?? BacklogReference.labelOf(props.item)}
  </span>
)
