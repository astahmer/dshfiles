import { useEffect, useSyncExternalStore } from 'react'

import { BacklogFocusModel } from './backlog-focus.js'

export const usePanelRequests = (props: {
  readonly draftKey: string
  readonly visible: boolean
  readonly onFocus: (id: number) => void
  readonly onCapture: (request: { readonly id: number; readonly text: string }) => void
}): void => {
  const { visible, draftKey, onFocus, onCapture } = props
  const focus = useSyncExternalStore(BacklogFocusModel.subscribe, BacklogFocusModel.read, () => null)
  const capture = useSyncExternalStore(BacklogFocusModel.subscribe, BacklogFocusModel.readCapture, () => null)
  useEffect(() => {
    if (!visible || draftKey !== 'feed' || focus === null) return
    const id = BacklogFocusModel.take(focus)
    if (id !== null) onFocus(id)
  }, [visible, draftKey, onFocus, focus])
  useEffect(() => {
    if (!visible || draftKey !== 'feed' || capture === null) return
    const request = BacklogFocusModel.takeCapture(capture.id)
    if (request !== null) onCapture(request)
  }, [visible, draftKey, onCapture, capture])
}
