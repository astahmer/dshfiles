import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Composer, useContract } from '@dshfiles/dshx/client'
import { SelectionAnnotation, type AssistantSelection } from '../../annotate-selection.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { annotatePlacement } from './selection-action-placement.ts'
import { isTouchInput } from './touch-input.ts'
import css from './AnnotateSelection.module.css'

/** The composer's annotation pill asks for its passage with this event; the detail is `text` and `source` as URL search params. */
const REVEAL_EVENT = 'dshfiles:reveal-annotation'

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
  const [touch, setTouch] = useState(false)
  const [buttonWidth, setButtonWidth] = useState(0)
  const [quoteAction, setQuoteAction] = useState<DOMRect | undefined>(undefined)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // A press on this button or on the Quote action beside it freezes the button until the click lands: otherwise
  // it vanishes (collapsed selection) or moves (Quote dismissed) under the finger, or re-renders over Quote.
  // Set from a window capture listener, ahead of the chat's document listeners; cleared after the click.
  const pressed = useRef(false)

  useEffect(() => {
    let dragging = false
    let lastPointerType = ''
    const refresh = (): void => {
      if (pressed.current) return
      const container = containerRef.current
      setTouch(isTouchInput(lastPointerType))
      setSelected(dragging || container === null ? undefined : SelectionAnnotation.selected({ container, selection: window.getSelection() }))
    }
    const onPointerDown = (event: PointerEvent): void => {
      pressed.current = event.target instanceof Element
        && event.target.closest('[data-annotate-selection], [data-text-interaction-surface]') !== null
      if (pressed.current) return
      lastPointerType = event.pointerType
      // A touch long-press selects with pointercancel and no pointerup; selectionchange carries the result.
      dragging = event.pointerType !== 'touch'
      setSelected(undefined)
    }
    const onPointerUp = (): void => {
      dragging = false
      if (pressed.current) return
      refresh()
    }
    const onClick = (): void => {
      if (!pressed.current) return
      pressed.current = false
      refresh()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('click', onClick)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerUp, true)
    document.addEventListener('selectionchange', refresh)
    document.addEventListener('scroll', refresh, true)
    window.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('scroll', refresh)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('click', onClick)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerUp, true)
      document.removeEventListener('selectionchange', refresh)
      document.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('scroll', refresh)
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

  useLayoutEffect(() => {
    setButtonWidth(buttonRef.current?.offsetWidth ?? 0)
  }, [selected, touch])

  // On touch the chat's text-interaction surface (Quote text) also sits under the selection end; follow it.
  useEffect(() => {
    pressed.current = false
    const surface = containerRef.current?.querySelector<HTMLElement>('[data-text-interaction-surface]') ?? null
    if (selected === undefined || !touch || surface === null) { setQuoteAction(undefined); return }
    const read = (): void => {
      if (pressed.current) return
      setQuoteAction(surface.style.visibility === 'visible' && surface.hasAttribute('data-touch') ? surface.getBoundingClientRect() : undefined)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(surface, { attributes: true, attributeFilter: ['style', 'data-touch'] })
    return () => observer.disconnect()
  }, [containerRef, selected, touch])

  if (selected === undefined || composer.status !== 'active') return null
  const viewport = window.visualViewport ?? { offsetLeft: 0, offsetTop: 0, width: window.innerWidth, height: window.innerHeight }
  const placement = annotatePlacement({ selection: selected.rect, end: selected.end, windowWidth: window.innerWidth, viewport, touch, buttonWidth, avoid: quoteAction })
  const add = (): void => {
    if (!composer.value.attach({ sessionId, attachment: { kind: 'annotation', text: selected.text, source: selected.source } })) return
    window.getSelection()?.removeAllRanges()
    setSelected(undefined)
    composer.value.focus({ sessionId })
  }
  return createPortal(
    <button
      type="button"
      ref={buttonRef}
      data-annotate-selection
      data-side={placement.side}
      className={css.annotate}
      style={{ left: placement.left, top: placement.top }}
      onPointerDown={event => event.preventDefault()}
      onPointerCancel={() => { pressed.current = false }}
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
