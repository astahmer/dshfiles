/// <reference lib="webworker" />
import type { WorkerMessage } from './model.js'
import { SceneRenderer } from './render.js'

/**
 * The scene worker: owns the backdrop canvas (transferred from the page) and draws the compiled scene on it at the
 * display's frame rate, capped by `sceneFrameRate`. The page only tells it what to draw, the view, and whether to run,
 * so a busy page never makes the scene stutter and the scene never takes the page's main thread.
 */
declare const self: DedicatedWorkerGlobalScope

let renderer: SceneRenderer | undefined
let canvas: OffscreenCanvas | undefined
let running = false
let interval = 1000 / 60
let last = Number.NEGATIVE_INFINITY
let handle: number | undefined
/** Scene time: it only advances while running, so a paused scene resumes where it stopped. */
let clock = 0
let since: number | undefined

const schedule = (): void => {
  if (handle !== undefined || !running || renderer === undefined) return
  handle = typeof self.requestAnimationFrame === 'function' ? self.requestAnimationFrame(frame) : self.setTimeout(() => frame(performance.now()), interval)
}

const cancel = (): void => {
  if (handle === undefined) return
  if (typeof self.cancelAnimationFrame === 'function') self.cancelAnimationFrame(handle)
  else self.clearTimeout(handle)
  handle = undefined
}

function frame(now: number): void {
  handle = undefined
  if (!running || renderer === undefined) return
  if (since !== undefined) clock += now - since
  since = now
  // Half a frame of slack, so a 60 fps cap on a 120 Hz display takes every other frame instead of beating.
  if (now - last >= interval - 4) {
    last = now
    renderer.draw(clock)
  }
  if (!renderer.still) schedule()
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data
  switch (message.type) {
    case 'canvas': {
      canvas = message.canvas
      const context = canvas.getContext('2d', { alpha: true })
      if (context === null) return
      renderer = new SceneRenderer(context, (width, height) => new OffscreenCanvas(width, height))
      return
    }
    case 'scene':
      renderer?.setScene(message.model, message.bitmaps)
      renderer?.draw(clock)
      schedule()
      return
    case 'view':
      if (canvas !== undefined && (canvas.width !== message.width || canvas.height !== message.height)) {
        canvas.width = message.width
        canvas.height = message.height
      }
      renderer?.setView(message.width, message.height, message.matrix)
      renderer?.draw(clock)
      return
    case 'run':
      running = message.running
      interval = 1000 / Math.max(1, message.frameRate)
      since = undefined
      if (running) schedule()
      else cancel()
      return
  }
}
