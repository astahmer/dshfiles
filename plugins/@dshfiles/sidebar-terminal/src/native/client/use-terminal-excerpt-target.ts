/** Keeps one mounted terminal screen reachable by the excerpt shortcut for as long as it is mounted. */
import { useEffect, type RefObject } from 'react'
import type { TerminalExcerpt } from './excerpt.ts'
import type { TerminalExcerptTarget } from './excerpt-targets.ts'

/**
 * Register the screen's current selection with the excerpt registry.
 * @param input - the entry-owned registry, the screen element and the latest selection commands.
 */
export const useTerminalExcerptTarget = (input: {
  readonly register: (target: TerminalExcerptTarget) => () => void
  readonly screen: RefObject<HTMLElement | null>
  readonly selection: RefObject<TerminalExcerpt | undefined>
  readonly attach: RefObject<(excerpt: TerminalExcerpt) => void>
}): void => {
  const { register, screen, selection, attach } = input
  useEffect(() => register({
    contains: node => screen.current?.contains(node) ?? false,
    selected: () => selection.current !== null && selection.current !== undefined,
    attach: () => {
      const current = selection.current
      if (current === null || current === undefined) return
      attach.current?.(current)
    },
  }), [register, screen, selection, attach])
}
