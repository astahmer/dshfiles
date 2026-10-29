import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { useState, useSyncExternalStore } from 'react'
import { InlineTitleEditor } from '@dshfiles/plugin-ui/components/ui/inline-title-editor'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { PinIcon, PlusIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { workbenchTabs } from './tabs.js'
import type { WorkbenchPanelRegistry } from './registry.js'
import { SurfaceAction } from './surface-action.js'
import { NewViewTabs } from './new-view.js'
import { TabRows } from './tab-row-visibility.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

/** The main seat's compact action drives the existing tab provider, never a second tab actor. */
export const WorkbenchNewTabButton = (props: { readonly label: string }): JSX.Element | null => {
  const channel = workbenchTabs()
  const snapshot = useSyncExternalStore(channel.subscribe, channel.getSnapshot)
  if (!snapshot.enabled) return null
  return (
    <SurfaceAction
      label={props.label}
      icon={<PlusIcon aria-hidden />}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation()
        channel.actions.newTab()
      }}
    />
  )
}

/** Bulk close for panels without a semantic tab, read from the group when the menu opens. */
const GroupCloseItems = (props: {
  readonly panel: IDockviewPanelHeaderProps['api']
  readonly closePanel: (id: string, params: unknown) => void
}): JSX.Element => {
  const panels = [...props.panel.group.panels]
  const position = panels.findIndex(panel => panel.id === props.panel.id)
  const closeExcept = (keep: (index: number) => boolean): void => {
    for (const [index, panel] of panels.entries()) if (!keep(index)) props.closePanel(panel.id, panel.params)
  }
  return (
    <>
      <ContextMenuItem disabled={panels.length < 2} onSelect={() => closeExcept(index => index === position)}>
        Close other tabs
      </ContextMenuItem>
      <ContextMenuItem disabled={position === panels.length - 1} onSelect={() => closeExcept(index => index <= position)}>
        Close tabs to the right
      </ContextMenuItem>
    </>
  )
}

export const createWorkbenchTab = (registry: WorkbenchPanelRegistry) =>
  function WorkbenchTab(props: IDockviewPanelHeaderProps): JSX.Element {
    const channel = workbenchTabs()
    const snapshot = useSyncExternalStore(channel.subscribe, channel.getSnapshot)
    useSyncExternalStore(
      listener => TabRows.subscribe(props.containerApi, listener),
      () => TabRows.version(props.containerApi),
    )
    const sourceId = NewViewTabs.sourceId(props.params, props.api.id)
    const definition = useSyncExternalStore(registry.subscribe, () => registry.get(sourceId))
    const tab = snapshot.tabs.find(candidate => candidate.id === definition?.tabId)
    const title = definition?.newView ? 'New tab' : tab?.target.kind === 'thread' ? tab.title : (definition?.title ?? tab?.title ?? props.api.title)
    const [renaming, setRenaming] = useState(false)
    const [notice, setNotice] = useState('')
    const closePanel = (id: string, params: unknown): void => {
      registry.get(NewViewTabs.sourceId(params, id))?.beforeClose?.()
      // The semantic/native owner may already retire this occurrence. Retire
      // only the exact surviving presentation, without a second user-close
      // gesture and its automatic neighbor navigation.
      const panel = props.containerApi.getPanel(id)
      if (panel !== undefined) props.containerApi.removePanel(panel)
    }
    const close = (): void => closePanel(props.api.id, props.params)
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="dshx-root dshx:flex dshx:h-full dshx:items-center dshx:gap-2 dshx:px-2"
            data-preview={tab?.preview || undefined}
            data-workbench-tab-id={props.api.id}
            onPointerDownCapture={event => {
              // Explicit tab intent owns navigation, including inactive tabs. A
              // Dockview focus echo alone does not prove that the user selected it.
              const ElementClass = event.currentTarget.ownerDocument.defaultView?.Element
              const control = ElementClass !== undefined && event.target instanceof ElementClass && event.target.closest('button,input') !== null
              if (event.button === 0 && tab !== undefined && !control) {
                event.currentTarget.closest<HTMLElement>('[role="tab"]')?.focus({ preventScroll: true })
                channel.actions.activate(tab.id)
              }
            }}
            onDoubleClick={() => {
              if (tab !== undefined) channel.actions.keep(tab.id)
            }}
            onAuxClick={event => {
              if (event.button === 1) {
                event.preventDefault()
                close()
              }
            }}
          >
            {tab?.pinned && <PinIcon aria-label={channel.label?.('pinned') || 'Pinned'} size={12} />}
            {tab?.status && (
              <StatusDot
                aria-label={channel.label?.(tab.status) || tab.status}
                className={tab.status === 'running' ? 'dshx:animate-pulse dshx:bg-info' : tab.status === 'needsYou' ? 'dshx:bg-warning' : 'dshx:bg-primary'}
              />
            )}
            {renaming && tab?.kind === 'thread' ? (
              <InlineTitleEditor
                value={tab.title}
                label={channel.label?.('renameThread') || 'Edit title'}
                onCancel={() => setRenaming(false)}
                onCommit={async title => {
                  try {
                    await channel.actions.renameThread(tab.sessionId, title)
                    setRenaming(false)
                    setNotice('')
                  } catch {
                    setNotice(channel.label?.('renameFailed') || 'Could not rename the thread.')
                  }
                }}
              />
            ) : (
              <span className={cn('dshx:truncate dshx:text-xs', tab?.preview && 'dshx:italic')}>{title}</span>
            )}
            {notice && (
              <span role="status" className="dshx:sr-only">
                {notice}
              </span>
            )}
            {!tab?.pinned && (
              <button
                type="button"
                aria-label={channel.label?.('closeTab', title) || `Close ${title}`}
                className="dshx:flex dshx:size-5 dshx:items-center dshx:justify-center dshx:rounded dshx:hover:bg-accent"
                onPointerDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation()
                  close()
                }}
              >
                <XIcon size={12} />
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {tab &&
            (channel.renderTabMenu?.(tab.id, () => setRenaming(true), setNotice) ?? (
              <>
                <ContextMenuItem onSelect={() => channel.actions.keep(tab.id)}>Keep tab</ContextMenuItem>
                <ContextMenuItem onSelect={() => channel.actions.togglePin(tab.id)}>{tab.pinned ? 'Unpin tab' : 'Pin tab'}</ContextMenuItem>
                <ContextMenuItem onSelect={() => channel.actions.moveAside(tab.id)}>Move to side panel</ContextMenuItem>
                <ContextMenuItem onSelect={() => channel.actions.closeOthers(tab.id)}>Close other tabs</ContextMenuItem>
                <ContextMenuItem onSelect={() => channel.actions.closeToRight(tab.id)}>Close tabs to the right</ContextMenuItem>
              </>
            ))}
          {tab === undefined && <GroupCloseItems panel={props.api} closePanel={closePanel} />}
          <ContextMenuItem
            onSelect={() => {
              const panel = props.containerApi.getPanel(props.api.id)
              if (panel !== undefined) props.containerApi.addFloatingGroup(panel)
            }}
          >
            Float panel
          </ContextMenuItem>
          <ContextMenuItem disabled={!TabRows.canHide(props.api.group)} onSelect={() => TabRows.hide(props.containerApi, props.api.group)}>
            Hide tab row
          </ContextMenuItem>
          <ContextMenuItem onSelect={close}>Close panel</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
