/**
 * Productivity pass Q5 (T5.3): the controls above the first thread row fold into the search field, one project picker
 * and one Filter menu. The Threads destination (destination-shell.tsx) owns two of them — its pages (Board) and the
 * sidebar customization toggle — while the list (client.tsx) owns the Filter menu. The destination publishes its
 * entries here and the list renders them as Filter menu items, so neither component reaches into the other's props.
 */
import type { ReactNode } from 'react'

export interface ListHeaderSection {
  readonly panelId: string
  readonly label: string
  readonly active: boolean
  readonly icon: ReactNode
  readonly open: () => void
}

export interface ListHeaderExtrasValue {
  readonly sections: readonly ListHeaderSection[]
  readonly customize: { readonly label: string; readonly expanded: boolean; readonly toggle: () => void } | undefined
}

const EMPTY: ListHeaderExtrasValue = { sections: [], customize: undefined }
let current: ListHeaderExtrasValue = EMPTY
const listeners = new Set<() => void>()

export class ListHeaderExtras {
  static readonly empty = EMPTY

  static get(): ListHeaderExtrasValue {
    return current
  }

  static subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** Publish the destination's entries; returns the reset for the publisher's cleanup. */
  static publish(value: ListHeaderExtrasValue): () => void {
    current = value
    for (const listener of [...listeners]) listener()
    return () => {
      if (current !== value) return
      current = EMPTY
      for (const listener of [...listeners]) listener()
    }
  }
}
