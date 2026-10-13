import * as React from 'react'
import { cn } from '../../lib/utils.js'

const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(function Input({ className, type, ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        'dshx:h-8 dshx:w-full dshx:min-w-0 dshx:rounded-md dshx:border dshx:border-input dshx:bg-transparent dshx:px-2.5 dshx:py-1 dshx:text-base dshx:shadow-xs dshx:transition-[color,box-shadow] dshx:outline-none dshx:selection:bg-primary dshx:selection:text-primary-foreground dshx:file:inline-flex dshx:file:h-7 dshx:file:border-0 dshx:file:bg-transparent dshx:file:text-sm dshx:file:font-medium dshx:file:text-foreground dshx:placeholder:text-muted-foreground dshx:disabled:pointer-events-none dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:md:text-sm dshx:dark:bg-input/30',
        'dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50',
        'dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
})

export { Input }
