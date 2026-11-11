/**
 * Projection patches for the Host-wide `session/control` stream: a changed projection value travels as what changed
 * since the value the same stream sent last, not as the whole value again. Both sides of a stream hold the last value
 * per cell (Session × projection key); the Host encodes, and every reader (the browser Client, `@dshfiles/multi-host`)
 * decodes.
 */

import { Schema } from 'effect'

/** A JSON value as projections publish it; the codec never mutates one. */
export type PatchJson = Schema.MutableJson

/** One change: a replacement, an array cut at `a` and continued with `i`, or an object's changed and deleted keys. */
export type ProjectionPatch =
  | { readonly s: PatchJson }
  | { readonly a: number; readonly i: PatchJson[] }
  | { readonly o: { readonly [key: string]: ProjectionPatch }; readonly d?: readonly string[] }

type JsonObject = Schema.MutableJsonObject

const patchSchema: Schema.Codec<ProjectionPatch> = Schema.Union([
  Schema.Struct({ s: Schema.MutableJson }),
  Schema.Struct({ a: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), i: Schema.mutable(Schema.Array(Schema.MutableJson)) }),
  Schema.Struct({
    o: Schema.Record(Schema.String, Schema.suspend((): Schema.Codec<ProjectionPatch> => patchSchema)),
    d: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
])

/** Decode a patch read from the wire; a malformed one fails like a misfit, and the reader resynchronizes. */
export const decodeProjectionPatch = Schema.decodeUnknownSync(patchSchema)

const isObject = (value: PatchJson): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

const same = (left: PatchJson, right: PatchJson): boolean => Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)

const diffValue = (previous: PatchJson, next: PatchJson): ProjectionPatch | undefined => {
  if (Object.is(previous, next)) return undefined
  if (Array.isArray(previous) && Array.isArray(next)) {
    let cut = 0
    while (cut < previous.length && cut < next.length && same(previous[cut] as PatchJson, next[cut] as PatchJson)) cut += 1
    if (cut === previous.length && cut === next.length) return undefined
    return { a: cut, i: next.slice(cut) }
  }
  if (isObject(previous) && isObject(next)) {
    const changed: Record<string, ProjectionPatch> = {}
    let count = 0
    for (const [key, value] of Object.entries(next)) {
      const before = previous[key]
      const patch = before === undefined ? { s: value } : diffValue(before, value)
      if (patch === undefined) continue
      changed[key] = patch
      count += 1
    }
    const deleted = Object.keys(previous).filter(key => !Object.hasOwn(next, key))
    if (count === 0 && deleted.length === 0) return undefined
    return deleted.length === 0 ? { o: changed } : { o: changed, d: deleted }
  }
  return same(previous, next) ? undefined : { s: next }
}

/**
 * The patch from `previous` to `next`, when it is worth sending instead of `next`. A value republished unchanged
 * (a new watermark) patches to nothing.
 * @returns `'replace'` when the patch would not be smaller than the value.
 */
export const diffProjection = (previous: PatchJson, next: PatchJson): ProjectionPatch | 'replace' => {
  const patch = diffValue(previous, next) ?? (Array.isArray(previous) ? { a: previous.length, i: [] } : isObject(previous) ? { o: {} } : { s: next })
  if ('s' in patch) return 'replace'
  return JSON.stringify(patch).length < JSON.stringify(next).length ? patch : 'replace'
}

/**
 * Apply one patch to the value it was computed from.
 * @throws when the patch does not fit `previous`: the stream lost a frame, and the reader must resynchronize.
 */
export const applyProjectionPatch = (previous: PatchJson, patch: ProjectionPatch): PatchJson => {
  if ('s' in patch) return patch.s
  if ('a' in patch) {
    if (!Array.isArray(previous) || patch.a > previous.length) throw new Error('projection patch does not fit its array')
    return [...previous.slice(0, patch.a), ...patch.i]
  }
  if (!isObject(previous)) throw new Error('projection patch does not fit its object')
  const next: Record<string, PatchJson> = {}
  const deleted = new Set(patch.d)
  for (const [key, value] of Object.entries(previous)) {
    if (deleted.has(key)) continue
    const change = patch.o[key]
    next[key] = change === undefined ? value : applyProjectionPatch(value, change)
  }
  for (const [key, change] of Object.entries(patch.o)) {
    if (Object.hasOwn(previous, key)) continue
    if (!('s' in change)) throw new Error(`projection patch changes the missing key "${key}"`)
    next[key] = change.s
  }
  return next
}

/** The cell a projection value belongs to on one stream. */
export const projectionCell = (sessionId: string, key: string): string => `${sessionId}\u0000${key}`
