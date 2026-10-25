import { readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { withSpan } from '@dshfiles/dshx/tracing'

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const ALLOWED = /\.html?$/i

export type PreviewFailure = 'outside-workspace' | 'unsupported' | 'missing' | 'too-large'

export type PreviewResult =
  | { readonly ok: true; readonly value: { readonly path: string; readonly html: string; readonly truncated: boolean } }
  | { readonly ok: false; readonly error: PreviewFailure }

export const readPreview = async ({ root, path }: { readonly root: string; readonly path: string }): Promise<PreviewResult> =>
  withSpan('annotations read preview', async () => {
    const absolute = resolve(root, path)
    const relativePath = relative(root, absolute)
    if (relativePath.startsWith('..') || relativePath.length === 0) return { ok: false, error: 'outside-workspace' }
    if (!ALLOWED.test(absolute)) return { ok: false, error: 'unsupported' }
    const info = await stat(absolute).catch(() => undefined)
    if (info === undefined || !info.isFile()) return { ok: false, error: 'missing' }
    if (info.size > MAX_PREVIEW_BYTES) return { ok: false, error: 'too-large' }
    const html = await readFile(absolute, 'utf8').catch(() => undefined)
    if (html === undefined) return { ok: false, error: 'missing' }
    return { ok: true, value: { path: relativePath, html, truncated: false } }
  })
