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

export type OpenFileRequest = z.infer<typeof openFileRequestSchema>

export const resolveRequestedPath = (request: OpenFileRequest): string => {
  if (request.path.startsWith('/') || request.cwd === undefined) return request.path
  return request.cwd.replace(/\/+$/, '') + '/' + request.path.replace(/^\.\//, '')
}
