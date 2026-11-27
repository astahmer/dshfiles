import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { useState, useSyncExternalStore } from 'react'
import { InlineTitleEditor } from '@dshfiles/plugin-ui/components/ui/inline-title-editor'
import { ProjectMark } from '@dshfiles/plugin-ui/components/ui/project-mark'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'
import { SidebarFolderTargets } from './shell-merge.js'
import { PinIcon, PlusIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { DEFAULT_CLOSE_BUTTON_POSITION, TabProjectMark, workbenchTabs } from './tabs.js'
import { withoutPluginPrefix, type WorkbenchPanelRegistry } from './registry.js'
import { SurfaceAction } from './surface-action.js'
import { NewViewTabs } from './new-view.js'
import { closeWorkbenchPanel, type WorkbenchPanelIdentity } from './panel-close.js'
import { TabRows } from './tab-row-visibility.js'
import { TabComposeGlyph, TabDestinationGlyph, TabIdleGlyph, TabStatusGlyph } from './tab-status.js'

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
  readonly closePanel: (panel: WorkbenchPanelIdentity) => void
}): JSX.Element => {
  const panels = [...props.panel.group.panels]
  const position = panels.findIndex(panel => panel.id === props.panel.id)
  const closeExcept = (keep: (index: number) => boolean): void => {
    for (const [index, panel] of panels.entries()) if (!keep(index)) props.closePanel({ id: panel.id, params: panel.params })
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
    const closeButtonPosition = snapshot.closeButtonPosition ?? DEFAULT_CLOSE_BUTTON_POSITION
    // A page title never carries its plugin's name, including a native panel's own dockview title ("Plugin Manager: Plugins").
    const title =
      definition?.newView === true ? 'New tab' : tab?.target.kind === 'thread' ? tab.title : withoutPluginPrefix(definition?.title ?? tab?.title ?? props.api.title ?? '')
    const project = tab?.kind === 'thread' && tab.workspaceId !== undefined ? snapshot.projectNames?.[tab.workspaceId] : undefined
    const projectChip = tab?.kind === 'thread' && tab.workspaceId !== undefined ? snapshot.projectChips?.[tab.workspaceId] : undefined
    const [renaming, setRenaming] = useState(false)
    const [notice, setNotice] = useState('')
    const closePanel = (panel: WorkbenchPanelIdentity): void => {
      closeWorkbenchPanel({ api: props.containerApi, registry, panel })
    }
    const close = (): void => closePanel({ id: props.api.id, params: props.params })
    const closeButton = !tab?.pinned ? (
      <button
        type="button"
        aria-label={channel.label?.('closeTab', title) || `Close ${title}`}
        data-workbench-tab-close=""
        className="dshx:relative dshx:flex dshx:size-5 dshx:flex-none dshx:items-center dshx:justify-center dshx:rounded dshx:hover:bg-accent dshx:max-sm:after:absolute dshx:max-sm:after:-inset-3 dshx:max-sm:after:content-['']"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation()
          close()
        }}
      >
        <XIcon size={12} />
      </button>
    ) : null
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            // 12px in on every tab (round five T5): dockview's own side padding is zeroed in dockview-theme.css. The root
            // inherits the `.dv-tab` ink (council round 18 B2.1): `.dshx-root` alone resets it to the primary label, which
            // drew every kept inactive tab in ink.
            className="dshx-root dshx:flex dshx:h-full dshx:items-center dshx:gap-2 dshx:pr-2 dshx:pl-3 dshx:text-inherit"
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
            {tab?.kind === 'thread' ? <span className="dshx:flex dshx:size-4 dshx:flex-none dshx:items-center dshx:justify-center" data-tab-status-slot="">{tab.status === null ? (project === undefined ? <TabComposeGlyph activeClassName="dshx:in-[.dv-active-tab]:text-nav-tone" /> : <TabIdleGlyph />) : <TabStatusGlyph status={tab.status} label={channel.label?.(tab.status)} className="dshx:transition-opacity dshx:duration-(--dshx-duration-fade) dshx:starting:opacity-0" />}</span> : tab?.status && <TabStatusGlyph status={tab.status} label={channel.label?.(tab.status)} />}
            {closeButtonPosition === 'left' ? closeButton : null}
            {tab?.kind === 'panel' && tab.destination !== undefined ? (
              // A page names its destination with the rail glyph; the tab on screen takes its nav tone (round five B4).
              <TabDestinationGlyph destination={tab.destination} panelId={tab.panelId} activeClassName="dshx:in-[.dv-active-tab]:bg-nav-tile dshx:in-[.dv-active-tab]:text-nav-tone" />
            ) : null}
            {project === undefined ? null : (
              // The tile names the project: the tab has no tooltip, and the title beside it is the thread's.
              <ProjectMark name={project} size="dense" decorative={false} data-workbench-tab-project="" {...TabProjectMark.paint(projectChip)} />
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
              // Every tab not on screen takes the strip's one secondary ink, preview or kept (council round 18 B2.1); a long
              // title ends in an ellipsis instead of taking the strip. The tab on screen (dockview's active tab) is ink at
              // 500 even while it is a preview (round five B5).
              <span className="dshx:max-w-56 dshx:truncate dshx:text-xs dshx:in-[.dv-active-tab]:font-medium dshx:in-[.dv-active-tab]:text-foreground">
                {title}
              </span>
            )}
            {notice && (
              <span role="status" className="dshx:sr-only">
                {notice}
              </span>
            )}
            {closeButtonPosition === 'right' ? closeButton : null}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {/* Tab verbs first. One close verb, "Close tab": the provider's menu carries its own, the rest get it here. */}
          {tab &&
            (channel.renderTabMenu?.(tab.id, () => setRenaming(true), setNotice) ?? (
              <>
                <ContextMenuItem onSelect={() => channel.actions.keep(tab.id)}>Keep tab</ContextMenuItem>
                <ContextMenuItem onSelect={() => channel.actions.togglePin(tab.id)}>{tab.pinned ? 'Unpin tab' : 'Pin tab'}</ContextMenuItem>
                <ContextMenuItem onSelect={() => channel.actions.moveAside(tab.id)}>Move to side panel</ContextMenuItem>
                <ContextMenuItem onSelect={close}>Close tab</ContextMenuItem>
                <ContextMenuItem onSelect={() => channel.actions.closeOthers(tab.id)}>Close other tabs</ContextMenuItem>
                <ContextMenuItem onSelect={() => channel.actions.closeToRight(tab.id)}>Close tabs to the right</ContextMenuItem>
              </>
            ))}
          {tab === undefined && (
            <>
              <ContextMenuItem onSelect={close}>Close tab</ContextMenuItem>
              <GroupCloseItems panel={props.api} closePanel={closePanel} />
            </>
          )}
          {/* Add to sidebar ▸ ‹folder› (b:952m): a reusable view or page, never a thread tab or a chooser. */}
          {(() => {
            const sidebar = SidebarFolderTargets.get()
            if (sidebar === undefined || definition === undefined || tab !== undefined || definition.newView === true || definition.hiddenFromAdd === true)
              return null
            const folders = sidebar.folders()
            if (folders.length === 0) return null
            return (
              <ContextMenuSub>
                <ContextMenuSubTrigger>Add to sidebar</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {folders.map(folder => (
                    <ContextMenuItem key={folder.id} onSelect={() => sidebar.add(definition.mainPanelId ?? definition.id, folder.id)}>
                      {folder.title}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )
          })()}
          {/* Docking verbs act on the pane, not on the tab's content: one submenu keeps them out of the tab verbs. */}
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>Layout</ContextMenuSubTrigger>
            <ContextMenuSubContent>
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
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
