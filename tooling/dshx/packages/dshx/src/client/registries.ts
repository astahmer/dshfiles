import { createElement, type ComponentType } from 'react'
import { BrowserBroker } from './broker.js'
import { IsolationModel } from './isolation.js'
import type { SettingsSearchEntry } from '../settings/section-entries.js'
import { PluginContextModel, type NativeSlots } from './plugin-context.js'

/** A main view with its sidebar navigation row, sharing one id. */
export interface PanelItem {
  readonly id: string
  readonly title: string
  readonly component: ComponentType<never>
  readonly icon?: ComponentType<never>
  readonly order?: number
}

/** A compact control in the composer tool row. */
export interface ComposerActionItem {
  readonly id: string
  readonly placement?: 'left' | 'right'
  readonly order?: number
  readonly component: ComponentType<never>
}

/** A title-adjacent action in a session's header. */
export interface HeaderActionItem {
  readonly id: string
  readonly order?: number
  readonly component: ComponentType<never>
}

/** Leading content of each thread row in the sidebar, such as a badge. */
export interface SessionRowAccessoryItem {
  readonly id: string
  readonly order?: number
  readonly component: ComponentType<never>
}

/** A frame-wide floating layer entry: a toast stack, a notifier, a status pill. */
export interface OverlayItem {
  readonly id: string
  readonly order?: number
  readonly component: ComponentType<never>
}

/** A section in Settings. */
export interface SettingsSectionItem {
  readonly id: string
  readonly title: string
  readonly order?: number
  readonly component: ComponentType<never>
  /** Search metadata; picking one opens the section with its id as `target`. */
  readonly entries?: readonly SettingsSearchEntry[]
  /** Native ConfigForm entry ids whose field targets this section handles. */
  readonly settingsTargets?: readonly string[]
}

/** The page a Settings › Plugins detail view shows: a bundle, one of its rows, or an official item. */
export type PluginDetailSubject =
  | { readonly kind: 'bundle'; readonly pkg: { readonly name: string; readonly version?: string } }
  | { readonly kind: 'row'; readonly pkg: { readonly name: string; readonly version?: string }; readonly row: unknown }
  | { readonly kind: 'item'; readonly id: string }

export interface PluginDetailProps {
  readonly subject: PluginDetailSubject
}

/** A tag beside a plugin detail page's title, or a section under its content; render null for other subjects. */
export interface PluginDetailItem {
  readonly id: string
  readonly order?: number
  readonly component: ComponentType<PluginDetailProps>
}

export const Panel = BrowserBroker.defineRegistry<PanelItem>('dshx.panel')
export const ComposerAction = BrowserBroker.defineRegistry<ComposerActionItem>('dshx.composer-action')
export const HeaderAction = BrowserBroker.defineRegistry<HeaderActionItem>('dshx.header-action')
export const SessionRowAccessory = BrowserBroker.defineRegistry<SessionRowAccessoryItem>('dshx.session-row-accessory')
export const Overlay = BrowserBroker.defineRegistry<OverlayItem>('dshx.overlay')
export const SettingsSection = BrowserBroker.defineRegistry<SettingsSectionItem>('dshx.settings-section')
export const PluginDetailBadge = BrowserBroker.defineRegistry<PluginDetailItem>('dshx.plugin-detail-badge')
export const PluginDetailSection = BrowserBroker.defineRegistry<PluginDetailItem>('dshx.plugin-detail-section')

const PLUGIN_ID = /^[a-z@][a-z0-9@/._-]*$/u

const assertItemId = (registry: string, id: string): void => {
  if (!PLUGIN_ID.test(id)) throw new TypeError(`${registry} id ${JSON.stringify(id)} must use lowercase letters, digits, "@", "/", ".", "_" or "-".`)
}

const registerSlot = (slots: NativeSlots, name: string, options: Record<string, unknown>, component: unknown): (() => void) => {
  const dispose = slots.inject(name, () => slots.register({ name, ...options }, component))
  return typeof dispose === 'function' ? () => void dispose() : () => {}
}

const contribution = <Props extends object>(input: {
  readonly component: ComponentType<Props>
  readonly owner: string
  readonly id: string
  readonly decorate: <Component>(component: Component) => Component
}): ComponentType<Props> => input.decorate(IsolationModel.isolate(input.component, { owner: input.owner, id: input.id }))

