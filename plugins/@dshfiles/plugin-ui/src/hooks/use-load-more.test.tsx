// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useLoadMore } from './use-load-more.js'
import { afterEach, expect, test, vi } from 'vitest'

class RecordingObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = '0px'
  readonly scrollMargin = '0px'
  readonly thresholds: readonly number[] = [0]
  static readonly instances: RecordingObserver[] = []
  static disconnected = 0
  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    RecordingObserver.instances.push(this)
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    RecordingObserver.disconnected += 1
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  emit(isIntersecting: boolean): void {
    const rect = new DOMRect()
    this.callback(
      [
        {
          isIntersecting,
          boundingClientRect: rect,
          intersectionRatio: isIntersecting ? 1 : 0,
          intersectionRect: rect,
          rootBounds: null,
          target: document.body,
          time: 0,
        },
      ],
      this,
    )
  }
}

const installObserver = (): void => {
  RecordingObserver.instances.length = 0
  RecordingObserver.disconnected = 0
  Object.defineProperty(globalThis, 'IntersectionObserver', { value: RecordingObserver, configurable: true, writable: true })
}

const Probe = (props: { readonly enabled: boolean; readonly resetKey: number; readonly onLoadMore: () => void }): JSX.Element => {
  const sentinel = useLoadMore({ enabled: props.enabled, resetKey: props.resetKey, onLoadMore: props.onLoadMore })
  return <div ref={sentinel} />
}

const firstObserver = (): RecordingObserver => {
  const observer = RecordingObserver.instances[0]
  if (observer === undefined) throw new Error('the probe did not observe its sentinel')
  return observer
}

afterEach(() => {
  cleanup()
  Object.defineProperty(globalThis, 'IntersectionObserver', { value: undefined, configurable: true, writable: true })
})

test('loads only when the sentinel enters the viewport', () => {
  installObserver()
  const onLoadMore = vi.fn()
  render(<Probe enabled resetKey={1} onLoadMore={onLoadMore} />)

  act(() => firstObserver().emit(false))
  expect(onLoadMore).not.toHaveBeenCalled()
  act(() => firstObserver().emit(true))
  expect(onLoadMore).toHaveBeenCalledTimes(1)
})

test('reobserves after the loaded page count changes', () => {
  installObserver()
  const onLoadMore = vi.fn()
  const view = render(<Probe enabled resetKey={1} onLoadMore={onLoadMore} />)

  view.rerender(<Probe enabled resetKey={2} onLoadMore={onLoadMore} />)
  expect(RecordingObserver.instances).toHaveLength(2)
  expect(RecordingObserver.disconnected).toBe(1)

  const nextObserver = RecordingObserver.instances[1]
  if (nextObserver === undefined) throw new Error('the probe did not reobserve its sentinel')
  act(() => nextObserver.emit(true))
  expect(onLoadMore).toHaveBeenCalledTimes(1)
})

test('tracks the latest callback and disconnects when disabled', () => {
  installObserver()
  const firstLoad = vi.fn()
  const nextLoad = vi.fn()
  const view = render(<Probe enabled resetKey={1} onLoadMore={firstLoad} />)
  const observer = firstObserver()

  view.rerender(<Probe enabled resetKey={1} onLoadMore={nextLoad} />)
  act(() => observer.emit(true))
  expect(firstLoad).not.toHaveBeenCalled()
  expect(nextLoad).toHaveBeenCalledTimes(1)

  view.rerender(<Probe enabled={false} resetKey={1} onLoadMore={nextLoad} />)
  expect(RecordingObserver.disconnected).toBeGreaterThan(0)
})
