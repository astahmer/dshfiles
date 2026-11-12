import type { ChatViewSlotProps } from '../contract/slots.ts'

/** "1 turn · 3 steps": each count names its own unit in the right number (composer follow-up b:gyk7). */
export function countsText(stats: { readonly turns: number; readonly steps: number }, t: ChatViewSlotProps['t']): string {
  const turns = t(stats.turns === 1 ? 'stats.turn.one' : 'stats.turn.other', { count: stats.turns })
  const steps = t(stats.steps === 1 ? 'stats.step.one' : 'stats.step.other', { count: stats.steps })
  return `${turns} · ${steps}`
}
