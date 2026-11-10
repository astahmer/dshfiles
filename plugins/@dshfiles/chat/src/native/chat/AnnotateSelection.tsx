import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Composer, useContract } from '@dshfiles/dshx/client'
import { SelectionAnnotation, type AssistantSelection } from '../../annotate-selection.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './AnnotateSelection.module.css'

const OPEN_EVENT = 'dshfiles:open-composer-snippet'
const HIGHLIGHT_MS = 1600
const EDGE_MARGIN_PX = 80

/**
 * Floats an Annotate action over an assistant selection, adds it to the composer as a quote chip,
 * and answers a chip's open request by scrolling to and highlighting the quoted paragraph.
 * @param props - the session, the chat scroll container, and the locale seat.
 * @returns the floating action, or nothing while no assistant text is selected.
 */
export const AnnotateSelection = ({ sessionId, containerRef, t }: {
  readonly sessionId: string
  readonly containerRef: RefObject<HTMLElement | null>
  readonly t: ChatViewSlotProps['t']
}) => {
  const composer = useContract(Composer)
  const [selected, setSelected] = useState<AssistantSelection | undefined>(undefined)

  useEffect(() => {
    const refresh = (): void => {
      const container = containerRef.current
      setSelected(container === null ? undefined : SelectionAnnotation.selected({ container, selection: window.getSelection() }))
    }
    document.addEventListener('selectionchange', refresh)
    document.addEventListener('scroll', refresh, true)
    window.addEventListener('resize', refresh)
    return () => {
      document.removeEventListener('selectionchange', refresh)
      document.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', refresh)
    }
  }, [containerRef])

  useEffect(() => {
    const open = (event: Event): void => {
      const container = containerRef.current
      const text = event instanceof CustomEvent ? String(event.detail) : ''
      if (container === null || text === '') return
      const target = SelectionAnnotation.targetOf({ container, text })
      if (target === undefined) return
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target.animate(
        [{ backgroundColor: 'var(--dsw-alias-state-business-tertiary)' }, { backgroundColor: 'transparent' }],
        { duration: HIGHLIGHT_MS, easing: 'ease-out' },
      )
    }
    window.addEventListener(OPEN_EVENT, open)
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [containerRef])

  if (selected === undefined || composer.status !== 'active') return null
  const left = Math.min(Math.max(selected.rect.left + selected.rect.width / 2, EDGE_MARGIN_PX), window.innerWidth - EDGE_MARGIN_PX)
  const add = (): void => {
    if (!composer.value.attach({ sessionId, attachment: { kind: 'quote', text: selected.text } })) return
    window.getSelection()?.removeAllRanges()
  }
  return createPortal(
    <button type="button" className={css.annotate} style={{ left, top: selected.rect.top }} onMouseDown={event => event.preventDefault()} onClick={add}>
      {t('message.annotate')}
    </button>,
    document.body,
  )
}
