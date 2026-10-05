import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountsUsage, UsageCard } from './api.js'

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

/** One row per account that reports quota, for the compact surfaces. */
export const tightestRows = (usage: AccountsUsage | undefined): readonly { readonly instanceId: string; readonly tightest: TightestWindow }[] =>
  (usage?.cards ?? []).flatMap(card => {
    const tightest = tightestWindow(card.usage)
    return tightest === undefined ? [] : [{ instanceId: card.instanceId, tightest }]
  })

export type QuotaTone = 'ok' | 'low' | 'critical'

/** Coloured by how much is left rather than by provider. */
export const quotaTone = (percent: number): QuotaTone => (percent <= 10 ? 'critical' : percent <= 30 ? 'low' : 'ok')

const STATE_FOR_TONE: Record<QuotaTone, StateDotState> = { ok: 'done', low: 'warning', critical: 'error' }

export const quotaState = (percent: number): StateDotState => STATE_FOR_TONE[quotaTone(percent)]
