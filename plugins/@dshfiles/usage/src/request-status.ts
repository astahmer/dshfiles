import type { StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'
import type { RequestStatus } from './fold.js'

/** A request's outcome in the shared status vocabulary: a finished request is a muted check, only a failure is red. */
export const REQUEST_STATUS_GLYPH = {
  ok: 'done',
  aborted: 'stopped',
  failed: 'failed',
  unknown: 'stale',
} satisfies Readonly<Record<RequestStatus, StatusGlyphState>>
