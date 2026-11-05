import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentType } from 'react'

/** The slot-ledger face this module needs; `ctx.slots` provides it. */
export interface SlotLedger {
  entriesOfSlot(key: string): readonly StoredEntry[]
  subscribe(key: string, listener: () => void): () => void
}

/** Every wrapper this module made, so a re-registration is wrapped once and our own components are never wrapped. */
const wrappers = new WeakSet<object>()

/**
 * Swap the component of each matching entry of `slot` for `wrap(original)`, again whenever the slot changes (HMR,
 * another plugin taking the seat). The ledger renders the swapped entry with the original's full props — its injected
 * face, locale and standard props — so a wrapper can draw the native view beside, or instead of, its own. Returns the
 * disposer that puts every original back.
 *
 * Used for the seats where the native occupant takes injected props a shadowing entry could not supply:
 * `tool.call.toolview` `todo_write`, `conversation.input.plan`, `conversation.input.activity`, and the
 * `conversation.chat.node` `turn-error` / `model-retry` renderers.
 */
export const wrapSlotEntries = <Props extends object>(input: {
  readonly slots: SlotLedger
  readonly slot: string
  readonly matches: (entry: StoredEntry) => boolean
  readonly wrap: (original: ComponentType<Props>) => ComponentType<Props>
}): (() => void) => {
  const originals = new Map<StoredEntry, unknown>()
  const apply = (): void => {
    let entries: readonly StoredEntry[]
    try {
      entries = input.slots.entriesOfSlot(input.slot)
    } catch {
      // The slot is declared later (a child of a composer or chat entry); the subscription retries then.
      return
    }
    for (const entry of entries) {
      const component = entry.component
      if (!input.matches(entry) || (typeof component !== 'function' && (typeof component !== 'object' || component === null))) continue
      if (wrappers.has(component)) continue
      originals.set(entry, component)
      // SAFETY: the ledger erases component types; every entry of one slot cell renders with that cell's props, which
      // the caller names as Props.
      const wrapped = input.wrap(component as ComponentType<Props>)
      wrappers.add(wrapped)
      entry.component = wrapped
    }
  }
  apply()
  let unsubscribe: () => void = () => {}
  try {
    unsubscribe = input.slots.subscribe(input.slot, apply)
  } catch {
    // An undeclared slot cannot be observed yet; the entries registered at declaration are wrapped on the next apply.
  }
  return () => {
    unsubscribe()
    for (const [entry, original] of originals) if (typeof entry.component === 'function' && wrappers.has(entry.component)) entry.component = original
    originals.clear()
  }
}

/** Mark a component this plugin registers itself, so the wrapper never wraps it. */
export const markOwnComponent = <Component extends object>(component: Component): Component => {
  wrappers.add(component)
  return component
}
