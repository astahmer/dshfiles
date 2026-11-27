/**
 * The sidebar's command palette rows, registered by content (performance P1, round 34). The rows are rebuilt on every
 * render that touches one of their many inputs, and a thread switch touched at least one: every switch withdrew and
 * re-added every row, each add and remove republishing the palette's whole list (546 list rebuilds per click).
 *
 * The rows register once per *content*: what the palette draws and matches (id, group, label text, aliases, keys,
 * heading, icon) and which callbacks exist. Each registered row calls through to the latest render's callbacks, so a
 * fresh closure or an equal icon element never re-registers, while a renamed row, a new or dropped row or a different
 * icon does.
 */
import type { PaletteAction, PaletteActionContext } from '@dshfiles/command-palette/palette-contract'
import { isValidElement, useEffect, useRef, useState, type JSXElementConstructor, type ReactElement, type ReactNode } from 'react'

type AddActions = (actions: readonly PaletteAction[]) => () => void

/** Each component an icon element renders, numbered once: two elements of one component share its number. */
const componentNumbers = new WeakMap<JSXElementConstructor<never>, number>()
let nextComponentNumber = 0
const typeKey = (type: ReactElement['type']): string => {
  if (typeof type === 'string') return type
  let number = componentNumbers.get(type)
  if (number === undefined) {
    nextComponentNumber += 1
    number = nextComponentNumber
    componentNumbers.set(type, number)
  }
  return `#${String(number)}`
}

/** What an icon element draws, as far as its type and plain props say: two equal elements share a key. */
const iconKey = (icon: ReactNode): string => {
  if (icon === undefined || icon === null || typeof icon === 'boolean') return ''
  if (!isValidElement(icon)) return typeof icon === 'string' || typeof icon === 'number' ? String(icon) : 'node'
  const props = typeof icon.props === 'object' && icon.props !== null ? Object.entries(icon.props) : []
  const plain = props.filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)).sort(([left], [right]) => left.localeCompare(right))
  return `${typeKey(icon.type)}${JSON.stringify(plain)}`
}

/** One row's content: everything the palette draws or matches, and which optional callbacks it has. */
const signatureOf = (action: PaletteAction): string =>
  JSON.stringify([
    action.id,
    action.group ?? null,
    typeof action.label === 'string' ? action.label : null,
    action.aliases ?? null,
    action.keys ?? null,
    action.shortcutId ?? null,
    action.suggested ?? null,
    typeof action.heading === 'string' ? action.heading : action.heading === undefined ? null : 'fn',
    iconKey(action.icon),
    action.isAvailable !== undefined,
    action.isSelected !== undefined,
  ])

/** The rows' combined content; equal content keeps the registered rows. */
export const paletteSignature = (actions: readonly PaletteAction[]): string => actions.map(signatureOf).join('\n')

/** A registered row that reads its callbacks (and a computed label or heading) from the latest render's row. */
const proxyOf = (action: PaletteAction, latest: () => ReadonlyMap<string, PaletteAction>): PaletteAction => {
  const current = (): PaletteAction => latest().get(action.id) ?? action
  const label = action.label
  const proxy: { -readonly [Key in keyof PaletteAction]: PaletteAction[Key] } = {
    ...action,
    label:
      typeof label === 'string'
        ? label
        : () => {
            const now = current().label
            return typeof now === 'string' ? now : now()
          },
    run: context => current().run(context),
  }
  if (action.heading !== undefined && typeof action.heading !== 'string')
    proxy.heading = () => {
      const now = current().heading
      return now === undefined ? '' : typeof now === 'string' ? now : now()
    }
  if (action.isAvailable !== undefined) proxy.isAvailable = (context: PaletteActionContext) => current().isAvailable?.(context) ?? true
  if (action.isSelected !== undefined) proxy.isSelected = (context: PaletteActionContext) => current().isSelected?.(context) ?? false
  return proxy
}

/**
 * Register `actions` with the palette until unmount, re-registering only when their content changes.
 * @param add - how a batch is registered (the palette bridge); one call per content change.
 */
export const usePaletteActions = (actions: readonly PaletteAction[], add: AddActions): void => {
  const latest = useRef<ReadonlyMap<string, PaletteAction>>(new Map())
  // After every render, before the registration below reads it: the callbacks a run or a label calls.
  useEffect(() => {
    latest.current = new Map(actions.map(action => [action.id, action]))
  })
  const signature = paletteSignature(actions)
  // The rows as they were when this content was first seen; later renders with equal content keep them.
  const [registered, setRegistered] = useState({ signature, actions })
  if (registered.signature !== signature) setRegistered({ signature, actions })
  const rows = registered.actions
  useEffect(() => add(rows.map(action => proxyOf(action, () => latest.current))), [add, rows])
}
