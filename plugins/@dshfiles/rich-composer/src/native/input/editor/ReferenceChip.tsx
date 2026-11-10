/**
 * Visual body of one inline reference chip: the DecoratorNode's React
 * face. Pure display — identity, invalidation, and lifecycle live on the
 * ReferenceChipNode; this component renders whatever the node carries.
 */
import clsx from 'clsx'
import { useContext, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { NodeKey } from 'lexical'
import { ReferenceIconRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReferenceIconKind } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChipActionsContext } from './chip-actions-context.ts'
import css from './ReferenceChip.module.css'
import referenceCss from './composer-editor.module.css'

/** Display inputs of one chip (the node's cached owner projections). */
export interface ReferenceChipProps {
  readonly label: string
  /** Domain glyph; absent renders the trigger marker instead of an icon. */
  readonly appearance?: ReferenceIconKind | undefined
  /** Owner-resolution failure styling bit. */
  readonly invalid: boolean
  /** Addresses this chip in the composer editor; absent outside one. */
  readonly nodeKey?: NodeKey | undefined
  /** Set on a quote chip: its comment (if any), which turns on the hover actions that edit it. */
  readonly annotation?: { readonly comment: string | undefined } | undefined
}

const Glyph = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

/**
 * Render one inline reference chip; a quote chip also gets hover actions to comment on or remove it.
 * @param props - label, optional domain glyph, the invalid bit, and the editor address and annotation of a quote chip.
 * @returns the chip body, wrapped with its actions when it is an annotation.
 */
export function ReferenceChip({ label, appearance, invalid, nodeKey, annotation }: ReferenceChipProps): ReactNode {
  const actions = useContext(ChipActionsContext)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const settled = useRef(false)
  const body = (
    <span
      className={clsx(
        referenceCss.reference,
        css.chip,
        (annotation !== undefined || (appearance === 'file' && !invalid)) && referenceCss.openable,
        invalid && css.invalid,
      )}
      title={label}
    >
      {appearance === undefined
        ? <span className={css.marker} aria-hidden>@</span>
        : <ReferenceIconRegular kind={appearance} size={14} className={css.icon} />}
      <span className={css.label}>{label}</span>
      {annotation?.comment === undefined ? null : <span className={css.comment}>{annotation.comment}</span>}
    </span>
  )
  if (annotation === undefined || actions === null || nodeKey === undefined) return body
  const open = (): void => {
    settled.current = false
    setDraft(annotation.comment ?? '')
    setEditing(true)
  }
  const save = (): void => {
    if (settled.current) return
    settled.current = true
    setEditing(false)
    actions.setComment({ key: nodeKey, comment: draft })
  }
  const discard = (): void => {
    settled.current = true
    setEditing(false)
  }
  const onEditKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
    }
    if (event.key === 'Escape') discard()
  }
  return (
    <span className={css.annotated}>
      {body}
      <span className={css.actions}>
        <button type="button" data-chip-action className={css.action} aria-label="Comment on this quote" onMouseDown={event => event.preventDefault()} onClick={open}>
          <Glyph><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Glyph>
        </button>
        <button type="button" data-chip-action className={css.action} aria-label="Remove this quote" onMouseDown={event => event.preventDefault()} onClick={() => actions.remove(nodeKey)}>
          <Glyph><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></Glyph>
        </button>
      </span>
      {editing
        ? (
          <input
            data-chip-action
            autoFocus
            className={css.editor}
            aria-label="Comment on this quote"
            placeholder="Add a comment"
            value={draft}
            onChange={event => setDraft(event.currentTarget.value)}
            onKeyDown={onEditKey}
            onBlur={save}
          />
        )
        : null}
    </span>
  )
}
