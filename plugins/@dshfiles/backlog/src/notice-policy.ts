export const BACKLOG_NOTICE_HOLD_MS = {
  progress: 60_000,
  success: 15_000,
  failure: 9_000,
}

export type BacklogNoticeKind = keyof typeof BACKLOG_NOTICE_HOLD_MS
