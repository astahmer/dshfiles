import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@dshfiles/plugin-ui/components/ui/sheet'
import type { ReactNode } from 'react'

/** Backlog settings over the panel, so the view, filters and open item stay where they were behind it. */
export const BacklogSettingsSheet = (props: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly children: ReactNode }) => (
  <Sheet open={props.open} onOpenChange={props.onOpenChange}>
    <SheetContent side="right" className="dshx-root dshx:w-full dshx:gap-0 dshx:overflow-y-auto dshx:sm:max-w-xl">
      <SheetHeader className="dshx:border-b dshx:border-border">
        <SheetTitle>Backlog settings</SheetTitle>
        <SheetDescription className="dshx:sr-only">Changes apply to the backlog view behind this panel.</SheetDescription>
      </SheetHeader>
      {props.children}
    </SheetContent>
  </Sheet>
)
