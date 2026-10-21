import { InlineTitleEditor } from '@dshfiles/plugin-ui/components/ui/inline-title-editor'
import { useEffect, useRef, useState, type MouseEvent } from 'react'

import { BacklogItems } from './item.js'
import { interactiveTargets } from './item-text.js'
import { useBacklogActions } from './use-backlog-actions.js'

/** A second click this soon claims the row for its title editor; a lone click still opens the item. */
const DOUBLE_CLICK_MS = 250

export interface BacklogInlineRename {
  readonly renaming: boolean
  /** Opens the item once the double-click window passes, so a second click can rename instead. */
  readonly openSoon: () => void
  readonly renameOnDoubleClick: (event: MouseEvent<HTMLElement>) => void
  readonly endRename: () => void
}

/**
 * The rename gesture shared by the feed entry, the Items row and the board card: a double click on anything that
 * is not a link, chip or button swaps the title for its editor, and the click that would have opened the item
 * waits for the second one to arrive first.
 */
export const useBacklogInlineRename = (open: () => void): BacklogInlineRename => {
  const [renaming, setRenaming] = useState(false)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelOpen = (): void => {
    if (pending.current === null) return
    clearTimeout(pending.current)
    pending.current = null
  }
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current)
    },
    [],
  )
  const openSoon = (): void => {
    cancelOpen()
    pending.current = setTimeout(() => {
      pending.current = null
      open()
    }, DOUBLE_CLICK_MS)
  }
  const renameOnDoubleClick = (event: MouseEvent<HTMLElement>): void => {
    if (event.target instanceof Element && event.target.closest(interactiveTargets) !== null) return
    cancelOpen()
    setRenaming(true)
  }
  return { renaming, openSoon, renameOnDoubleClick, endRename: () => setRenaming(false) }
}

/** The title input a renaming row swaps in for its rendered markdown title. */
export const BacklogInlineTitle = (props: {
  readonly id: number
  readonly title: string
  readonly className: string
  readonly cancel: () => void
}): JSX.Element => {
  const actions = useBacklogActions()
  return (
    <InlineTitleEditor
      value={props.title}
      label="Item title"
      maxLength={BacklogItems.maxTitleChars}
      className={props.className}
      onCancel={props.cancel}
      onCommit={title => {
        props.cancel()
        actions.update.mutate({ id: props.id, title })
      }}
    />
  )
}
