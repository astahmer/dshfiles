/**
 * One hover-to-preview wrapper for every reference kind: a dwell opens the shared entity card under the element, focus
 * opens it at once, and leaving or blurring dismisses it after the card's own grace period. Providers keep their own
 * activation gesture; this only owns the preview lifecycle, so each kind shows the same card the same way.
 */
import { useEffect, useRef, type ReactNode } from 'react'

import { EntityPreview } from './entity-registry.js'

/** A pointer sweeping across a line of text should not flash a card, so hovering waits. */
const OPEN_DELAY_MS = 160

export interface ReferencePreviewAnchorProps {
  readonly kind: string
  readonly id: string
  /** An optional sub-range of the entity (a memory citation's event range). */
  readonly range?: string | undefined
  /** Render the reference without a card (a static preview, or a kind whose provider is not loaded). */
  readonly disabled?: boolean | undefined
  readonly children: ReactNode
}

/**
 * Wrap one rendered reference so hovering or focusing it opens the shared preview card.
 * @param props - the entity identity to preview and the reference element to anchor on.
 * @returns the reference wrapped in an inline anchor.
 */
export const ReferencePreviewAnchor = (props: ReferencePreviewAnchorProps): JSX.Element => {
  const timer = useRef<number | undefined>(undefined)
  const opened = useRef(false)

  const cancel = (): void => {
    if (timer.current === undefined) return
    window.clearTimeout(timer.current)
    timer.current = undefined
  }

  const open = (element: Element): void => {
    cancel()
    // Selecting text across a reference is a copy gesture, not a request for its card.
    if (document.getSelection()?.isCollapsed === false) return
    opened.current = EntityPreview.request({ kind: props.kind, id: props.id, range: props.range }, element)
  }

  const dismiss = (): void => {
    cancel()
    if (!opened.current) return
    opened.current = false
    EntityPreview.dismiss()
  }

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
      if (opened.current) EntityPreview.dismiss()
    },
    [],
  )

  return (
    <span
      data-dshfiles-reference-anchor={props.kind}
      onBlur={props.disabled === true ? undefined : dismiss}
      onFocus={props.disabled === true ? undefined : event => open(event.currentTarget)}
      onKeyDown={event => {
        if (event.key !== 'Escape' || props.disabled === true) return
        dismiss()
      }}
      onPointerEnter={event => {
        if (props.disabled === true) return
        const element = event.currentTarget
        cancel()
        timer.current = window.setTimeout(() => {
          timer.current = undefined
          open(element)
        }, OPEN_DELAY_MS)
      }}
      onPointerLeave={props.disabled === true ? undefined : dismiss}
    >
      {props.children}
    </span>
  )
}
