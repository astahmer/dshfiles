import * as React from 'react'
import { cn } from '../lib/utils.js'
import { WORK_COUNT_SEPARATOR, type WorkCountPart } from '../lib/work-count.js'
import { StatusGlyph } from './work-status.js'

/** One clause of the count formula as a surface draws it: its text and its tone. */
export type WorkCountClause = Pick<WorkCountPart, 'text' | 'tone'>

export interface WorkCountTextProps extends Omit<React.ComponentPropsWithoutRef<'span'>, 'children'> {
  /** The formula's clauses (`workCountParts(…)`), in order; nothing is drawn when empty. */
  readonly parts: readonly WorkCountClause[]
  /** Start with the separator, for a count that continues a line (`billing-api · 6 working`). */
  readonly leadingSeparator?: boolean
}

const toneClass = {
  plain: undefined,
  'needs-you': 'dshx:text-info',
  failed: 'dshx:text-destructive',
} as const satisfies Record<WorkCountClause['tone'], string | undefined>

/**
 * The count formula drawn one way on every surface (council round 23, item 2): `6 working · ✕ 1 failed`. The failed
 * clause leads with the list's ✕ and reads in the failed ink, so the header chip, the sidebar parent row, the transcript
 * group header and the phone header mark a failure alike. Only the first failed clause takes the ✕; a following
 * "1 didn't start" keeps the ink without a second cross. Needs you reads in its indigo; every other clause inherits the
 * surrounding ink. Separators keep their spaces even where a line wraps or a count continues a line.
 */
export const WorkCountText = React.forwardRef<HTMLSpanElement, WorkCountTextProps>(function WorkCountText(
  { parts, leadingSeparator = false, className, ...props },
  ref,
) {
  if (parts.length === 0) return null
  const firstFailed = parts.findIndex(part => part.tone === 'failed')
  return (
    <span ref={ref} data-slot="work-count" className={cn('dshx:tabular-nums', className)} {...props}>
      {parts.map((part, index) => (
        <React.Fragment key={`${String(index)}:${part.text}`}>
          {index > 0 || leadingSeparator ? <span className="dshx:whitespace-pre">{WORK_COUNT_SEPARATOR}</span> : null}
          <span data-work-count-tone={part.tone} className={toneClass[part.tone]}>
            {/* Inline, not a flex box: a row that truncates its end can still cut the clause's text. */}
            {index === firstFailed ? <StatusGlyph status="failed" decorative className="dshx:mr-1 dshx:size-3 dshx:align-middle" /> : null}
            {part.text}
          </span>
        </React.Fragment>
      ))}
    </span>
  )
})
