import { useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import { IconCloseOutlineRegular, IconEditOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerBarProps } from '../contract/slots.ts'
import type { DraftAnnotation, DraftAnnotations } from '../input/draft-annotations.ts'
import css from './AnnotationsPill.module.css'

/** Chat answers this with a scroll to the quoted passage and a short highlight; the detail is `text` and `source` as URL search params. */
const REVEAL_EVENT = 'dshfiles:reveal-annotation'

const keepEditorFocus = (event: MouseEvent): void => {
  event.preventDefault()
}

const CommentGlyph = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 9h8M8 13h5" />
  </svg>
)

/**
 * The draft's annotations as one pill above the editor; hovering it lists them with their comments,
 * an edit and a delete action each, and clicking a quoted passage shows it in the conversation.
 */
export const AnnotationsPill = ({ annotations, t }: { readonly annotations: DraftAnnotations; readonly t: ComposerBarProps['t'] }) => {
  const list = useSyncExternalStore(annotations.subscribe, annotations.snapshot)
  const [editing, setEditing] = useState<{ readonly id: number; readonly comment: string } | null>(null)
  const [revealed, setRevealed] = useState(false)
  if (list.length === 0) return null

  const reveal = (annotation: DraftAnnotation): void => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setRevealed(true)
    window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: new URLSearchParams({ text: annotation.text, source: annotation.source }).toString() }))
  }

  const save = (): void => {
    if (editing === null) return
    annotations.setComment(editing)
    setEditing(null)
  }
  const onEditKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
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
    <div
      className={css.root}
      data-annotations-pill
      data-pinned={editing === null ? undefined : ''}
      data-revealed={revealed ? '' : undefined}
      onPointerLeave={() => setRevealed(false)}
    >
      <div className={css.popover}>
        <ol className={css.card}>
          {list.map((annotation, index) => (
            <li key={annotation.id} className={css.row}>
              <span className={css.index}>{index + 1}.</span>
              <div className={css.body}>
                <button
                  type="button"
                  className={css.reveal}
                  title={t('annotation.reveal')}
                  onMouseDown={keepEditorFocus}
                  onClick={() => reveal(annotation)}
                >
                  <span className={css.label}>{t('annotation.selected')}</span>
                  <span className={css.quote}>{annotation.text}</span>
                </button>
                {editing?.id === annotation.id ? (
                  <textarea
                    autoFocus
                    rows={2}
                    className={css.editor}
                    aria-label={t('annotation.edit')}
                    placeholder={t('annotation.placeholder')}
                    value={editing.comment}
                    onChange={event => setEditing({ id: annotation.id, comment: event.currentTarget.value })}
                    onKeyDown={onEditKey}
                    onBlur={save}
                  />
                ) : annotation.comment === '' ? null : (
                  <div className={css.comment}>
                    <span className={css.label}>{t('annotation.comment')}</span>
                    <span className={css.text}>{annotation.comment}</span>
                  </div>
                )}
              </div>
              <div className={css.actions}>
                <button
                  type="button"
                  className={css.action}
                  aria-label={t('annotation.edit')}
                  title={t('annotation.edit')}
                  onMouseDown={keepEditorFocus}
                  onClick={() => setEditing({ id: annotation.id, comment: annotation.comment })}
                >
                  <IconEditOutlineRegular size={16} />
                </button>
                <button
                  type="button"
                  className={css.action}
                  aria-label={t('annotation.remove')}
                  title={t('annotation.remove')}
                  onMouseDown={keepEditorFocus}
                  onClick={() => annotations.remove(annotation.id)}
                >
                  <IconTrashOutlineRegular size={16} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className={css.pill} tabIndex={0}>
        <CommentGlyph />
        <span>{list.length === 1 ? t('annotation.one') : t('annotation.many', { count: list.length })}</span>
        <button type="button" className={css.clear} aria-label={t('annotation.clear')} title={t('annotation.clear')} onMouseDown={keepEditorFocus} onClick={annotations.clear}>
          <IconCloseOutlineRegular size={10} />
        </button>
      </div>
    </div>
  )
}
