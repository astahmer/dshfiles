import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Label as LabelPrimitive } from "radix-ui"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:leading-none dshx:font-medium dshx:select-none dshx:group-data-[disabled=true]:pointer-events-none dshx:group-data-[disabled=true]:opacity-50 dshx:peer-disabled:cursor-not-allowed dshx:peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
