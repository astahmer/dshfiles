/** Inline draft annotations: a marker beside each quoted passage, and its comment where the reader looks. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Popover, PopoverAnchor, PopoverContent } from '@dshfiles/plugin-ui/components/ui/popover'
import { MessageSquareTextIcon, PencilIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { Composer, useContract, type ComposerAnnotation } from '@dshfiles/dshx/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { AnnotationMarks as AnnotationMarksMode } from '../../chat-settings.ts'
import {
  annotationAnchors, columnLeft, markerPlacement, stackTops,
  type AnnotationAnchor, type Box,
} from './annotation-anchors.ts'
import css from './annotation-marks.module.css'

/** Chat answers a marker's reveal request by scrolling to the quoted paragraph and flashing it. */
const REVEAL_EVENT = 'dshfiles:reveal-annotation'

const EMPTY_ANNOTATIONS: readonly ComposerAnnotation[] = []
const EMPTY_LAYOUT_COLUMN: Box = { left: 0, top: 0, right: 0, bottom: 0 }

/** No subscription while no composer is bound; a stable no-op keeps useSyncExternalStore happy. */
const noSubscribe = (): (() => void) => () => {}

type Translate = ChatViewSlotProps['t']

interface Band {
  readonly top: number
  readonly bottom: number
}

interface Layout {
  readonly anchors: readonly AnnotationAnchor[]
  readonly column: Box
  readonly band: Band
}

const emptyLayout: Layout = { anchors: [], column: EMPTY_LAYOUT_COLUMN, band: { top: 0, bottom: 0 } }

const boxOf = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height })

const scrollportOf = (container: Element): Element =>
  container.closest('[data-conversation-scroll]') ?? container

/**
 * The draft annotations of one Session as a live list.
 * @param input - the Session whose composer owns the annotations and whether its composer contract is active.
 * @returns the annotations, in the order they were added.
 */
const useDraftAnnotations = (input: { readonly sessionId: string; readonly enabled: boolean }): readonly ComposerAnnotation[] => {
  const composer = useContract(Composer)
  const active = input.enabled && composer.status === 'active' ? composer.value : undefined
  const feed = useMemo(() => active?.annotations({ sessionId: input.sessionId }), [active, input.sessionId])
  return useSyncExternalStore(feed?.subscribe ?? noSubscribe, feed?.get ?? (() => EMPTY_ANNOTATIONS), () => EMPTY_ANNOTATIONS)
}

/**
 * Resolve the draft's annotations onto the rendered transcript whenever layout can move them: scroll, resize, a
 * streamed reply that changes paragraph positions, or the annotation list itself.
 * @param input - the chat column, the annotations and the chosen inline shape.
 * @returns anchors plus the column and the vertical band their markers live in.
 */
const useAnnotationLayout = (input: {
  readonly containerRef: RefObject<HTMLElement | null>
  readonly annotations: readonly ComposerAnnotation[]
  readonly mode: AnnotationMarksMode
}): Layout => {
  const [layout, setLayout] = useState<Layout>(emptyLayout)
  const { containerRef, annotations, mode } = input
  useEffect(() => {
    const container = containerRef.current
    if (container === null || mode === 'off') {
      setLayout(emptyLayout)
      return
    }
    let frame: number | undefined
    let disposed = false
    const measure = (): void => {
      frame = undefined
      if (disposed) return
      const column = boxOf(container.getBoundingClientRect())
      const scrollport = scrollportOf(container).getBoundingClientRect()
      const composer = container.closest('[data-conversation-scroll]')?.querySelector<HTMLElement>('[data-composer-seat]')
      const composerTop = composer === undefined ? window.innerHeight : composer.getBoundingClientRect().top
      const band = {
        top: Math.max(0, scrollport.top),
        bottom: Math.min(window.innerHeight, composerTop > 0 ? composerTop : window.innerHeight),
      }
      setLayout({ anchors: annotationAnchors({ container, annotations, mode }), column, band })
    }
    const schedule = (): void => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(measure)
    }
    const view = container.ownerDocument.defaultView
    if (view === null) return
    const mutations = new MutationObserver(schedule)
    mutations.observe(container, { childList: true, subtree: true, characterData: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(container)
    const scrollport = scrollportOf(container)
    view.addEventListener('resize', schedule)
    scrollport.addEventListener('scroll', schedule, { passive: true })
    view.visualViewport?.addEventListener('resize', schedule)
    view.visualViewport?.addEventListener('scroll', schedule)
    schedule()
    return () => {
      disposed = true
      if (frame !== undefined) view.cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
      view.removeEventListener('resize', schedule)
      scrollport.removeEventListener('scroll', schedule)
      view.visualViewport?.removeEventListener('resize', schedule)
      view.visualViewport?.removeEventListener('scroll', schedule)
    }
  }, [containerRef, annotations, mode])
  return layout
}

const reveal = (annotation: ComposerAnnotation): void => {
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, {
    detail: new URLSearchParams({ text: annotation.text, source: annotation.source }).toString(),
  }))
}

