/** Context menu for terminal URLs with open options. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'

export interface TerminalLinkMenuState {
  /** The URL being shown. */
  readonly url: string
  /** Position for the menu. */
  readonly x: number
  readonly y: number
}

export interface TerminalLinkMenuProps {
  /** Currently open menu state, or undefined when closed. */
  readonly state: TerminalLinkMenuState | undefined
  /** Close the menu. */
  readonly onClose: () => void
  /** Open the URL in the internal preview browser. */
  readonly onOpenInternal: (url: string) => void
  /** Open the URL in an external browser tab. */
  readonly onOpenExternal: (url: string) => void
  /** Whether the internal browser is available. */
  readonly internalAvailable: boolean
  /** CSS module classes. */
  readonly css: Record<string, string>
}

/**
 * Context menu for terminal links with options to open in internal or external browser.
 * Uses a virtual trigger positioned at the click coordinates.
 */
export function TerminalLinkMenu({
  state,
  onClose,
  onOpenInternal,
  onOpenExternal,
  internalAvailable,
  css,
}: TerminalLinkMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (state !== undefined) {
      setOpen(true)
    }
  }, [state])

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen)
      if (!isOpen) {
        onClose()
      }
    },
    [onClose],
  )

  const handleOpenInternal = useCallback(() => {
    if (state !== undefined) {
      onOpenInternal(state.url)
    }
    setOpen(false)
    onClose()
  }, [state, onOpenInternal, onClose])

  const handleOpenExternal = useCallback(() => {
    if (state !== undefined) {
      onOpenExternal(state.url)
    }
    setOpen(false)
    onClose()
  }, [state, onOpenExternal, onClose])

  if (state === undefined) return null

  return (
    <ContextMenu open={open} onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        <span
          ref={triggerRef}
          className={css.linkMenuTrigger}
          style={{
            position: 'absolute',
            left: state.x,
            top: state.y,
            width: 1,
            height: 1,
            pointerEvents: 'none',
          }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="dshx-root dshx:min-w-48">
        <ContextMenuItem
          disabled={!internalAvailable}
          onSelect={handleOpenInternal}
        >
          Open in Preview
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleOpenExternal}>
          Open in Browser
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
