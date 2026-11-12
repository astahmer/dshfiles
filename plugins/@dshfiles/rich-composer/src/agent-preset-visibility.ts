/**
 * Whether the new-thread bar always shows the agent mode picker (the `showAgentPresetPicker` setting, b:4v6p). Off by
 * default: the seat stays mounted, and the bar hides it while the draft keeps the default preset (the chip marks itself
 * `data-agent-preset-default`) unless its menu is open. The client entry writes it from Settings; the bar reads it.
 */
let shown = false
const listeners = new Set<() => void>()

export const AgentPresetVisibility = {
  get: (): boolean => shown,
  set: (next: boolean): void => {
    if (next === shown) return
    shown = next
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
