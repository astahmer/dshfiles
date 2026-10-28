import { useCallback, useSyncExternalStore } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import type { DockviewApi, IDockviewPanelProps } from 'dockview-react'
import { PanelTopIcon } from '@dshfiles/plugin-ui/icons'
import { SurfaceAction } from './surface-action.js'
import { TabRows } from './tab-row-visibility.js'

/** A content-only group keeps a local mouse/keyboard route back to its tab row. */
export const HiddenTabRowRestore = (props: Pick<IDockviewPanelProps, 'api' | 'containerApi'>): JSX.Element | null => {
  const subscribe = useCallback(
    (listener: () => void) => {
      const off = TabRows.subscribe(props.containerApi, listener)
      const group = props.api.onDidGroupChange(listener)
      return () => {
        off()
        group.dispose()
      }
    },
    [props.api, props.containerApi],
  )
  const snapshot = useCallback(
    () => `${TabRows.version(props.containerApi)}:${props.api.group.id}:${props.api.group.header.hidden}`,
    [props.api, props.containerApi],
  )
  useSyncExternalStore(subscribe, snapshot, snapshot)
  const group = props.api.group
  if (!group.header.hidden || group.panels.length !== 1) return null
  return (
    <div className="dshx-root dshx:pointer-events-none dshx:absolute dshx:top-1 dshx:right-1 dshx:z-20 dshx:opacity-0 dshx:transition-opacity dshx:group-hover:pointer-events-auto dshx:group-hover:opacity-100 dshx:focus-within:pointer-events-auto dshx:focus-within:opacity-100">
      <SurfaceAction
        label="Show tab row"
        icon={<PanelTopIcon aria-hidden size={14} />}
        iconOnly
        onPointerDown={event => event.stopPropagation()}
        onClick={() => TabRows.show(props.containerApi, props.api.group)}
      />
    </div>
  )
}

export interface TabRowMenuTarget {
  readonly group: IDockviewPanelProps['api']['group']
  readonly x: number
  readonly y: number
}

/** Blank native row space uses a controlled menu, without intercepting content menus. */
export const TabRowVoidMenu = (props: { readonly api: DockviewApi; readonly target: TabRowMenuTarget | null; readonly dismiss: () => void }): JSX.Element => {
  const subscribe = useCallback((listener: () => void) => TabRows.subscribe(props.api, listener), [props.api])
  const snapshot = useCallback(() => TabRows.version(props.api), [props.api])
  useSyncExternalStore(subscribe, snapshot, snapshot)
  const group = props.target?.group
  const open = group !== undefined && props.api.groups.includes(group)
  return (
    <DropdownMenu
      open={open}
      onOpenChange={shown => {
        if (!shown) props.dismiss()
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          tabIndex={-1}
          style={{ position: 'fixed', left: props.target?.x ?? 0, top: props.target?.y ?? 0, width: 0, height: 0, pointerEvents: 'none' }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0} onCloseAutoFocus={event => event.preventDefault()}>
        <DropdownMenuItem
          disabled={group === undefined || !TabRows.canHide(group)}
          onSelect={() => {
            if (group !== undefined) TabRows.hide(props.api, group)
            props.dismiss()
          }}
        >
          Hide tab row
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
