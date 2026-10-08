import type { UsageCard } from './api.js'

export interface TightestWindow {
  readonly percent: number
  readonly label: string
  readonly resetsAt: number | null
}

/** Tightest window (the smallest percent) an account currently reports. */
export const tightestWindow = (card: UsageCard): TightestWindow | undefined => {
  if (card.status !== 'ok') return undefined
  return card.windows.reduce<TightestWindow | undefined>((current, window) => {
    if (current !== undefined && current.percent <= window.percentRemaining) return current
    return { percent: window.percentRemaining, label: window.label, resetsAt: window.resetsAt }
  }, undefined)
}

export type QuotaTone = 'ok' | 'low' | 'critical'

/** Coloured by how much is left rather than by provider. */
export const quotaTone = (percent: number): QuotaTone => (percent <= 10 ? 'critical' : percent <= 30 ? 'low' : 'ok')

export const QUOTA_TONE_TEXT = {
  ok: 'dshx:text-success',
  low: 'dshx:text-warning',
  critical: 'dshx:text-destructive',
} satisfies Record<QuotaTone, string>

export const QUOTA_TONE_FILL = {
  ok: 'dshx:bg-success',
  low: 'dshx:bg-warning',
  critical: 'dshx:bg-destructive',
} satisfies Record<QuotaTone, string>

/** Tints the shadcn Progress indicator, whose own fill is always the brand colour. */
export const QUOTA_TONE_PROGRESS = {
  ok: 'dshx:*:data-[slot=progress-indicator]:bg-success',
  low: 'dshx:*:data-[slot=progress-indicator]:bg-warning',
  critical: 'dshx:*:data-[slot=progress-indicator]:bg-destructive',
} satisfies Record<QuotaTone, string>
