/**
 * The status strip (plan `plans/ade-ux` §4.1 region R5): one thin row at the bottom of the frame. Plugins add at most
 * one item each through `StatusItems`; global items sit on the left, items about the open thread on the right. The
 * frame owns the row, its order and its phone form (one chip that opens the list); a plugin owns only its item's text.
 *
 * Published as the `@dshfiles/frame-layout/status-strip` dshx module. It imports no React and no provider, so a plugin
 * that adds an item depends on frame-layout and never the reverse (docs/plugin-boundaries.md). Without frame-layout as
 * the layout owner nothing renders the registry, so an item simply does not show.
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ReactElement } from 'react'

/** What the frame hands every item. */
export interface StatusItemProps {
  /** Phone width: the item renders inside the opened chip list, one line, no hover-only content. */
  readonly compact: boolean
  /** The frame's session store, so a thread item can follow the open thread without its own subscription. */
  readonly useSessions: PropsRuntime<'root'>['useSessions']
}

/** A component the frame renders; it returns null to hide the item while it has nothing to say. */
export type StatusItemComponent = (props: StatusItemProps) => ReactElement | null

export interface StatusItem {
  /** The providing package (`@dshfiles/ai-accounts`): the frame keeps the first item per id, so one plugin, one item. */
  readonly id: string
  /** `global` (left) is about the whole ADE; `thread` (right) is about the thread on the stage. */
  readonly side: 'global' | 'thread'
  /** Lower first within its side; ties keep registration order. */
  readonly order?: number
  /** One-word name for the phone chip list and assistive technology ("Quota", "Working", "Restart"). */
  readonly label: string
  /** Bind it with `api.bind(...)` so its hooks read the providing plugin's context. */
  readonly component: StatusItemComponent
  /** Opens the item's full page; the frame renders the item as a button that calls it. */
  readonly open?: () => void
  /** The item draws its own buttons: the frame never wraps it in one and offers `open` from its context menu only. */
  readonly controls?: boolean
}

/** Plugins contribute with `api.add(StatusItems, { id, side, label, component: api.bind(View) })`. */
export const StatusItems = defineRegistry<StatusItem>('@dshfiles/frame-layout.status-item')

/** One item per id (the first registered wins), each side sorted by order, then registration order. */
const arrange = (items: readonly StatusItem[]): { readonly global: readonly StatusItem[]; readonly thread: readonly StatusItem[] } => {
  const seen = new Set<string>()
  const unique: { readonly item: StatusItem; readonly index: number }[] = []
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    unique.push({ item, index })
  }
  const side = (which: StatusItem['side']): readonly StatusItem[] =>
    unique
      .filter(entry => entry.item.side === which)
      .sort((left, right) => (left.item.order ?? 0) - (right.item.order ?? 0) || left.index - right.index)
      .map(entry => entry.item)
  return { global: side('global'), thread: side('thread') }
}

export class StatusStripModel {
  static readonly arrange = arrange
}
