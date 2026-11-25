/**
 * The phone top bar's status control (round five C2), provided as `PhoneStatus.Button`: a 44 px icon button that opens
 * the status items as a sheet (the kit popover becomes a bottom sheet on the phone shell). It reads what the frame's
 * strip measured (`phone-status.ts`), so the button and the strip never disagree.
 */
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { GaugeIcon } from '@dshfiles/plugin-ui/icons'
import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { StatusSheetList } from './native/client/StatusStrip.tsx'
import { phoneStatus, PhoneStatusModel } from './phone-status.ts'

export const PhoneStatusButton = (): ReactNode => {
  const snapshot = useSyncExternalStore(phoneStatus.subscribe, phoneStatus.get, phoneStatus.get)
  const [open, setOpen] = useState(false)
  const useSessions = snapshot.useSessions
  if (!PhoneStatusModel.shown(snapshot) || useSessions === null) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="dshx-root dshx:relative dshx:inline-flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
          aria-label={PhoneStatusModel.label(snapshot.summary)}
          data-phone-status-button=""
        >
          <GaugeIcon aria-hidden="true" className="dshx:size-5" />
          {/* An item that needs the user (quota low, lost connection) puts a mark on the button too. */}
          {snapshot.actionable ? (
            <span aria-hidden="true" className="dshx:absolute dshx:top-2.5 dshx:right-2.5 dshx:size-2 dshx:rounded-full dshx:bg-destructive" />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="dshx-root dshx:w-80 dshx:p-3 dshx:text-sm" align="end" aria-label="Status">
        <StatusSheetList items={snapshot.items} useSessions={useSessions} />
      </PopoverContent>
    </Popover>
  )
}
