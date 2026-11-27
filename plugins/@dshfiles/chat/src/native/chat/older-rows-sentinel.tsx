import { useEffect, useRef } from 'react'

/**
 * Mounts the next older rows, or asks the Host for the next older page, once the reader nears the top. It unmounts
 * while a page loads, so a page that still leaves it in view observes it again and takes the next one.
 */
export function OlderRowsSentinel({ listRef, hidden, firstSeq, onVisible, fillSteps }: {
  listRef: { readonly current: HTMLDivElement | null }
  hidden: number
  /** First Session sequence the mounted rows show: a Host page moves it while `hidden` stays 0. */
  firstSeq: number | null
  onVisible: () => void
  /** Steps left that may widen a view the rows do not fill yet, without the reader scrolling. */
  fillSteps: { current: number }
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Observed again after every step: a step that still leaves the sentinel in view must take the next one.
  useEffect(() => {
    const target = ref.current
    // A shared conversation scrollport (the phone layout) scrolls instead of the list, as in ChatViewport.attach: the
    // list then never scrolls and always measures as an unfilled tail, so it can neither see the reader move up nor
    // stop the opening fill steps.
    const list = listRef.current?.closest<HTMLElement>('[data-conversation-scroll]') ?? listRef.current
    if (target === null || list === null || typeof IntersectionObserver !== 'function') return
    let near = false
    let fired = false
    let upward = false
    // First read in an observer callback, where layout is current; reading at mount would force the new rows' layout.
    let lastTop: number | null = null
    // A thread opens at its newest row, and collapsed Turns are a few pixels tall, so the top is often within reach
    // there; widening only once the reader leaves the tail, or a few steps while the rows do not fill the view, keeps
    // an open from paging in the whole history.
    const take = (): void => {
      if (fired || !near) return
      const fillsView = list.scrollHeight > list.clientHeight + 1
      const atTail = list.scrollHeight - list.scrollTop - list.clientHeight < 48
      if (atTail && !upward && (fillsView || fillSteps.current <= 0)) return
      if (atTail && !upward) fillSteps.current -= 1
      fired = true
      onVisible()
    }
    const observer = new IntersectionObserver((records) => {
      near = records.some(record => record.isIntersecting)
      lastTop ??= list.scrollTop
      take()
    }, { root: list, rootMargin: '1200px 0px 0px 0px' })
    // Reading upward also counts when the rows cannot scroll yet: a wheel or key toward older rows.
    const onScroll = (): void => {
      const top = list.scrollTop
      // Rows or a composer shrinking under a reader at the floor clamp it to the new floor: a lower offset that still
      // sits at the floor is that clamp, not the reader moving toward older rows.
      const atFloor = list.scrollHeight - top - list.clientHeight <= 1
      if (lastTop !== null && top < lastTop && !atFloor) upward = true
      lastTop = top
      take()
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY >= 0) return
      upward = true
      take()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'PageUp' && event.key !== 'ArrowUp' && event.key !== 'Home') return
      upward = true
      take()
    }
    // A phone has no wheel: a finger dragging down over rows that cannot scroll is the same request for older rows.
    let touchY: number | undefined
    const onTouchStart = (event: TouchEvent): void => {
      touchY = event.touches[0]?.clientY
    }
    const onTouchMove = (event: TouchEvent): void => {
      const y = event.touches[0]?.clientY
      if (touchY === undefined || y === undefined || y <= touchY) return
      upward = true
      take()
    }
    observer.observe(target)
    list.addEventListener('scroll', onScroll, { passive: true })
    list.addEventListener('wheel', onWheel, { passive: true })
    list.addEventListener('keydown', onKey)
    list.addEventListener('touchstart', onTouchStart, { passive: true })
    list.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      observer.disconnect()
      list.removeEventListener('scroll', onScroll)
      list.removeEventListener('wheel', onWheel)
      list.removeEventListener('keydown', onKey)
      list.removeEventListener('touchstart', onTouchStart)
      list.removeEventListener('touchmove', onTouchMove)
    }
  }, [listRef, hidden, firstSeq, onVisible])
  return <div ref={ref} aria-hidden="true" data-chat-older-rows="" />
}
