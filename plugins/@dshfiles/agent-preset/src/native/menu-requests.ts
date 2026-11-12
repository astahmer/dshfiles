/**
 * Asks the new-thread agent-preset chip to open its menu (composer follow-up b:4v6p). The composer hides the chip
 * while the draft keeps the default preset, so the composer ⋯ menu's "Agent mode…" row reaches it through this
 * channel: the chip opens and shows itself while its menu is open. Only the main view mounts a chip, so one set of
 * listeners is enough.
 */
const listeners = new Set<() => void>()

export const AgentPresetMenuRequests = {
  /** Open the mounted chip's menu; false when no chip is mounted (no new-thread draft on screen). */
  open: (): boolean => {
    for (const listener of listeners) listener()
    return listeners.size > 0
  },
  available: (): boolean => listeners.size > 0,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
