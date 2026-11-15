import type { Matrix } from './matrix.js'
import type { Rect } from './model.js'

interface Size {
  readonly width: number
  readonly height: number
}

/**
 * Where the scene picture lies, in the canvas's device pixels: covering the viewport, centred, as `background-size:
 * cover` with `background-attachment: fixed` placed it, so it lines up with the scene's stills in the reading veil.
 */
function viewOf(viewBox: Rect, viewport: Size, host: { readonly left: number; readonly top: number }, dpr: number): Matrix {
  const cover = Math.max(viewport.width / viewBox[2], viewport.height / viewBox[3])
  const x = (viewport.width - viewBox[2] * cover) / 2 - host.left - viewBox[0] * cover
  const y = (viewport.height - viewBox[3] * cover) / 2 - host.top - viewBox[1] * cover
  return [dpr * cover, 0, 0, dpr * cover, dpr * x, dpr * y]
}

/** Device pixels per scene unit the pictures need for this viewport. */
function scaleOf(viewBox: Rect, viewport: Size, dpr: number): number {
  return Math.max(viewport.width / viewBox[2], viewport.height / viewBox[3]) * dpr
}

/** Whether the backdrop moves in this tab: a frame rate above 0, motion allowed, and the tab shown and focused. */
function isMoving(frameRate: number, visible: boolean, focused: boolean, reduced: boolean): boolean {
  return frameRate > 0 && visible && focused && !reduced
}

/** Placement of the scene and when it moves. */
export class SceneView {
  static readonly view = viewOf
  static readonly scale = scaleOf
  static readonly moving = isMoving
}
