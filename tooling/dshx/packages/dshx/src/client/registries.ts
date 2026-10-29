import { createElement, useState, type ComponentType, type ReactNode } from 'react'
import { BrowserBroker } from './broker.js'
import { IsolationModel } from './isolation.js'
import { SettingsSearchEntriesModel, type SettingsSearchEntry } from '../settings/section-entries.js'
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

/** One row of a composer pill's menu. */
export interface ComposerPillRow {
  readonly id: string
  readonly title: string
  readonly disabled?: boolean
  /** Destructive row colors. */
  readonly danger?: boolean
  run(): void
}

/** What a composer pill shows in one session's composer. */
export interface ComposerPillState {
  readonly label: string
  readonly icon?: ReactNode
  /** Rows a click on the pill opens; without rows the pill is a plain reading. */
  readonly menu?: readonly ComposerPillRow[]
}

/** A pill above a session's composer, with an optional row menu. */
export interface ComposerPillItem {
  readonly id: string
  readonly order?: number
  /** Called as a React hook in each session's composer; undefined hides the pill there. */
  usePill(session: { readonly sessionId: string }): ComposerPillState | undefined
}

/** A row in a menu another plugin owns and renders, picked by `menu` (`workbench.new-view`: the workbench's New tab chooser). */
export interface MenuRowItem {
  readonly id: string
  readonly menu: string
  readonly title: string
  readonly keywords?: readonly string[]
  readonly order?: number
  run(): void
}

export interface FileViewerProps {
  readonly sessionId: string
  /** Workspace-relative path of the open file. */
  readonly path: string
  /** The file's current text, unsaved edits included. */
  readonly text: string
}

/** Another way to show a text file the editor has open, such as a rendered Markdown preview; the editor offers it as a toggle. */
export interface FileViewerItem {
  readonly id: string
  /** The toggle's name, e.g. `Preview`. */
  readonly title: string
  matches(path: string): boolean
  readonly component: ComponentType<FileViewerProps>
}

/** A section in Settings. */
export interface SettingsSectionItem {
  readonly id: string
  readonly title: string
  readonly order?: number
  readonly component: ComponentType<never>
  /** Search metadata; picking one opens the section with its id as `target`. */
  readonly entries?: readonly SettingsSearchEntry[]
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
export const ComposerPill = BrowserBroker.defineRegistry<ComposerPillItem>('dshx.composer-pill')
export const MenuItem = BrowserBroker.defineRegistry<MenuRowItem>('dshx.menu-item')
export const FileViewer = BrowserBroker.defineRegistry<FileViewerItem>('dshx.file-viewer')
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

interface PillPrimitives {
  readonly Pill: ComponentType<{
    readonly children?: ReactNode
    readonly onClick?: () => void
    readonly 'aria-haspopup'?: 'menu'
    readonly 'aria-expanded'?: boolean
  }>
  readonly Menu: ComponentType<{
    readonly open: boolean
    readonly anchor: ReactNode
    readonly items: readonly { readonly id: string; readonly label: ReactNode; readonly disabled: boolean | undefined; readonly danger: boolean | undefined }[]
    readonly onSelect: (id: string) => void
    readonly onClose: () => void
    readonly side: 'top'
    readonly portal: boolean
  }>
}

const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

const isPillPrimitives = (value: unknown): value is PillPrimitives =>
  typeof value === 'object' && value !== null && 'Pill' in value && typeof value.Pill === 'function' && 'Menu' in value && typeof value.Menu === 'function'

// The Host serves the primitives as a platform module through the Client loader's `require`; a page without it
// (a test, another Host) gets plain buttons with the same roles.
const pillPrimitives = (): PillPrimitives | undefined => {
  try {
    const primitives: unknown = typeof require === 'function' ? require(PRIMITIVES_MODULE) : undefined
    return isPillPrimitives(primitives) ? primitives : undefined
  } catch {
    return undefined
  }
}

const composerPillFrame = (item: ComposerPillItem): ComponentType<{ readonly sessionId: string }> => {
  const Frame = (props: { readonly sessionId: string }): ReactNode => {
    const pill = item.usePill({ sessionId: props.sessionId })
    const [open, setOpen] = useState(false)
    if (pill === undefined) return null
    const content = [pill.icon, pill.label]
    const rows = pill.menu ?? []
    const primitives = pillPrimitives()
    const select = (id: string): void => {
      setOpen(false)
      rows.find(row => row.id === id && row.disabled !== true)?.run()
    }
    if (primitives !== undefined) {
      if (rows.length === 0) return createElement(primitives.Pill, null, ...content)
      return createElement(primitives.Menu, {
        open,
        side: 'top',
        portal: true,
        anchor: createElement(primitives.Pill, { onClick: () => setOpen(!open), 'aria-haspopup': 'menu', 'aria-expanded': open }, ...content),
        items: rows.map(row => ({ id: row.id, label: row.title, disabled: row.disabled, danger: row.danger })),
        onSelect: select,
        onClose: () => setOpen(false),
      })
    }
    if (rows.length === 0) return createElement('span', { 'data-dshx-composer-pill': item.id }, ...content)
    return createElement(
      'span',
      { 'data-dshx-composer-pill': item.id },
      createElement('button', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen(!open) }, ...content),
      open
        ? createElement(
            'span',
            { role: 'menu' },
            ...rows.map(row =>
              createElement(
                'button',
                { key: row.id, type: 'button', role: 'menuitem', disabled: row.disabled === true, onClick: () => select(row.id) },
                row.title,
              ),
            ),
          )
        : null,
    )
  }
  Frame.displayName = `ComposerPill(${item.id})`
  return Frame
}

PluginContextModel.registerNativeMount(ComposerPill, ({ item, owner, slots, decorate }) => {
  assertItemId('ComposerPill', item.id)
  return registerSlot(
    slots,
    'conversation.input.dock',
    { id: item.id, order: item.order ?? 100, inject: (sessionId: string) => ({ sessionId }) },
    contribution({ component: composerPillFrame(item), owner, id: `composer-pill:${item.id}`, decorate }),
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
  const disposeSlot = registerSlot(
    slots,
    'settings.section',
    { id: item.id, order: item.order ?? 100, label: () => item.title, registrant: owner },
    contribution({ component: item.component, owner, id: `settings:${item.id}`, decorate }),
  )
  // The native slot ledger drops `metadata`, so search entries reach the Settings shell through the dshx seat.
  const unpublish = item.entries === undefined ? () => {} : SettingsSearchEntriesModel.publish({ sectionId: item.id, entries: item.entries })
  return () => {
    unpublish()
    disposeSlot()
  }
})
