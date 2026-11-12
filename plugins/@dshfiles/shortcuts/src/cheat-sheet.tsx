import { Command, useRegistry, useSettings, useSubscribable, type Subscribable } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Kbd, KbdGroup, KeyHint } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useMemo, useSyncExternalStore } from 'react'
import { CheatSheetModel, type HostShortcutRow } from './cheat-sheet-model.js'
import { shortcutsSettings } from './settings.js'

/** Whether the sheet is open: presentation state, so it lives in the page and is not an agent tool. */
let open = false
const listeners = new Set<() => void>()
const setOpen = (next: boolean): void => {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

export const CheatSheetState = {
  open: () => setOpen(true),
  close: () => setOpen(false),
  toggle: () => setOpen(!open),
  get: (): boolean => open,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
} as const

const NO_HOST_ROWS: readonly HostShortcutRow[] = []

interface CheatSheetProps {
  readonly keys: Subscribable<ReadonlyMap<string, readonly string[]>>
  readonly host: Subscribable<readonly HostShortcutRow[]> | undefined
  /** Open the Host's rebinding editor; false when this Host has none. */
  readonly customize: () => boolean
}

/**
 * `?` / ⌘/: every bound key, grouped by where it works, generated from the one registry (dshx `Command`) plus the
 * Host's own chords. It also holds the one switch for single-key shortcuts, next to the keys it turns off.
 */
export const CheatSheet = (props: CheatSheetProps): JSX.Element | null => {
  const isOpen = useSyncExternalStore(CheatSheetState.subscribe, CheatSheetState.get, CheatSheetState.get)
  if (!isOpen) return null
  return <CheatSheetDialog {...props} />
}

const emptyHost: Subscribable<readonly HostShortcutRow[]> = {
  get: () => NO_HOST_ROWS,
  subscribe: () => () => {},
}

const CheatSheetDialog = (props: CheatSheetProps): JSX.Element => {
  const commands = useRegistry(Command)
  const keys = useSubscribable(props.keys)
  const host = useSubscribable(props.host ?? emptyHost)
  const settings = useSettings(shortcutsSettings)
  const singleKeys = settings.value?.singleKeys ?? true
  const sections = useMemo(() => CheatSheetModel.sections({ commands, keys, host, singleKeys }), [commands, keys, host, singleKeys])
  const switchId = useId()
  return (
    <Dialog open onOpenChange={next => (next ? CheatSheetState.open() : CheatSheetState.close())}>
      <DialogContent
        data-shortcut-cheat-sheet=""
        className="dshx-root dshx:@container dshx:flex dshx:max-h-[min(44rem,calc(100dvh-2rem))] dshx:w-[min(56rem,calc(100vw-2rem))] dshx:max-w-none! dshx:flex-col dshx:gap-4 dshx:overflow-hidden dshx:p-5 dshx:@max-pane-narrow:p-3"
      >
        <DialogHeader className="dshx:text-left">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single keys never fire while you type. Press ? or ⌘/ to open this again.</DialogDescription>
        </DialogHeader>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3 dshx:rounded-md dshx:border dshx:border-border dshx:px-3 dshx:py-2">
          <Label htmlFor={switchId} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:items-start dshx:gap-0.5">
            <span className="dshx:text-sm dshx:font-medium">Single-key shortcuts</span>
            <span className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">Keys without ⌘ or Ctrl, such as J, E and ?.</span>
          </Label>
          <div className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Close first: the Host editor is its own dialog, and two open at once would trap focus in neither.
                CheatSheetState.close()
                if (!props.customize()) CheatSheetState.open()
              }}
            >
              Customize keys
            </Button>
            <Switch
              id={switchId}
              aria-label="Single-key shortcuts"
              checked={singleKeys}
              disabled={!settings.writable}
              onCheckedChange={checked => {
                void settings.set('singleKeys', checked).catch(() => undefined)
              }}
            />
          </div>
        </div>
        <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
          <div className="dshx:columns-2 dshx:gap-6 dshx:@max-pane-compact:columns-1">
            {sections.map(section => (
              <section key={section.id} aria-labelledby={`${switchId}-${section.id}`} className="dshx:mb-4 dshx:break-inside-avoid">
                <h3 id={`${switchId}-${section.id}`} className="dshx:mb-1 dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">
                  {section.title}
                </h3>
                <ul className="dshx:flex dshx:flex-col">
                  {section.rows.map(row => (
                    <li
                      key={`${row.id}-${row.label}`}
                      data-shortcut-row={row.id}
                      className={cn(
                        'dshx:flex dshx:min-h-8 dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-b dshx:border-border dshx:py-1 dshx:last:border-b-0',
                      )}
                    >
                      <span className="dshx:min-w-0 dshx:truncate dshx:text-sm">{row.label}</span>
                      {row.presented === true ? (
                        <KbdGroup>
                          {row.keys.map(cap => (
                            <Kbd key={cap}>{cap}</Kbd>
                          ))}
                        </KbdGroup>
                      ) : (
                        <KeyHint keys={row.keys} max={3} />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
