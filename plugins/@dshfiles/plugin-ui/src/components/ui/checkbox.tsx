import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { CheckIcon, MinusIcon } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'dshx:peer dshx:group dshx:size-4 dshx:shrink-0 dshx:rounded-sm dshx:border dshx:border-input dshx:shadow-xs dshx:transition-shadow dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:data-[state=checked]:border-primary dshx:data-[state=checked]:bg-primary dshx:data-[state=checked]:text-primary-foreground dshx:data-[state=indeterminate]:border-primary dshx:data-[state=indeterminate]:bg-primary dshx:data-[state=indeterminate]:text-primary-foreground dshx:dark:bg-input/30 dshx:dark:aria-invalid:ring-destructive/40 dshx:dark:data-[state=checked]:bg-primary dshx:dark:data-[state=indeterminate]:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="dshx:grid dshx:place-content-center dshx:text-current dshx:transition-none">
        {/* `checked="indeterminate"` draws a dash, so a partial parent never reads as fully checked. */}
        <CheckIcon className="dshx:size-3.5 dshx:group-data-[state=indeterminate]:hidden" />
        <MinusIcon className="dshx:hidden dshx:size-3.5 dshx:group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
