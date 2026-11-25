import * as React from 'react'
import { cn } from '../../lib/utils.js'

/**
 * One field look (council round 3 A4): the 1px field boundary (`border-field-border`, 3:1 on every surface, council
 * round 6 A2), the page fill and the 8px radius, no shadow and no dark
 * fill, shared by Input, Textarea, InputGroup and the Select trigger so a form reads as one set of controls. Single-line
 * fields take the one control height, `--dshx-control-h` (council round 5 A1: 32px, 44px on a coarse pointer). A control
 * the kit does not draw (a Host select) takes the `dshx:select-look` utility instead (field-look.css).
 */
export const fieldLook = 'dshx:rounded-lg dshx:border dshx:border-field-border dshx:bg-background'

const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(function Input({ className, type, ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        fieldLook,
        'dshx:h-(--dshx-control-h) dshx:w-full dshx:min-w-0 dshx:px-2.5 dshx:py-1 dshx:text-base dshx:transition-[color,box-shadow] dshx:outline-none dshx:selection:bg-primary dshx:selection:text-primary-foreground dshx:file:inline-flex dshx:file:h-7 dshx:file:border-0 dshx:file:bg-transparent dshx:file:text-sm dshx:file:font-medium dshx:file:text-foreground dshx:placeholder:text-muted-foreground dshx:disabled:pointer-events-none dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:md:text-sm',
        'dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50',
        'dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
})

export { Input }
