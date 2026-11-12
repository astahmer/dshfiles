import { useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@dshfiles/plugin-ui/components/ui/sheet'
import { MessageSquareTextIcon, PencilIcon, Trash2Icon, XIcon } from '@dshfiles/plugin-ui/icons'
import type { ComposerBarProps } from '../contract/slots.ts'
import type { DraftAnnotation, DraftAnnotations } from '../input/draft-annotations.ts'

/** Chat answers this with a scroll to the quoted passage and a short highlight; the detail is `text` and `source` as URL search params. */
const REVEAL_EVENT = 'dshfiles:reveal-annotation'

/** The phone shell's width (thread-sidebar's stack navigation): there the list is a bottom sheet, not a popover. */
const PHONE_QUERY = '(max-width: 639.98px)'
const phoneWidth = {
  subscribe: (listener: () => void): (() => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
    const media = window.matchMedia(PHONE_QUERY)
    media.addEventListener('change', listener)
    return () => { media.removeEventListener('change', listener) }
  },
  snapshot: (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches,
}

const keepEditorFocus = (event: MouseEvent): void => {
  event.preventDefault()
}

type Translate = ComposerBarProps['t']

const AnnotationList = (props: {
  readonly list: readonly DraftAnnotation[]
  readonly annotations: DraftAnnotations
  readonly onReveal: (annotation: DraftAnnotation) => void
  readonly t: Translate
}): ReactNode => {
  const { list, annotations, t } = props
  const [editing, setEditing] = useState<{ readonly id: number; readonly comment: string } | null>(null)
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
    <ol className="dshx:m-0 dshx:flex dshx:max-h-80 dshx:list-none dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:p-0" data-annotations-list="">
      {list.map((annotation, index) => (
        <li key={annotation.id} className="dshx:flex dshx:items-start dshx:gap-2 dshx:rounded-md dshx:p-2 dshx:hover:bg-muted">
          <span className="dshx:min-w-3.5 dshx:flex-none dshx:text-sm dshx:leading-5 dshx:text-muted-foreground dshx:tabular-nums">{index + 1}.</span>
          <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-2">
            <button
              type="button"
              className="dshx:group dshx:flex dshx:min-w-0 dshx:cursor-pointer dshx:flex-col dshx:gap-0.5 dshx:rounded-sm dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:text-left dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring"
              aria-label={`${t('annotation.reveal')}: ${annotation.text}`}
              onMouseDown={keepEditorFocus}
              onClick={() => props.onReveal(annotation)}
            >
              <span className="dshx:text-xs dshx:text-muted-foreground">{t('annotation.selected')}</span>
              <span className="dshx:line-clamp-3 dshx:text-sm dshx:whitespace-pre-wrap dshx:wrap-anywhere dshx:text-foreground dshx:group-hover:underline dshx:group-hover:decoration-muted-foreground dshx:group-hover:underline-offset-3">
                {annotation.text}
              </span>
            </button>
            {editing?.id === annotation.id ? (
              <textarea
                autoFocus
                rows={2}
                className="dshx:box-border dshx:min-h-13 dshx:w-full dshx:resize-y dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
                aria-label={t('annotation.edit')}
                placeholder={t('annotation.placeholder')}
                value={editing.comment}
                onChange={event => setEditing({ id: annotation.id, comment: event.currentTarget.value })}
                onKeyDown={onEditKey}
                onBlur={save}
              />
            ) : annotation.comment === '' ? null : (
              <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                <span className="dshx:text-xs dshx:text-muted-foreground">{t('annotation.comment')}</span>
                <span className="dshx:text-sm dshx:whitespace-pre-wrap dshx:wrap-anywhere dshx:text-foreground">{annotation.comment}</span>
              </div>
            )}
          </div>
          <div className="dshx:flex dshx:flex-none dshx:gap-0.5">
            <button
              type="button"
              className="dshx:inline-flex dshx:size-7 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring dshx:pointer-coarse:size-11"
              aria-label={t('annotation.edit')}
              onMouseDown={keepEditorFocus}
              onClick={() => setEditing({ id: annotation.id, comment: annotation.comment })}
            >
              <PencilIcon aria-hidden className="dshx:size-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="dshx:inline-flex dshx:size-7 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring dshx:pointer-coarse:size-11"
              aria-label={t('annotation.remove')}
              onMouseDown={keepEditorFocus}
              onClick={() => annotations.remove(annotation.id)}
            >
              <Trash2Icon aria-hidden className="dshx:size-4" strokeWidth={1.5} />
            </button>
          </div>
        </li>
      ))}
    </ol>
  )
}

/**
 * The draft's annotations as one chip in the attachments row (upstream's floating pill, on the kit since b:ysaj).
 * A click or tap opens the list — a popover on a pointer, a bottom sheet on a phone — with each annotation's comment,
 * an edit and a delete action; tapping a quoted passage shows it in the thread. The chip's × removes them all.
 */
export const AnnotationsPill = ({ annotations, t }: { readonly annotations: DraftAnnotations; readonly t: Translate }) => {
  const list = useSyncExternalStore(annotations.subscribe, annotations.snapshot)
  const phone = useSyncExternalStore(phoneWidth.subscribe, phoneWidth.snapshot, () => false)
  const [open, setOpen] = useState(false)
  if (list.length === 0) return null

  const reveal = (annotation: DraftAnnotation): void => {
    setOpen(false)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: new URLSearchParams({ text: annotation.text, source: annotation.source }).toString() }))
  }
  const label = list.length === 1 ? t('annotation.one') : t('annotation.many', { count: list.length })
  const body = <AnnotationList list={list} annotations={annotations} onReveal={reveal} t={t} />
  const chip = (
    <button
      type="button"
      className="dshx:inline-flex dshx:h-7 dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-l-full dshx:border-0 dshx:bg-transparent dshx:py-0 dshx:pr-1 dshx:pl-2.5 dshx:text-xs dshx:text-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:pointer-coarse:h-11"
      aria-haspopup="dialog"
      aria-expanded={open}
      onMouseDown={keepEditorFocus}
      onClick={() => setOpen(current => !current)}
    >
      <MessageSquareTextIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
      <span className="dshx:truncate">{label}</span>
    </button>
  )

  return (
    <div className="dshx-root dshx:flex dshx:px-3 dshx:pt-2" data-annotations-pill="">
      <span className="dshx:inline-flex dshx:max-w-full dshx:min-w-0 dshx:items-center dshx:rounded-full dshx:border dshx:border-border dshx:bg-muted">
        {phone ? (
          <>
            {chip}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetContent side="bottom" className="dshx-root dshx:gap-3 dshx:p-4 dshx:pb-[max(1rem,var(--dshx-safe-bottom))]">
                <SheetTitle className="dshx:text-sm">{label}</SheetTitle>
                <SheetDescription className="dshx:sr-only">{t('annotation.reveal')}</SheetDescription>
                {body}
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{chip}</PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              className="dshx-root dshx:w-[min(35rem,calc(100vw-2rem))] dshx:p-2"
              onOpenAutoFocus={event => event.preventDefault()}
            >
              {body}
            </PopoverContent>
          </Popover>
        )}
        <button
          type="button"
          className="dshx:mr-1 dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring dshx:pointer-coarse:size-11"
          aria-label={t('annotation.clear')}
          onMouseDown={keepEditorFocus}
          onClick={annotations.clear}
        >
          <XIcon aria-hidden className="dshx:size-3" />
        </button>
      </span>
    </div>
  )
}
