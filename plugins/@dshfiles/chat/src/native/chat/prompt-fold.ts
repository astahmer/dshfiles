/**
 * dshfiles (productivity pass T1.4): long user prompts fold, and a pasted fence reads as code.
 *
 * - {@link splitPromptFences} cuts a prompt into prose runs and fenced code, so a bubble shows a pasted ```` ``` ````
 *   block as a small code card instead of the raw markers. An unclosed fence runs to the end of the prompt.
 * - {@link usePromptFold} measures a bubble body against `--dsh-prompt-fold-lines` (8, 6 on a phone) of its own line
 *   height. A folded body stays in the DOM with `overflow: hidden`, so browser find still matches its text; when find
 *   scrolls the clipped body to show a match, the fold opens.
 */
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export type PromptSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly lang: string; readonly code: string }

const FENCE = /(^|\n)```([^\n`]*)\n([\s\S]*?)(?:\n```[ \t]*(?=\n|$)|$)/g

/** Prose and fenced code in prompt order; a prompt without a fence is one text segment. */
export const splitPromptFences = (text: string): readonly PromptSegment[] => {
  if (!text.includes('```')) return [{ kind: 'text', text }]
  const segments: PromptSegment[] = []
  let offset = 0
  for (const match of text.matchAll(FENCE)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0)
    if (start > offset) segments.push({ kind: 'text', text: text.slice(offset, start).replace(/\n$/, '') })
    segments.push({ kind: 'code', lang: (match[2] ?? '').trim().split(/\s+/)[0] ?? '', code: match[3] ?? '' })
    offset = (match.index ?? 0) + match[0].length
  }
  const rest = text.slice(offset).replace(/^\n/, '')
  if (rest !== '') segments.push({ kind: 'text', text: rest })
  return segments.filter(segment => segment.kind === 'code' || segment.text !== '')
}

export interface PromptFold {
  readonly ref: RefObject<HTMLDivElement>
  /** The body is taller than the fold: null until measured or when it fits. */
  readonly lines: number | null
  readonly open: boolean
  readonly toggle: () => void
}

/**
 * Fold state for one bubble body.
 * @param text - the prompt text; a change re-measures.
 * @param enabled - false for a one-line (ellipsis) rendering, which never folds.
 */
export const usePromptFold = (text: string, enabled = true): PromptFold => {
  const ref = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null || !enabled) {
      setLines(null)
      return
    }
    const measure = (): void => {
      const style = getComputedStyle(element)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const limit = Number.parseFloat(style.getPropertyValue('--dsh-prompt-fold-lines')) || 8
      if (!(lineHeight > 0)) return
      const total = Math.round(element.scrollHeight / lineHeight)
      // Two lines of slack: folding a 9-line prompt to 8 saves nothing.
      setLines(total > limit + 2 ? total : null)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [text, enabled])
  // Browser find scrolls a clipped body to reveal a match; that is the reader asking for the folded text.
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null || open || lines === null) return
    const reveal = (): void => {
      if (element.scrollTop > 0) {
        element.scrollTop = 0
        setOpen(true)
      }
    }
    element.addEventListener('scroll', reveal)
    return () => {
      element.removeEventListener('scroll', reveal)
    }
  }, [open, lines])
  const toggle = useCallback(() => {
    setOpen(value => !value)
  }, [])
  return { ref, lines, open, toggle }
}
