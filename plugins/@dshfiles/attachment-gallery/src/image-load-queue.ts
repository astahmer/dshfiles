/**
 * A small bounded queue for historical image reads: a transcript page with many
 * attachments must not start one Session read (and one base64 decode) per image
 * at once. Visible images run before lightbox prefetches; a queued read whose
 * image unmounted is dropped before it starts. A read that already started
 * cannot be aborted through the public loader, so it runs to completion and its
 * URL stays owned by the Session-scoped cache.
 */

export type ImageLoadPriority = 'visible' | 'prefetch'

export interface ScheduledImageLoad<T> {
  readonly promise: Promise<T>
  /** Drop the read if it has not started; a started read is left to finish. */
  readonly cancel: () => void
}

export interface ImageLoadQueue {
  schedule<T>(task: () => Promise<T>, priority: ImageLoadPriority): ScheduledImageLoad<T>
  /** Reads currently running (for tests and diagnostics). */
  readonly active: () => number
  /** Reads waiting for a slot. */
  readonly queued: () => number
}

interface Pending {
  readonly run: () => void
  readonly priority: ImageLoadPriority
}

export class ImageLoadCancelled extends Error {
  constructor() {
    super('image load cancelled before it started')
    this.name = 'ImageLoadCancelled'
  }
}

/** Create a queue that runs at most `limit` reads at a time, visible reads first. */
export function createImageLoadQueue(limit = 4): ImageLoadQueue {
  let running = 0
  const waiting: Pending[] = []

  const pump = (): void => {
    while (running < limit) {
      const index = waiting.findIndex(entry => entry.priority === 'visible')
      const next = index >= 0 ? waiting.splice(index, 1)[0] : waiting.shift()
      if (next === undefined) return
      next.run()
    }
  }

  return {
    schedule<T>(task: () => Promise<T>, priority: ImageLoadPriority): ScheduledImageLoad<T> {
      let entry: Pending | undefined
      let rejectQueued: ((error: unknown) => void) | undefined
      const promise = new Promise<T>((resolve, reject) => {
        rejectQueued = reject
        entry = {
          priority,
          run: () => {
            entry = undefined
            running += 1
            let started: Promise<T>
            try {
              started = task()
            } catch (error) {
              started = Promise.reject(error)
            }
            started.then(resolve, reject).finally(() => {
              running -= 1
              pump()
            })
          },
        }
        waiting.push(entry)
      })
      pump()
      return {
        promise,
        cancel: () => {
          if (entry === undefined) return
          const index = waiting.indexOf(entry)
          if (index >= 0) waiting.splice(index, 1)
          entry = undefined
          rejectQueued?.(new ImageLoadCancelled())
        },
      }
    },
    active: () => running,
    queued: () => waiting.length,
  }
}

/** The one queue shared by every transcript image of this client. */
export const historicalImageQueue = createImageLoadQueue(4)
