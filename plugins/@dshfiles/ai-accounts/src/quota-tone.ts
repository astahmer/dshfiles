export type QuotaTone = 'ok' | 'low' | 'critical'

/** At or below this much left a window turns warning amber (the status strip, Usage › Quota and the history agree). */
const LOW_PERCENT = 15

/**
 * Coloured by how much is left rather than by provider, and only where it matters (DESIGN.md: colour is a signal): a
 * healthy window is neutral ink, 15% or less is warning amber, and a spent window (requests fail) is danger red.
 */
export const quotaTone = (percent: number): QuotaTone => (Math.round(percent) <= 0 ? 'critical' : percent <= LOW_PERCENT ? 'low' : 'ok')

export const QUOTA_TONE_TEXT = {
  ok: 'dshx:text-foreground',
  low: 'dshx:text-warning',
  critical: 'dshx:text-destructive',
} satisfies Record<QuotaTone, string>

/** Tints the shadcn Progress indicator, whose own fill is always the brand colour. */
export const QUOTA_TONE_PROGRESS = {
  ok: 'dshx:*:data-[slot=progress-indicator]:bg-muted-foreground',
  low: 'dshx:*:data-[slot=progress-indicator]:bg-warning',
  critical: 'dshx:*:data-[slot=progress-indicator]:bg-destructive',
} satisfies Record<QuotaTone, string>
