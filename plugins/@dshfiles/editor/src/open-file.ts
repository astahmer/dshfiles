import { z } from 'zod'

/**
 * Cross-plugin entry point: any plugin opens a file in the editor with
 * `window.dispatchEvent(new CustomEvent('dshfiles:open-file', { detail, cancelable: true }))`.
 * The editor calls `preventDefault()` when it took the request, so `dispatchEvent` returning false means handled
 * (same contract as `dshfiles:command-palette`).
 */
export const OPEN_FILE_EVENT = 'dshfiles:open-file'

export const openFileRequestSchema = z.object({
  /** Absolute, or relative to `cwd` when given, else to the session workspace root. */
  path: z.string().min(1).max(4096),
  line: z.number().int().positive().optional(),
  cwd: z.string().min(1).max(4096).optional(),
})

/** Moves the editor's active file of the session on screen to a line; handled (preventDefault) only when a file is open. */
export const GO_TO_LINE_EVENT = 'dshfiles:editor-go-to-line'

export const goToLineRequestSchema = z.object({ line: z.number().int().positive() })

export type OpenFileRequest = z.infer<typeof openFileRequestSchema>

const normalizeSegments = (path: string): string => {
  const absolute = path.startsWith('/')
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') segments.pop()
    else if (segment !== '..' || !absolute) segments.push(segment)
  }
  return (absolute ? '/' : '') + segments.join('/')
}

/**
 * One spelling per file, so the same file opened by tree (relative), tool call (absolute), `./x` or `a/../x` is one
 * tab: resolve against `cwd`, collapse `.`/`..`/`//`, and make it workspace-relative when it lies under one of the
 * session's known roots (its `cwd`, plus the symlink-resolved root learnt from Host `absolutePath`s).
 */
export const resolveRequestedPath = (request: OpenFileRequest, roots: readonly string[] = []): string => {
  const raw = request.path.replace(/\\/g, '/')
  const joined = raw.startsWith('/') || request.cwd === undefined ? raw : request.cwd.replace(/\/+$/, '') + '/' + raw
  const path = normalizeSegments(joined)
  if (!path.startsWith('/')) return path
  for (const root of roots) {
    const normalizedRoot = normalizeSegments(root)
    if (normalizedRoot !== '/' && path.startsWith(normalizedRoot + '/')) return path.slice(normalizedRoot.length + 1)
  }
  return path
}
