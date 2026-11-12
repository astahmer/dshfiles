/**
 * Visual body of one inline reference chip: the DecoratorNode's React
 * face. Pure display — identity, invalidation, and lifecycle live on the
 * ReferenceChipNode; this component renders whatever the node carries.
 */
import clsx from 'clsx'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@dshfiles/plugin-ui/components/ui/sheet'
import { SquareTerminalIcon } from '@dshfiles/plugin-ui/icons'
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

/** The phone shell's width: there the captured output opens as a bottom sheet, not a popover. */
const PHONE_QUERY = '(max-width: 639.98px)'
const phoneWidth = {
  subscribe: (listener: () => void): (() => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
    const media = window.matchMedia(PHONE_QUERY)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  },
  snapshot: (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches,
}

const ExcerptText = ({ excerpt }: { readonly excerpt: string }): ReactNode => (
  <pre className="dshx:m-0 dshx:max-h-64 dshx:overflow-auto dshx:font-mono! dshx:text-xs dshx:break-words dshx:whitespace-pre-wrap dshx:select-text" data-terminal-excerpt="">
    {excerpt}
  </pre>
)

/**
 * dshfiles: a terminal excerpt chip shows the output the draft sends in the kit popover (s2, 12px radius, the floating
 * layer) on a pointer and a bottom sheet on a phone, instead of a raw absolutely placed box at the Host modal layer.
 * Escape and an outside click close it; focus stays in the editor while it opens.
 */
function TerminalExcerptChip({ label, excerpt }: { readonly label: string; readonly excerpt: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const phone = useSyncExternalStore(phoneWidth.subscribe, phoneWidth.snapshot, () => false)
  const face = (
    <>
      <SquareTerminalIcon aria-hidden className={css.icon} size={14} strokeWidth={1.75} />
      <span className={css.label}>{label}</span>
    </>
  )
  const className = clsx(referenceCss.reference, referenceCss.openable, css.chip, css.excerptToggle)
  if (phone)
    return (
      <span className={css.excerpt} contentEditable={false}>
        <button type="button" className={className} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen(!open) }}>
          {face}
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="dshx-root dshx:max-h-[70dvh] dshx:gap-3 dshx:rounded-t-2xl dshx:p-4 dshx:pb-[max(1rem,var(--dshx-safe-bottom))] dshx:shadow-s3">
            <SheetTitle className="dshx:text-sm">{label}</SheetTitle>
            <SheetDescription className="dshx:sr-only">The terminal output this draft sends.</SheetDescription>
            <ExcerptText excerpt={excerpt} />
          </SheetContent>
        </Sheet>
      </span>
    )
  return (
    <span className={css.excerpt} contentEditable={false}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={className}>
            {face}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          aria-label={label}
          className="dshx-root dshx:w-[32rem] dshx:max-w-[calc(100vw-1rem)] dshx:rounded-xl dshx:p-3 dshx:shadow-s2"
          onOpenAutoFocus={event => { event.preventDefault() }}
          onCloseAutoFocus={event => { event.preventDefault() }}
        >
          <ExcerptText excerpt={excerpt} />
        </PopoverContent>
      </Popover>
    </span>
  )
}

/**
 * Render one inline reference chip.
 * @param props - label, optional domain glyph, and the invalid bit.
 * @returns the chip body (icon + truncating label); a terminal excerpt chip instead shows the
 * captured output when its label is activated.
 */
export function ReferenceChip({ label, appearance, invalid, source, reference }: ReferenceChipProps): ReactNode {
  const excerpt = source === SNIPPET_SOURCE && reference !== undefined ? ComposerSnippets.terminalExcerpt(reference) : undefined
  if (excerpt !== undefined) return <TerminalExcerptChip label={label} excerpt={excerpt} />
  return (
    <span className={clsx(referenceCss.reference, css.chip, appearance === 'file' && !invalid && referenceCss.openable, invalid && css.invalid)} title={label}>
      {appearance === undefined
        ? <span className={css.marker} aria-hidden>@</span>
        : <ReferenceIconRegular kind={appearance} size={14} className={css.icon} />}
      <span className={css.label}>{label}</span>
    </span>
  )
}
