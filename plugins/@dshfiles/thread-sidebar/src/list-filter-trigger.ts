/**
 * The closed Filters trigger's tooltip (council round 34, A4; round-33 follow-ups, item 1). It shows only when it says
 * something the trigger does not: how many filters are on (the badge shows a bare number), that the preset is edited, or
 * the preset's name when the trigger cuts it. It never opens on the focus the panel gives back as it closes: from the
 * moment the panel opens it stays quiet until the pointer leaves the trigger or focus leaves it.
 */
import { useEffect, useRef, useState } from 'react'

export interface FilterTriggerTipInput {
  /** The count badge's number, or null with no filter on. */
  readonly count: number | null
  readonly edited: boolean
  /** The preset's name is cut by the trigger's width. */
  readonly truncated: boolean
}

/** Whether the tooltip adds anything to what the trigger draws. */
export const filterTriggerTipAdds = (input: FilterTriggerTipInput): boolean => input.count !== null || input.edited || input.truncated

/** Whether a text element's content is cut by its box (a `truncate` span). */
export const textTruncated = (element: HTMLElement | null): boolean => element !== null && element.scrollWidth > element.clientWidth + 1

export interface FilterTriggerTip {
  /** The tooltip's controlled open state. */
  readonly open: boolean
  readonly onOpenChange: (next: boolean) => void
  /** The trigger's `onPointerLeave` and `onBlur`: the next hover or keyboard focus may show the tooltip again. */
  readonly release: () => void
}

export const useFilterTriggerTip = (props: {
  /** The panel is open: the tooltip stays closed, and quiet after the panel closes. */
  readonly panelOpen: boolean
  /** False where the tooltip never shows (the phone scope button, a coarse pointer). */
  readonly enabled: boolean
  /** Read when the tooltip asks to open, so a truncation is measured then. */
  readonly adds: () => boolean
}): FilterTriggerTip => {
  const [open, setOpen] = useState(false)
  const quiet = useRef(false)
  // The panel state as last rendered: focus leaving the trigger for the panel never releases the quiet.
  const panelOpen = useRef(props.panelOpen)
  panelOpen.current = props.panelOpen
  useEffect(() => {
    if (!props.panelOpen) return
    quiet.current = true
    setOpen(false)
  }, [props.panelOpen])
  return {
    open: props.enabled && !props.panelOpen && open,
    onOpenChange: next => {
      if (next && (quiet.current || panelOpen.current || !props.adds())) return
      setOpen(next)
    },
    release: () => {
      if (!panelOpen.current) quiet.current = false
    },
  }
}
