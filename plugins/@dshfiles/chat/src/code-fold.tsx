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
import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './code-fold.module.css'

/** Lines a settled block shows before it folds; about one screen of code at 18px. */
export const CODE_FOLD_LINES = 24

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

/** Wraps one native code card element; `block` is the element the native renderer produced. */
export function CodeFold({ block }: { readonly block: ReactElement<FoldableCodeBlockProps> }): ReactNode {
  const { code, streaming, toolbarLabels } = block.props
  const [wrapped, setWrapped] = useState(false)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const [actions, setActions] = useState<Element | null>(null)
  const lines = codeLineCount(code)
  const foldable = streaming !== true && lines > CODE_FOLD_LINES
  // The toolbar is the native card's; its action group is the last child of the banner.
  useLayoutEffect(() => {
    const banner = root.current?.querySelector('[data-code-block-banner]')
    setActions(banner?.lastElementChild ?? null)
  }, [])
  if (toolbarLabels === undefined) return block
  const label = wrapped ? toolbarLabels.unwrapLabel : toolbarLabels.wrapLabel
  return (
    <div ref={root} className={css.fold} data-code-fold={foldable ? (open ? 'open' : 'closed') : undefined}>
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
                setWrapped(value => !value)
              }}
            >
              <WrapTextIcon size={14} strokeWidth={1.5} aria-hidden />
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
