import { useEffect, useRef, type RefObject } from 'react'

type LoadMoreOptions = {
  readonly enabled: boolean
  readonly resetKey: number
  readonly onLoadMore: () => void
  readonly root?: RefObject<Element>
  readonly rootMargin?: string
}

export const useLoadMore = (options: LoadMoreOptions): RefObject<HTMLDivElement> => {
  const sentinel = useRef<HTMLDivElement>(null)
  const onLoadMore = useRef(options.onLoadMore)

  useEffect(() => {
    onLoadMore.current = options.onLoadMore
  }, [options.onLoadMore])

  useEffect(() => {
    const target = sentinel.current
    const IntersectionObserverApi = globalThis.IntersectionObserver
    if (!options.enabled || target === null || IntersectionObserverApi === undefined) return
    const observer = new IntersectionObserverApi(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) onLoadMore.current()
      },
      { root: options.root?.current ?? null, rootMargin: options.rootMargin ?? '600px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [options.enabled, options.resetKey, options.root, options.rootMargin])

  return sentinel
}
