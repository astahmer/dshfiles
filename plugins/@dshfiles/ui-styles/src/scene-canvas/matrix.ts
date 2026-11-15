/** A 2D affine matrix as `[a, b, c, d, e, f]`, the order of `DOMMatrix` and `CanvasRenderingContext2D.setTransform`. */
export type Matrix = readonly [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** `left · right`: apply `right` first, then `left`. */
function multiply(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left
  const [a2, b2, c2, d2, e2, f2] = right
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1]
}

function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (det === 0 || !Number.isFinite(det)) return IDENTITY
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
const scale = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0]
const rotate = (degrees: number): Matrix => {
  const r = (degrees * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [cos, sin, -sin, cos, 0, 0]
}

function apply(m: Matrix, x: number, y: number): readonly [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** The axis-aligned box of a rectangle `[x, y, width, height]` after a matrix. */
function mapRect(m: Matrix, rect: readonly [number, number, number, number]): [number, number, number, number] {
  const [x, y, w, h] = rect
  const corners = [apply(m, x, y), apply(m, x + w, y), apply(m, x, y + h), apply(m, x + w, y + h)]
  const xs = corners.map(point => point[0])
  const ys = corners.map(point => point[1])
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return [left, top, Math.max(...xs) - left, Math.max(...ys) - top]
}

const numbers = (text: string): number[] => (text.match(/-?[\d.]+(?:e[-+]?\d+)?/giu) ?? []).map(Number)

/** A computed `transform` (`none`, `matrix(...)` or `matrix3d(...)`, flattened to 2D). */
function parseTransform(text: string): Matrix {
  if (text === 'none' || text === '') return IDENTITY
  const values = numbers(text.slice(text.indexOf('(')))
  if (text.startsWith('matrix3d')) return [values[0] ?? 1, values[1] ?? 0, values[4] ?? 0, values[5] ?? 1, values[12] ?? 0, values[13] ?? 0]
  return [values[0] ?? 1, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1, values[4] ?? 0, values[5] ?? 0]
}

/** A computed `translate` (`none` or `x [y [z]]`, in px). */
function parseTranslate(text: string): readonly [number, number] {
  if (text === 'none' || text === '') return [0, 0]
  const values = numbers(text)
  return [values[0] ?? 0, values[1] ?? 0]
}

/** A computed `scale` (`none`, `s` or `sx sy [sz]`). */
function parseScale(text: string): readonly [number, number] {
  if (text === 'none' || text === '') return [1, 1]
  const values = numbers(text)
  const x = values[0] ?? 1
  return [x, values[1] ?? x]
}

/** A computed `rotate` (`none`, `<angle>` or `x y z <angle>`; only rotation about z counts in 2D), in degrees. */
function parseRotate(text: string): number {
  if (text === 'none' || text === '') return 0
  const angle = /(-?[\d.]+(?:e[-+]?\d+)?)(deg|rad|turn|grad)\s*$/iu.exec(text)
  if (angle === null) return 0
  const value = Number(angle[1])
  const unit = angle[2]?.toLowerCase()
  const parts = numbers(text)
  // `x y z angle`: a rotation about another axis than z does not turn the 2D picture.
  if (parts.length === 4 && (parts[0] !== 0 || parts[1] !== 0)) return 0
  const sign = parts.length === 4 && (parts[2] ?? 1) < 0 ? -1 : 1
  if (unit === 'rad') return (sign * value * 180) / Math.PI
  if (unit === 'turn') return sign * value * 360
  if (unit === 'grad') return sign * value * 0.9
  return sign * value
}

/**
 * An element's local matrix from its computed transform properties, as CSS composes them: the origin, then `translate`,
 * `rotate`, `scale` and `transform`, then the origin back.
 */
function local(origin: readonly [number, number], move: readonly [number, number], turn: number, size: readonly [number, number], transform: Matrix): Matrix {
  let m = translate(origin[0], origin[1])
  if (move[0] !== 0 || move[1] !== 0) m = multiply(m, translate(move[0], move[1]))
  if (turn !== 0) m = multiply(m, rotate(turn))
  if (size[0] !== 1 || size[1] !== 1) m = multiply(m, scale(size[0], size[1]))
  m = multiply(m, transform)
  return multiply(m, translate(-origin[0], -origin[1]))
}

/** 2D affine matrices and the computed transform values they come from. */
export class Affine {
  static readonly multiply = multiply
  static readonly invert = invert
  static readonly translate = translate
  static readonly scale = scale
  static readonly rotate = rotate
  static readonly apply = apply
  static readonly mapRect = mapRect
  static readonly parseTransform = parseTransform
  static readonly parseTranslate = parseTranslate
  static readonly parseScale = parseScale
  static readonly parseRotate = parseRotate
  static readonly local = local
}
