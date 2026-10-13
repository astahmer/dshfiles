import * as React from 'react'
import { cn } from '../../lib/utils.js'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<'textarea'>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        'dshx:flex dshx:field-sizing-content dshx:min-h-16 dshx:w-full dshx:rounded-md dshx:border dshx:border-input dshx:bg-transparent dshx:px-3 dshx:py-2 dshx:text-base dshx:shadow-xs dshx:transition-[color,box-shadow] dshx:outline-none dshx:placeholder:text-muted-foreground dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:md:text-sm dshx:dark:bg-input/30 dshx:dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
})

export { Textarea }
