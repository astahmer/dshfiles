/**
 * Visual body of one inline reference chip: the DecoratorNode's React
 * face. Pure display — identity, invalidation, and lifecycle live on the
 * ReferenceChipNode; this component renders whatever the node carries.
 */
import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { ComposerSnippets, SNIPPET_SOURCE } from '../../../composer-snippets.ts'
import { ReferenceIconRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReferenceIconKind } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ReferenceChip.module.css'
import referenceCss from './composer-editor.module.css'

/** Display inputs of one chip (the node's cached owner projections). */
export interface ReferenceChipProps {
  readonly label: string
  /** Domain glyph; absent renders the trigger marker instead of an icon. */
  readonly appearance?: ReferenceIconKind | undefined
  /** Owner-resolution failure styling bit. */
  readonly invalid: boolean
  readonly source?: string
  readonly reference?: string
}

/**
 * Render one inline reference chip.
 * @param props - label, optional domain glyph, and the invalid bit.
 * @returns the chip body (icon + truncating label); a terminal excerpt chip instead shows the
 * captured output when its label is activated.
 */
export function ReferenceChip({ label, appearance, invalid, source, reference }: ReferenceChipProps): ReactNode {
  const [open, setOpen] = useState(false)
  const excerpt = source === SNIPPET_SOURCE && reference !== undefined ? ComposerSnippets.terminalExcerpt(reference) : undefined
  if (excerpt !== undefined) return (
    <span className={css.excerpt} contentEditable={false}>
      <button type="button" className={clsx(referenceCss.reference, referenceCss.openable, css.chip, css.excerptToggle)} aria-expanded={open}
        onClick={() => { setOpen(!open) }} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
        <span className={css.marker} aria-hidden>❯</span>
        <span className={css.label}>{label}</span>
      </button>
      {open && <span className={css.excerptContent}>{excerpt}</span>}
    </span>
  )
  return (
    <span className={clsx(referenceCss.reference, css.chip, appearance === 'file' && !invalid && referenceCss.openable, invalid && css.invalid)} title={label}>
      {appearance === undefined
        ? <span className={css.marker} aria-hidden>@</span>
        : <ReferenceIconRegular kind={appearance} size={14} className={css.icon} />}
      <span className={css.label}>{label}</span>
    </span>
  )
}
