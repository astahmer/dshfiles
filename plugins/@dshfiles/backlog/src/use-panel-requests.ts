import { useEffect, useSyncExternalStore } from 'react'

import { BacklogFocusModel } from './backlog-focus.js'

/**
 * The Backlog page that is on screen claims a pending request, whatever its storage key: the main page passes no panel id
 * ("feed"), a Workbench occurrence passes its occurrence id, and only one of them is visible at a time.
 */
export const usePanelRequests = (props: {
  readonly visible: boolean
  readonly onFocus: (id: number | string) => void
  readonly onCapture: (request: { readonly id: number; readonly text: string }) => void
}): void => {
  const { visible, onFocus, onCapture } = props
  const focus = useSyncExternalStore(BacklogFocusModel.subscribe, BacklogFocusModel.read, () => null)
  const capture = useSyncExternalStore(BacklogFocusModel.subscribe, BacklogFocusModel.readCapture, () => null)
  useEffect(() => {
    if (!visible || focus === null) return
    const id = BacklogFocusModel.take(focus)
    if (id !== null) onFocus(id)
  }, [visible, onFocus, focus])
  useEffect(() => {
    if (!visible || capture === null) return
    const request = BacklogFocusModel.takeCapture(capture.id)
    if (request !== null) onCapture(request)
  }, [visible, onCapture, capture])
}
