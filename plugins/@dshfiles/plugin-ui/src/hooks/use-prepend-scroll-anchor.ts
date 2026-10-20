import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

type ScrollAnchor = {
  readonly height: number
  readonly pageCount: number
  readonly scope: string
  readonly top: number
}

export const usePrependScrollAnchor = (options: {
  readonly pageCount: number
  readonly root: RefObject<HTMLElement>
  readonly scope: string
}): (() => void) => {
  const anchor = useRef<ScrollAnchor | null>(null)
  const capture = useCallback(() => {
    anchor.current = null
    const root = options.root.current
    if (root === null) return
    anchor.current = { height: root.scrollHeight, pageCount: options.pageCount, scope: options.scope, top: root.scrollTop }
  }, [options.pageCount, options.root, options.scope])

  useLayoutEffect(() => {
    const previous = anchor.current
    if (previous === null) return
    if (previous.scope !== options.scope || options.pageCount < previous.pageCount) {
      anchor.current = null
      return
    }
    if (options.pageCount === previous.pageCount) return
    const root = options.root.current
    if (root === null) {
      anchor.current = null
      return
    }
    root.scrollTop = previous.top + (root.scrollHeight - previous.height)
    anchor.current = null
  }, [options.pageCount, options.root, options.scope])

  return capture
}
