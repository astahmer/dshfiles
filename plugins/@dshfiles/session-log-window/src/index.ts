/**
 * Bounded reads of a stored Session log. A reader that needs a few events — the newest ones, the first ones, or the
 * events a predicate selects — decodes a window of the log instead of its whole event list, and answers `undefined`
 * when only the full read can serve it exactly. The JSONL backend writes one independently decodable Zstandard frame
 * per durable append, which is what makes a window readable at all.
 * @module @dshfiles/session-log-window
 */
export {
  fileIdentityOf,
  fileSizeOf,
  frameEndAt,
  readFileHead,
  readFileWindow,
  scanFrames,
  scanFramesPrefix,
  scanWindowFrames,
  type FrameRange,
} from './frames.ts'
export {
  HEAD_WINDOW_BYTES,
  MIN_TAIL_BYTES,
  TAIL_WINDOW_BYTES,
  openLogHead,
  recentLogEvents,
  TailLog,
  type LogHead,
  type LogWindowInput,
  type LogWindowMetrics,
  type RecentLogEvents,
} from './window.ts'
