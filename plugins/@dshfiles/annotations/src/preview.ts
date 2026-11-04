import { relative, resolve } from 'node:path'
import { Effect, FileSystem, Option } from 'effect'

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const ALLOWED = /\.html?$/i

export type PreviewFailure = 'outside-workspace' | 'unsupported' | 'missing' | 'too-large'

export type PreviewResult =
  | { readonly ok: true; readonly value: { readonly path: string; readonly html: string; readonly truncated: boolean } }
  | { readonly ok: false; readonly error: PreviewFailure }

const refused = (error: PreviewFailure): PreviewResult => ({ ok: false, error })

/** One HTML file inside `root`, for the preview pane; anything outside the workspace or too large is refused. */
export const readPreview = Effect.fn('annotations read preview')(function* (input: { readonly root: string; readonly path: string }) {
  const absolute = resolve(input.root, input.path)
  const relativePath = relative(input.root, absolute)
  if (relativePath.startsWith('..') || relativePath.length === 0) return refused('outside-workspace')
  if (!ALLOWED.test(absolute)) return refused('unsupported')
  const fileSystem = yield* FileSystem.FileSystem
  const info = yield* fileSystem.stat(absolute).pipe(Effect.option)
  if (Option.isNone(info) || info.value.type !== 'File') return refused('missing')
  if (info.value.size > MAX_PREVIEW_BYTES) return refused('too-large')
  const html = yield* fileSystem.readFileString(absolute).pipe(Effect.option)
  if (Option.isNone(html)) return refused('missing')
  return { ok: true, value: { path: relativePath, html: html.value, truncated: false } } satisfies PreviewResult
})
