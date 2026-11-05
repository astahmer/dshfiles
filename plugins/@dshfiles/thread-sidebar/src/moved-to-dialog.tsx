import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { useSyncExternalStore } from 'react'
import { DESTINATIONS, KNOWN_SECTIONS, type DestinationId, type DestinationPanel } from './destinations.js'
import { FORMER_NAVIGATION } from './moved-to.generated.js'

export interface MovedEntry {
  /** What the left-nav entry was called. */
  readonly entry: string
  /** "Observe › Usage". */
  readonly location: string
  readonly destination: DestinationId
  readonly panelId: string
  /** False when this profile does not register the page. */
  readonly available: boolean
}

const destinationLabel = (id: DestinationId): string => DESTINATIONS.find(destination => destination.id === id)?.label ?? id

/**
 * One row per re-homed page, under the name users knew longest. The migration map's list of former entries
 * (`FORMER_NAVIGATION`) is what the sections must cover; the destinations test pins that.
 */
const formerEntries = new Set(FORMER_NAVIGATION.map(former => former.entry))

/** A section that absorbed several former pages (Usage took Quota history and forecast) lists a row for each. */
const entries = (panels: readonly DestinationPanel[]): readonly MovedEntry[] =>
  KNOWN_SECTIONS.flatMap(section => {
    const named = (section.formerLabels ?? []).filter((label, index) => index === 0 || formerEntries.has(label))
    return named.map(entry => ({
      entry,
      location: `${destinationLabel(section.destination)} › ${section.label}`,
      destination: section.destination,
      panelId: section.panelId,
      available: panels.some(panel => panel.id === section.panelId),
    }))
  }).sort((left, right) => left.entry.localeCompare(right.entry))

let open = false
const listeners = new Set<() => void>()
const setOpen = (next: boolean): void => {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** "Where did a page go?": one row per former left-nav entry, with an Open button when the page is installed. */
export const MovedToDialog = (props: { readonly panels: readonly DestinationPanel[]; readonly openEntry: (entry: MovedEntry) => void }): JSX.Element => {
  const isOpen = useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
  const rows = entries(props.panels)
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="dshx:max-h-[min(640px,calc(100dvh-48px))] dshx:grid-rows-[auto_minmax(0,1fr)] dshx:overflow-hidden dshx:sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Where did a page go?</DialogTitle>
          <DialogDescription>The sidebar pages now live under the rail destinations. Open one, or find it in the palette by its old name.</DialogDescription>
        </DialogHeader>
        <div className="dshx:-mx-2 dshx:min-h-0 dshx:overflow-y-auto" data-moved-to="">
          <table className="dshx:w-full dshx:text-sm">
            <thead className="dshx:sr-only">
              <tr>
                <th>Before</th>
                <th>Now</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.entry} className="dshx:border-b dshx:border-border/60 dshx:last:border-0">
                  <td className="dshx:px-2 dshx:py-1.5 dshx:text-muted-foreground">{row.entry}</td>
                  <td className="dshx:px-2 dshx:py-1.5">{row.location}</td>
                  <td className="dshx:px-2 dshx:py-1 dshx:text-right">
                    {row.available ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Open ${row.entry} in ${row.location}`}
                        onClick={() => {
                          setOpen(false)
                          props.openEntry(row)
                        }}
                      >
                        Open
                      </Button>
                    ) : (
                      <span className="dshx:text-xs dshx:text-muted-foreground">Not installed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export class MovedTo {
  static readonly entries = entries
  static readonly open = (): void => setOpen(true)
  static readonly close = (): void => setOpen(false)
}
