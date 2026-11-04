// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ImageGallery, type ImageLabels } from '../src/MessageImage.js'
import { createImageLoadQueue } from '../src/image-load-queue.js'

const labels: ImageLabels = {
  image: 'Image',
  open: 'Open image',
  openNamed: name => `Open ${name}`,
  loading: 'Loading image',
  loadFailed: 'Image failed to load; click to retry',
  lightbox: {
    dialog: 'Image preview',
    close: 'Close image preview',
    previous: 'Previous image',
    next: 'Next image',
    thumbnail: (position, total) => `Image ${position} of ${total}`,
    loading: 'Loading image',
  },
}

type Source = MessageImagesProps['images'][number]
type Loader = MessageImagesProps['loadImage']

/** jsdom has no IntersectionObserver: record observed elements and let a test bring some into view. */
class FakeIntersectionObserver {
  static readonly instances = new Set<FakeIntersectionObserver>()
  readonly targets = new Set<Element>()
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.add(this)
  }
  observe(target: Element): void {
    this.targets.add(target)
  }
  unobserve(target: Element): void {
    this.targets.delete(target)
  }
  disconnect(): void {
    this.targets.clear()
    FakeIntersectionObserver.instances.delete(this)
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  static reveal(predicate: (element: Element) => boolean): void {
    for (const observer of [...FakeIntersectionObserver.instances]) {
      const hits = [...observer.targets].filter(predicate)
      if (hits.length === 0) continue
      observer.callback(
        hits.map(target => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry),
        observer as unknown as IntersectionObserver,
      )
    }
  }
}

function attachments(count: number): Source[] {
  return Array.from({ length: count }, (_, index) => ({
    attachment: { kind: 'image', attachmentId: `att-${index}`, name: `shot-${index}.png`, mediaType: 'image/png', width: 800, height: 600 },
  })) as unknown as Source[]
}

function loader(): { load: Loader; calls: string[]; resolveAll: () => void } {
  const calls: string[] = []
  const pending: Array<() => void> = []
  const load = vi.fn((attachment: { attachmentId: string }) => {
    calls.push(attachment.attachmentId)
    return new Promise<string>(resolve => {
      pending.push(() => {
        resolve(`blob:${attachment.attachmentId}`)
      })
    })
  }) as unknown as Loader
  return {
    load,
    calls,
    resolveAll: () => {
      for (const resolve of pending.splice(0)) resolve()
    },
  }
}

function galleryOf(count: number, load: Loader, queue = createImageLoadQueue(4)) {
  // One gallery per message, as a transcript page of 100 single-image messages renders them.
  return render(
    <div>
      {attachments(count).map((image, index) => (
        <ImageGallery key={index} images={[image]} load={load} align="end" labels={labels} queue={queue} />
      ))}
    </div>,
  )
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})
afterEach(() => {
  cleanup()
  FakeIntersectionObserver.instances.clear()
  vi.unstubAllGlobals()
})

describe('historical image bytes', () => {
  it('reads no bytes for 100 mounted images until they near the viewport', () => {
    const { load, calls } = loader()
    galleryOf(100, load)
    expect(calls).toHaveLength(0)

    act(() => {
      FakeIntersectionObserver.reveal(element => /shot-[0-2]\.png/.test(element.getAttribute('aria-label') ?? ''))
    })
    expect(calls).toEqual(['att-0', 'att-1', 'att-2'])
  })

  it('bounds simultaneous reads and starts the next one as a slot frees', async () => {
    const { load, calls, resolveAll } = loader()
    const queue = createImageLoadQueue(4)
    galleryOf(20, load, queue)

    act(() => {
      FakeIntersectionObserver.reveal(() => true)
    })
    expect(calls).toHaveLength(4)
    expect(queue.active()).toBe(4)
    expect(queue.queued()).toBe(16)

    await act(async () => {
      resolveAll()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(calls).toHaveLength(8)
  })

  it('drops queued reads of unmounted images', () => {
    const { load, calls } = loader()
    const queue = createImageLoadQueue(2)
    const view = galleryOf(10, load, queue)

    act(() => {
      FakeIntersectionObserver.reveal(() => true)
    })
    expect(queue.queued()).toBe(8)
    view.unmount()
    expect(queue.queued()).toBe(0)
    expect(calls).toHaveLength(2)
  })

  it('keeps the previous eager behaviour without IntersectionObserver', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('IntersectionObserver', undefined)
    const { load, calls } = loader()
    galleryOf(6, load, createImageLoadQueue(10))
    expect(calls).toHaveLength(6)
  })
})

describe('image load queue', () => {
  it('runs visible reads before queued prefetches', async () => {
    const queue = createImageLoadQueue(1)
    const order: string[] = []
    let release: () => void = () => undefined
    const blocker = queue.schedule(
      () =>
        new Promise<void>(resolve => {
          release = resolve
        }),
      'visible',
    )
    const prefetch = queue.schedule(async () => {
      order.push('prefetch')
    }, 'prefetch')
    const visible = queue.schedule(async () => {
      order.push('visible')
    }, 'visible')
    release()
    await Promise.all([blocker.promise, prefetch.promise, visible.promise])
    expect(order).toEqual(['visible', 'prefetch'])
  })
})
