// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { useRef } from 'react'
import { useNearViewport } from './use-near-viewport.js'

class RecordingObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin: string = '0px'
  readonly scrollMargin: string = '0px'
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

const Probe = (): JSX.Element => {
  const ref = useRef<HTMLDivElement | null>(null)
  const near = useNearViewport(ref)
  return <div ref={ref}>{near ? 'mounted' : 'waiting'}</div>
}

const firstObserver = (): RecordingObserver => {
  const observer = RecordingObserver.instances[0]
  if (observer === undefined) throw new Error('the probe did not observe its element')
  return observer
}

afterEach(() => {
  cleanup()
  Object.defineProperty(globalThis, 'IntersectionObserver', { value: undefined, configurable: true, writable: true })
})

test('mounts without an IntersectionObserver, as the previous behaviour did', () => {
  const view = render(<Probe />)
  expect(view.getByText('mounted')).toBeDefined()
})

test('waits for the viewport and then stays mounted', () => {
  installObserver()
  const view = render(<Probe />)
  expect(view.getByText('waiting')).toBeDefined()
  act(() => firstObserver().emit(false))
  expect(view.getByText('waiting')).toBeDefined()
  act(() => firstObserver().emit(true))
  expect(view.getByText('mounted')).toBeDefined()
  expect(RecordingObserver.disconnected).toBeGreaterThanOrEqual(1)
  act(() => firstObserver().emit(false))
  expect(view.getByText('mounted')).toBeDefined()
})
