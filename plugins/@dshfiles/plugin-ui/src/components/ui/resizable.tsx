"use client"

import { cn } from "../../lib/utils.js"
import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "dshx:flex dshx:h-full dshx:w-full dshx:aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "dshx:relative dshx:flex dshx:w-px dshx:items-center dshx:justify-center dshx:bg-border dshx:after:absolute dshx:after:inset-y-0 dshx:after:left-1/2 dshx:after:w-1 dshx:after:-translate-x-1/2 dshx:focus-visible:ring-1 dshx:focus-visible:ring-ring dshx:focus-visible:ring-offset-1 dshx:focus-visible:outline-hidden dshx:aria-[orientation=horizontal]:h-px dshx:aria-[orientation=horizontal]:w-full dshx:aria-[orientation=horizontal]:after:left-0 dshx:aria-[orientation=horizontal]:after:h-1 dshx:aria-[orientation=horizontal]:after:w-full dshx:aria-[orientation=horizontal]:after:translate-x-0 dshx:aria-[orientation=horizontal]:after:-translate-y-1/2 dshx:[&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="dshx:z-10 dshx:flex dshx:h-4 dshx:w-3 dshx:items-center dshx:justify-center dshx:rounded-xs dshx:border dshx:bg-border">
          <GripVerticalIcon className="dshx:size-2.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
