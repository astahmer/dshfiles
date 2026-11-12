import { useEffect, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Composer, useContract } from '@dshfiles/dshx/client'
import { SelectionAnnotation, type AssistantSelection } from '../../annotate-selection.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './AnnotateSelection.module.css'

/** The composer's annotation pill asks for its passage with this event; the detail is `text` and `source` as URL search params. */
const REVEAL_EVENT = 'dshfiles:reveal-annotation'
const EDGE_MARGIN_PX = 72

/**
 * Floats an Annotate action over a finished assistant selection and adds it to the composer's annotation pill;
 * answers the pill's reveal request by scrolling to the quoted paragraph and flashing it.
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
    let dragging = false
    const refresh = (): void => {
      const container = containerRef.current
      setSelected(dragging || container === null ? undefined : SelectionAnnotation.selected({ container, selection: window.getSelection() }))
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-annotate-selection]') !== null) return
      dragging = true
      setSelected(undefined)
    }
    const onPointerUp = (): void => {
      dragging = false
      refresh()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('selectionchange', refresh)
    document.addEventListener('scroll', refresh, true)
    window.addEventListener('resize', refresh)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('selectionchange', refresh)
      document.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', refresh)
    }
  }, [containerRef])

  useEffect(() => {
    const reveal = (event: Event): void => {
      const container = containerRef.current
      const detail = new URLSearchParams(event instanceof CustomEvent ? String(event.detail) : '')
      const text = detail.get('text') ?? ''
      if (container === null || text === '') return
      const target = SelectionAnnotation.targetOf({ container, text, source: detail.get('source') ?? '' })
      if (target === undefined) return
      const scroller = container.closest<HTMLElement>('[data-conversation-scroll]') ?? container
      const composerHeight = scroller.querySelector<HTMLElement>('[data-composer-seat]')?.offsetHeight ?? 0
      const box = scroller.getBoundingClientRect()
      const rect = target.getBoundingClientRect()
      const centered = scroller.scrollTop + rect.top - box.top - (scroller.clientHeight - composerHeight - rect.height) / 2
      scroller.scrollTo({ top: Math.max(0, centered) })
      target.removeAttribute('data-annotation-flash')
      void target.getBoundingClientRect()
      target.setAttribute('data-annotation-flash', '')
      target.addEventListener('animationend', () => target.removeAttribute('data-annotation-flash'), { once: true })
    }
    window.addEventListener(REVEAL_EVENT, reveal)
    return () => window.removeEventListener(REVEAL_EVENT, reveal)
  }, [containerRef])

  if (selected === undefined || composer.status !== 'active') return null
  const left = Math.min(Math.max(selected.rect.left + selected.rect.width / 2, EDGE_MARGIN_PX), window.innerWidth - EDGE_MARGIN_PX)
  const add = (): void => {
    if (!composer.value.attach({ sessionId, attachment: { kind: 'annotation', text: selected.text, source: selected.source } })) return
    window.getSelection()?.removeAllRanges()
    setSelected(undefined)
    composer.value.focus({ sessionId })
  }
  return createPortal(
    <button
      type="button"
      data-annotate-selection
      className={css.annotate}
      // --annotate-bottom serves touch, where the button sits under the selection (b:ysaj).
      style={{ left, '--annotate-top': `${String(selected.rect.top)}px`, '--annotate-bottom': `${String(selected.rect.bottom)}px` } as CSSProperties}
      onMouseDown={event => event.preventDefault()}
      onClick={add}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M12 7v6M9 10h6" />
      </svg>
      {t('message.annotate')}
    </button>,
    document.body,
  )
}