/**
 * The comment on one annotation, editable in place. Enter saves, Shift+Enter breaks the line, Escape cancels.
 * @param props - the annotation, the save/remove verbs and the locale seat.
 * @returns the card's body.
 */
const CommentBody = ({ annotation, onSave, onRemove, t }: {
  readonly annotation: ComposerAnnotation
  readonly onSave: (comment: string) => void
  readonly onRemove: () => void
  readonly t: Translate
}): ReactNode => {
  const [editing, setEditing] = useState<{ readonly comment: string } | null>(null)
  const save = (): void => {
    if (editing === null) return
    onSave(editing.comment)
    setEditing(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      save()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setEditing(null)
    }
  }
  return (
    <div className={css.card}>
      <p className={css.quote}>{annotation.text}</p>
      {editing === null ? (
        <p className={annotation.comment === '' ? `${css.comment} ${css.empty}` : css.comment}>
          {annotation.comment === '' ? t('annotation.marks.addComment') : annotation.comment}
        </p>
      ) : (
        <textarea
          autoFocus
          rows={2}
          className={css.editor}
          aria-label={t('annotation.marks.edit')}
          placeholder={t('annotation.marks.placeholder')}
          value={editing.comment}
          onChange={event => setEditing({ comment: event.currentTarget.value })}
          onKeyDown={onKeyDown}
          onBlur={save}
        />
      )}
      <div className={css.actions}>
        {editing === null ? (
          <button type="button" className={css.action} onClick={() => setEditing({ comment: annotation.comment })}>
            <PencilIcon aria-hidden className={css.icon} />{t('annotation.marks.edit')}
          </button>
        ) : null}
        <button type="button" className={css.action} onClick={() => reveal(annotation)}>
          <MessageSquareTextIcon aria-hidden className={css.icon} />{t('annotation.marks.reveal')}
        </button>
        <button type="button" className={css.action} onClick={onRemove}>
          <Trash2Icon aria-hidden className={css.icon} />{t('annotation.marks.delete')}
        </button>
      </div>
    </div>
  )
}

/** One numbered control that opens its comment under itself. */
const Marker = ({ anchor, index, left, top, onSave, onRemove, t }: {
  readonly anchor: AnnotationAnchor
  readonly index: number
  readonly left: number
  readonly top: number
  readonly onSave: (comment: string) => void
  readonly onRemove: () => void
  readonly t: Translate
}): ReactNode => (
  <Popover>
    <PopoverAnchor asChild>
      <button
        type="button"
        className={css.marker}
        style={{ left, top }}
        aria-label={t('annotation.marks.marker', { index: index + 1 })}
        onPointerDown={event => event.preventDefault()}
      >
        {index + 1}
      </button>
    </PopoverAnchor>
    <PopoverContent side="bottom" align="start" className={css.popover}>
      <CommentBody annotation={anchor.annotation} onSave={onSave} onRemove={onRemove} t={t} />
    </PopoverContent>
  </Popover>
)

