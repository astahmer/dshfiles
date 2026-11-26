/**
 * A native Markdown code card with Chat's reading controls (productivity pass T1.2): no-wrap with horizontal scroll by
 * default (a wrapped line used to restart at column 0 and break mid-word), a wrap toggle in the card's own header that
 * wraps with a hanging indent, and a fold after {@link CODE_FOLD_LINES} lines with "Show all · N lines".
 *
 * The native `CodeBlock` keeps drawing the card: Chat passes its `wrap` prop (which hands the wrap state to the owner
 * and drops the toolbar's own wrap button) and portals one button into the toolbar's action group, so the header,
 * copy action and sticky banner stay native.
 */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { WrapTextIcon } from '@dshfiles/plugin-ui/icons'
import { CodeIndent } from '@dshfiles/plugin-ui/lib/code-indent'
import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './code-fold.module.css'

/** Lines a settled block shows before it folds; about one screen of code at 18px. */
export const CODE_FOLD_LINES = 24

/** Council round 7 C4: a card narrower than this (a phone, a split pane) soft-wraps short code by default. */
export const CODE_NARROW_WIDTH = 448
/** The longest block that soft-wraps by default; a longer one keeps its rows and scrolls sideways with the edge fade. */
export const CODE_SOFT_WRAP_LINES = 12

/** Whether a block starts wrapped: short code on a narrow card reads without a sideways gesture. */
export const wrapsByDefault = (lines: number, width: number): boolean => width > 0 && width < CODE_NARROW_WIDTH && lines <= CODE_SOFT_WRAP_LINES

/** The native `CodeBlock` props this wrapper reads or sets. */
export interface FoldableCodeBlockProps {
  readonly code: string
  readonly streaming?: boolean | undefined
  readonly wrap?: boolean | undefined
  readonly toolbarLabels?: { readonly wrapLabel: string; readonly unwrapLabel: string } | undefined
}

/** Lines in a fence body as the card shows them (the native card trims one trailing newline). */
export const codeLineCount = (code: string): number => {
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  return trimmed === '' ? 0 : trimmed.split('\n').length
}

/** Which edges of an unwrapped card hide code: the side its lines run past. */
export type CodeOverflowEdges = 'start' | 'end' | 'both' | undefined

/** The edges a scroller hides content behind, from its scroll geometry (1px of slack for subpixel widths). */
export const overflowEdgesOf = (box: { readonly scrollWidth: number; readonly clientWidth: number; readonly scrollLeft: number }): CodeOverflowEdges => {
  const start = box.scrollLeft > 1
  const end = box.scrollLeft + box.clientWidth < box.scrollWidth - 1
  if (start && end) return 'both'
  if (start) return 'start'
  return end ? 'end' : undefined
}

/** Wraps one native code card element; `block` is the element the native renderer produced. */
export function CodeFold({ block }: { readonly block: ReactElement<FoldableCodeBlockProps> }): ReactNode {
  const { code, streaming, toolbarLabels } = block.props
  // The user's Wrap choice wins; until they make one, the card's width and length pick (council round 7 C4).
  const [choice, setChoice] = useState<boolean | undefined>(undefined)
  const [width, setWidth] = useState(0)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const [actions, setActions] = useState<Element | null>(null)
  // Round six C3: the edges whose code is out of view, and whether any line runs past the card (kept while wrapped, so
  // the toggle keeps its "Wrap" word and does not change width under the pointer).
  const [edges, setEdges] = useState<CodeOverflowEdges>(undefined)
  const [overflows, setOverflows] = useState(false)
  const lines = codeLineCount(code)
  const foldable = streaming !== true && lines > CODE_FOLD_LINES
  const softWraps = wrapsByDefault(lines, width)
  const hasToolbar = toolbarLabels !== undefined
  const wrapped = choice ?? softWraps
  useLayoutEffect(() => {
    const host = root.current
    if (host === null) return
    setWidth(host.getBoundingClientRect().width)
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [hasToolbar])
  // The toolbar is the native card's; its action group is the last child of the banner.
  useLayoutEffect(() => {
    const banner = root.current?.querySelector('[data-code-block-banner]')
    setActions(banner?.lastElementChild ?? null)
  }, [])
  useLayoutEffect(() => {
    const host = root.current
    if (host === null) return
    if (wrapped) {
      setEdges(undefined)
      // Council round 8 A6: a wrapped line hangs 2ch right of its own statement's indent. CSS cannot count a line's
      // leading spaces, so each highlighted line gets its indent in columns (`--dshx-line-indent`, read by
      // ui-styles' transcript.css), now and whenever the native card swaps its lines (highlighting lands, code streams).
      const mark = (): void => {
        const pre = host.querySelector<HTMLElement>('.md-code-block pre')
        if (pre !== null) CodeIndent.mark(pre)
      }
      const changes = new MutationObserver(mark)
      changes.observe(host, { childList: true, subtree: true })
      mark()
      return () => changes.disconnect()
    }
    // The native card swaps its plain `pre` for the highlighted one once highlighting lands, so the scroller is found
    // again whenever the card's subtree changes, and read again when it scrolls, resizes or its font arrives.
    let pre: HTMLElement | null = null
    const read = (): void => {
      if (pre === null) return
      const next = overflowEdgesOf(pre)
      setEdges(next)
      setOverflows(next !== undefined)
    }
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : undefined
    const attach = (): void => {
      const found = host.querySelector<HTMLElement>('.md-code-block pre')
      if (found !== pre) {
        pre?.removeEventListener('scroll', read)
        resize?.disconnect()
        pre = found
        pre?.addEventListener('scroll', read, { passive: true })
        if (pre !== null) resize?.observe(pre)
      }
      read()
    }
    let live = true
    const changes = new MutationObserver(attach)
    changes.observe(host, { childList: true, subtree: true })
    attach()
    if ('fonts' in document) void document.fonts.ready.then(() => live && read())
    return () => {
      live = false
      changes.disconnect()
      pre?.removeEventListener('scroll', read)
      resize?.disconnect()
    }
  }, [wrapped, code])
  if (toolbarLabels === undefined) return block
  const label = wrapped ? toolbarLabels.unwrapLabel : toolbarLabels.wrapLabel
  return (
    <div
      ref={root}
      className={css.fold}
      data-code-fold={foldable ? (open ? 'open' : 'closed') : undefined}
      data-code-overflow-edges={edges}
      data-code-narrow={wrapped && width > 0 && width < CODE_NARROW_WIDTH ? '' : undefined}
    >
      {cloneElement(block, { wrap: wrapped })}
      {actions !== null &&
        createPortal(
          <Tooltip label={label} side="top" portal>
            <button
              type="button"
              className={css.wrap}
              aria-label={toolbarLabels.wrapLabel}
              aria-pressed={wrapped}
              onClick={() => {
                setChoice(!wrapped)
              }}
            >
              <WrapTextIcon size={14} strokeWidth={1.5} aria-hidden />
              {/* A soft-wrapped block keeps the word too, so the toggle never changes width under the finger. */}
              {overflows || softWraps ? (
                <span className={css.wrapLabel} aria-hidden>
                  Wrap
                </span>
              ) : null}
            </button>
          </Tooltip>,
          actions,
        )}
      {foldable && (
        <button
          type="button"
          className={css.toggle}
          aria-expanded={open}
          onClick={() => {
            setOpen(value => !value)
          }}
        >
          {open ? 'Show less' : `Show all · ${String(lines)} lines`}
        </button>
      )}
    </div>
  )
}