PluginContextModel.registerNativeMount(Panel, ({ item, owner, slots, decorate }) => {
  assertItemId('Panel', item.id)
  if (item.id === 'conversation') throw new TypeError('Panel id "conversation" is reserved. Choose a plugin-owned id.')
  if (item.title.trim() === '') throw new TypeError('Panel title must be non-empty.')
  const icon = item.icon ?? (() => createElement('span', { 'aria-hidden': true }, item.title.slice(0, 1)))
  const disposeMain = registerSlot(slots, 'main', { key: item.id }, contribution({ component: item.component, owner, id: `panel:${item.id}`, decorate }))
  const disposeRow = registerSlot(
    slots,
    'sidebar.panellist',
    { id: item.id, order: item.order ?? 100, label: item.title },
    contribution({ component: icon, owner, id: `panel-icon:${item.id}`, decorate }),
  )
  return () => {
    disposeRow()
    disposeMain()
  }
})

PluginContextModel.registerNativeMount(ComposerAction, ({ item, owner, slots, decorate }) => {
  assertItemId('ComposerAction', item.id)
  return registerSlot(
    slots,
    item.placement === 'right' ? 'conversation.input.right' : 'conversation.input.left',
    { id: item.id, order: item.order ?? 100 },
    contribution({ component: item.component, owner, id: `composer-action:${item.id}`, decorate }),
  )
})

PluginContextModel.registerNativeMount(HeaderAction, ({ item, owner, slots, decorate }) => {
  assertItemId('HeaderAction', item.id)
  return registerSlot(
    slots,
    'conversation.session.header.actions',
    { id: item.id, order: item.order ?? 100 },
    contribution({ component: item.component, owner, id: `header-action:${item.id}`, decorate }),
  )
})

PluginContextModel.registerNativeMount(SessionRowAccessory, ({ item, owner, slots, decorate }) => {
  assertItemId('SessionRowAccessory', item.id)
  return registerSlot(
    slots,
    'sidebar.session.row.leading',
    { id: item.id, order: item.order ?? 100 },
    contribution({ component: item.component, owner, id: `session-row:${item.id}`, decorate }),
  )
})

PluginContextModel.registerNativeMount(Overlay, ({ item, owner, slots, decorate }) => {
  assertItemId('Overlay', item.id)
  return registerSlot(
    slots,
    'shell.overlay',
    { id: item.id, order: item.order ?? 100 },
    contribution({ component: item.component, owner, id: `overlay:${item.id}`, decorate }),
  )
})

PluginContextModel.registerNativeMount(PluginDetailBadge, ({ item, owner, slots, decorate }) => {
  assertItemId('PluginDetailBadge', item.id)
  return registerSlot(
    slots,
    'plugins.detail.badge',
    { id: item.id, order: item.order ?? 100 },
    contribution({ component: item.component, owner, id: `plugin-detail-badge:${item.id}`, decorate }),
  )
})

PluginContextModel.registerNativeMount(PluginDetailSection, ({ item, owner, slots, decorate }) => {
  assertItemId('PluginDetailSection', item.id)
  return registerSlot(
    slots,
    'plugins.detail.section',
    { id: item.id, order: item.order ?? 100 },
    contribution({ component: item.component, owner, id: `plugin-detail-section:${item.id}`, decorate }),
  )
})

PluginContextModel.registerNativeMount(SettingsSection, ({ item, owner, slots, decorate }) => {
  assertItemId('SettingsSection', item.id)
  if (item.title.trim() === '') throw new TypeError('SettingsSection title must be non-empty.')
  const metadata = {
    ...(item.settingsTargets !== undefined && { settingsTargets: item.settingsTargets }),
    ...(item.entries !== undefined && { searchEntries: item.entries }),
  }
  return registerSlot(
    slots,
    'settings.section',
    { id: item.id, order: item.order ?? 100, label: () => item.title, registrant: owner, ...(Object.keys(metadata).length > 0 && { metadata }) },
    contribution({ component: item.component, owner, id: `settings:${item.id}`, decorate }),
  )
})