/** Reports its card's measured height once, so the column can stack without guessing. */
const CardMeasure = ({ onMeasure }: { readonly onMeasure: (height: number) => void }): ReactNode => {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const node = ref.current
    if (node === null) return
    const card = node.closest('[data-annotation-card]')
    if (card === null) return
    const observer = new ResizeObserver(() => { onMeasure(card.getBoundingClientRect().height) })
    observer.observe(card)
    return () => { observer.disconnect() }
  }, [onMeasure])
  return <span ref={ref} hidden />
}

/**
 * The draft's annotations where they belong: a numbered marker beside each quoted paragraph, opening its comment,
 * plus — when the window leaves room — a comments column that follows those paragraphs.
 * @param props - the Session, the chat column, the chosen inline shape and the locale seat.
 * @returns the marker and comment layers, or nothing while the draft holds no annotation.
 */
export const AnnotationMarks = ({ sessionId, containerRef, mode, t }: {
  readonly sessionId: string
  readonly containerRef: RefObject<HTMLElement | null>
  readonly mode: AnnotationMarksMode
  readonly t: Translate
}) => {
  const composer = useContract(Composer)
  const composerActive = composer.status === 'active'
  const annotations = useDraftAnnotations({ sessionId, enabled: composerActive })
  const layout = useAnnotationLayout({ containerRef, annotations, mode })
  const [cardHeights, setCardHeights] = useState<readonly number[]>([])
  const setCardHeight = useCallback((index: number, height: number) => {
    setCardHeights((current) => {
      if (current[index] === height) return current
      const next = [...current]
      next[index] = height
      return next
    })
  }, [])
  if (!composerActive || mode === 'off' || annotations.length === 0 || layout.anchors.length === 0) return null
  const width = window.innerWidth
  const save = (annotation: ComposerAnnotation) => (comment: string) => { composer.value.setAnnotationComment({ sessionId, id: annotation.id, comment }) }
  const remove = (annotation: ComposerAnnotation) => () => { composer.value.removeAnnotation({ sessionId, id: annotation.id }) }
  const markerTops = layout.anchors.map(anchor => markerPlacement({ anchor, mode, column: layout.column, bound: layout.band, windowWidth: width }).top)
  const commentsLeft = mode === 'column' ? columnLeft({ column: layout.column, width: 248, windowWidth: width, gap: 24 }) : undefined
  const tops = commentsLeft === undefined ? [] : stackTops({
    tops: markerTops,
    heights: layout.anchors.map((anchor, index) => cardHeights[index] ?? (anchor.annotation.comment === '' ? 96 : 128)),
    gap: 8,
    bound: layout.band,
  })
  return createPortal(
    <div className={css.layer} data-annotation-marks={mode}>
      {layout.anchors.map((anchor, index) => {
        const placed = markerPlacement({ anchor, mode, column: layout.column, bound: layout.band, windowWidth: width })
        return (
          <Marker key={anchor.annotation.id} anchor={anchor} index={index} left={placed.left} top={placed.top}
            onSave={save(anchor.annotation)} onRemove={remove(anchor.annotation)} t={t} />
        )
      })}
      {commentsLeft === undefined ? null : (
        <div className={css.comments} style={{ left: commentsLeft }} aria-label={t('annotation.marks.column')}>
          {layout.anchors.map((anchor, index) => (
            <div key={anchor.annotation.id}
              className={css.commentCard} style={{ left: commentsLeft, top: tops[index] ?? layout.band.top }}
              data-annotation-card={anchor.annotation.id}>
              <CommentBody annotation={anchor.annotation} onSave={save(anchor.annotation)} onRemove={remove(anchor.annotation)} t={t} />
              <CardMeasure onMeasure={height => setCardHeight(index, height)} />
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
