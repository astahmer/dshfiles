/**
 * The phone's status (round five C2): on the phone shell the frame no longer keeps a permanent pill row above the tab
 * bar. Status opens from a 44 px top-bar button that the screens' owners place through the `PhoneStatus` contract
 * (`status-strip.ts`); the bottom row comes back only while an item reports something the user must act on (an item
 * marks `data-status-actionable` in what it renders, as a quota running out or a lost connection would).
 *
 * The strip, which renders and measures the items, publishes what it read here; the button reads it. Both live in the
 * frame's client bundle, so this module-level store is one instance.
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StatusItem } from './status-strip.ts'

export interface PhoneStatusSnapshot {
  /** The strip measures items only at phone width; the button renders nothing otherwise. */
  readonly narrow: boolean
  /** What the items say, in strip order ("2 working · CC1 62%"); empty while nothing has been read. */
  readonly summary: string
  /** Some item reports a state the user must act on: the frame then draws its bottom row too. */
  readonly actionable: boolean
  /** The visible items, in strip order (global, then thread). */
  readonly items: readonly StatusItem[]
  /** The frame's session store, which every item receives. */
  readonly useSessions: PropsRuntime<'root'>['useSessions'] | null
}

const EMPTY: PhoneStatusSnapshot = { narrow: false, summary: '', actionable: false, items: [], useSessions: null }

/** The attribute an item puts on what it renders while it needs the user. */
export const STATUS_ACTIONABLE_ATTRIBUTE = 'data-status-actionable'

export class PhoneStatusModel {
  /**
   * The phone row's mode: `compact` (the pill row is drawn) only for an actionable state, else `button` (the row is
   * gone and the top-bar button carries status).
   */
  static stripMode = (actionable: boolean): 'compact' | 'button' => (actionable ? 'compact' : 'button')

  /** Whether a measured subtree holds an item that needs the user. */
  static actionable = (root: ParentNode): boolean => root.querySelector(`[${STATUS_ACTIONABLE_ATTRIBUTE}]`) !== null

  /** The button's accessible name: what the items say, never a bare "Status" when there is something to say. */
  static label = (summary: string): string => (summary === '' ? 'Status' : `Status: ${summary}`)

  /** The button shows only on a phone-width frame with at least one visible item. */
  static shown = (snapshot: PhoneStatusSnapshot): boolean => snapshot.narrow && snapshot.items.length > 0 && snapshot.useSessions !== null
}

/** The one store the strip writes and the top-bar button reads. */
export class PhoneStatusStore {
  private snapshot: PhoneStatusSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()

  readonly get = (): PhoneStatusSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Merge a change; listeners hear only a real change, so the strip can publish on every measurement. */
  readonly publish = (next: Partial<PhoneStatusSnapshot>): void => {
    const merged: PhoneStatusSnapshot = { ...this.snapshot, ...next }
    const current = this.snapshot
    const same =
      merged.narrow === current.narrow &&
      merged.summary === current.summary &&
      merged.actionable === current.actionable &&
      merged.items === current.items &&
      merged.useSessions === current.useSessions
    if (same) return
    this.snapshot = merged
    for (const listener of this.listeners) listener()
  }

  /** The strip unmounted (or left phone width): nothing to show. */
  readonly reset = (): void => {
    this.publish(EMPTY)
  }
}

export const phoneStatus = new PhoneStatusStore()
