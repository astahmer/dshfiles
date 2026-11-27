import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Composer, useContract } from '@dshfiles/dshx/client'
import { SelectionAnnotation, type AssistantSelection } from '../../annotate-selection.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { AnnotationQuickComment } from '../../chat-settings.ts'
import { annotatePlacement } from './selection-action-placement.ts'
import { isTouchInput } from './touch-input.ts'
import css from './AnnotateSelection.module.css'

/** The composer's annotation pill asks for its passage with this event; the detail is `text` and `source` as URL search params. */
const REVEAL_EVENT = 'dshfiles:reveal-annotation'

const CARD_MARGIN_PX = 8

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

/**
 * Floats an Annotate action over a finished assistant selection and adds it to the composer's annotations;
 * answers the pill's reveal request by scrolling to the quoted paragraph and flashing it.
 * @param props - the session, the chat scroll container, the locale seat, the shown selection action row and the
 * quick-add preference (ask for the comment first, or attach silently).
 * @returns the floating action or its comment box, or nothing while no assistant text is selected.
 */
export const AnnotateSelection = ({ sessionId, containerRef, t, actionRow, quickComment }: {
  readonly sessionId: string
  readonly containerRef: RefObject<HTMLElement | null>
  readonly t: ChatViewSlotProps['t']
  /** The chat's selection action surface while it shows an action (Quote text); Annotate joins its row. */
  readonly actionRow: HTMLElement | null
  /** Whether a press asks for the comment at the selection instead of attaching silently. */
  readonly quickComment: AnnotationQuickComment
}) => {
  const composer = useContract(Composer)
  const [selected, setSelected] = useState<AssistantSelection | undefined>(undefined)
  const [touch, setTouch] = useState(false)
  const [buttonWidth, setButtonWidth] = useState(0)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // A press on this button or on the Quote action beside it freezes the button until the click lands: otherwise
  // it vanishes (collapsed selection) or moves (Quote dismissed) under the finger, or re-renders over Quote.
  // Set from a window capture listener, ahead of the chat's document listeners; cleared after the click.
  const pressed = useRef(false)
  // The comment box keeps the selection alive while the reader types, so layout refreshes must not clear it.
  const commentingRef = useRef(false)

  useEffect(() => {
    let dragging = false
    let lastPointerType = ''
    const refresh = (): void => {
      if (pressed.current || commentingRef.current) return
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
    // A click outside the comment box drops the selection; its box (and draft comment) goes with it.
    if (selected === undefined && commentingRef.current) {
      commentingRef.current = false
      setCommenting(false)
      setComment('')
    }
  }, [selected])

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

  useLayoutEffect(() => {
    if (!commenting) return
    const card = cardRef.current
    if (card === null) return
    setCardSize({ width: card.offsetWidth, height: card.offsetHeight })
  }, [commenting, selected])

  useEffect(() => { pressed.current = false }, [selected])

  if (selected === undefined || composer.status !== 'active') return null
  // One row whenever Quote shows: two separately placed actions used to stack offset and overlap on every input kind.
  const inRow = actionRow !== null
  const viewport = window.visualViewport ?? { offsetLeft: 0, offsetTop: 0, width: window.innerWidth, height: window.innerHeight }
  const placement = annotatePlacement({ selection: selected.rect, end: selected.end, windowWidth: window.innerWidth, viewport, touch, buttonWidth })
  const add = (commentText: string): void => {
    const attachment = commentText === ''
      ? { kind: 'annotation' as const, text: selected.text, source: selected.source }
      : { kind: 'annotation' as const, text: selected.text, source: selected.source, comment: commentText }
    if (!composer.value.attach({ sessionId, attachment })) return
    window.getSelection()?.removeAllRanges()
    setSelected(undefined)
    composer.value.focus({ sessionId })
  }
  const beginComment = (): void => {
    commentingRef.current = true
    setComment('')
    setCommenting(true)
  }
  const cancelComment = (): void => {
    commentingRef.current = false
    setCommenting(false)
    setComment('')
    setSelected(undefined)
  }
  const saveComment = (): void => {
    commentingRef.current = false
    setCommenting(false)
    add(comment.trim())
  }
  const onCommentKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      saveComment()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelComment()
    }
  }

  const card = commenting ? (
    <div
      ref={cardRef}
      className={css.commentCard}
      data-annotate-selection
      style={(() => {
        const half = Math.max(cardSize.width, 240) / 2
        const left = clamp((selected.rect.left + selected.rect.right) / 2, half + CARD_MARGIN_PX, window.innerWidth - half - CARD_MARGIN_PX)
        const above = selected.rect.top - CARD_MARGIN_PX - cardSize.height
        const top = above >= CARD_MARGIN_PX
          ? above
          : Math.min(selected.rect.bottom + CARD_MARGIN_PX, window.innerHeight - cardSize.height - CARD_MARGIN_PX)
        return { left: left - half, top }
      })()}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
    >
      <textarea
        autoFocus
        rows={2}
        className={css.commentEditor}
        aria-label={t('annotation.quickAdd.placeholder')}
        placeholder={t('annotation.quickAdd.placeholder')}
        value={comment}
        onChange={event => setComment(event.currentTarget.value)}
        onKeyDown={onCommentKeyDown}
      />
      <div className={css.commentActions}>
        <button type="button" className={css.commentCancel} onClick={cancelComment} onMouseDown={event => event.preventDefault()}>
          {t('annotation.quickAdd.cancel')}
        </button>
        <button type="button" className={css.commentSave} onClick={saveComment} onMouseDown={event => event.preventDefault()}>
          {t('message.annotate')}
        </button>
      </div>
    </div>
  ) : null

  return (
    <>
      {createPortal(card, document.body)}
      {commenting ? null : createPortal(
        <button
          type="button"
          ref={buttonRef}
          data-annotate-selection
          data-side={inRow ? 'row' : placement.side}
          data-touch={inRow && touch ? '' : undefined}
          className={css.annotate}
          style={inRow ? undefined : { left: placement.left, top: placement.top }}
          onPointerDown={event => event.preventDefault()}
          onPointerCancel={() => { pressed.current = false }}
          onMouseDown={event => event.preventDefault()}
          onClick={quickComment === 'inline' ? beginComment : () => add('')}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M12 7v6M9 10h6" />
          </svg>
          {t('message.annotate')}
        </button>,
        inRow ? actionRow : document.body,
      )}
    </>
  )
}
