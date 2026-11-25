import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { CheckIcon } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'dshx:peer dshx:size-4 dshx:shrink-0 dshx:rounded-sm dshx:border dshx:border-field-border dshx:shadow-xs dshx:transition-[background-color,border-color,box-shadow] dshx:duration-(--dshx-duration-fade) dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:data-[state=checked]:border-control-on dshx:data-[state=checked]:bg-control-on dshx:data-[state=checked]:text-primary-foreground dshx:dark:bg-input/30 dshx:dark:aria-invalid:ring-destructive/40 dshx:dark:data-[state=checked]:bg-control-on',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="dshx:grid dshx:place-content-center dshx:text-current dshx:transition-none">
        <CheckIcon className="dshx:size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
