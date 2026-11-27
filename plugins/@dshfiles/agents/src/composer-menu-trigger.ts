import { useState, type MouseEvent, type PointerEvent } from 'react'

/**
 * Open a composer menu on click, not on pointer-down. Radix opens a dropdown on pointer-down, and on a phone the kit
 * shows it as a sheet over the composer, so the finger's release landed on whatever row appeared under it and chose
 * it (a tap on the agent chip cleared the project default). Keyboard opening stays Radix's own.
 */
export const useClickOpenedMenu = (onOpen?: () => void) => {
  const [open, setOpen] = useState(false)
  const change = (next: boolean): void => {
    setOpen(next)
    if (next) onOpen?.()
  }
  return {
    open,
    onOpenChange: change,
    triggerProps: {
      onPointerDown: (event: PointerEvent) => {
        // Radix skips its own pointer-down toggle when the event is already prevented.
        if (event.button === 0 && !event.ctrlKey) event.preventDefault()
      },
      onClick: (event: MouseEvent) => {
        // A keyboard Enter or Space reaches here as a click too; Radix already opened on its key-down then.
        if (event.detail === 0) return
        change(!open)
      },
    },
  }
}
