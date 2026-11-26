import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { CheckIcon } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'

/**
 * `size="sm"` is the dense checkbox (council round 11 A5) for a table column (AI accounts' "Show model"): the same
 * 16px box and 44px touch area, a 12px tick at an absolute 1.5px stroke inset 2px, and no shadow, so a column of
 * checked boxes reads as small crisp marks. `default` keeps the 14px tick and the shadow. Since council round 12 A3 the
 * dense box fills at `control-on-dense`: oklch(0.38 0.008 65) in light, a step off the near-black ink so a column of
 * checked boxes stops reading as black squares (still 3:1 on every surface, the tick 4.5:1 on it); dark is unchanged.
 */
function Checkbox({ className, size = 'default', ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root> & { readonly size?: 'default' | 'sm' }) {
  const dense = size === 'sm'
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      data-size={size}
      className={cn(
        'dshx:peer dshx:size-4 dshx:shrink-0 dshx:rounded-sm dshx:border dshx:border-field-border dshx:transition-[background-color,border-color,box-shadow] dshx:duration-(--dshx-duration-fade) dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:data-[state=checked]:border-control-on dshx:data-[state=checked]:bg-control-on dshx:data-[state=checked]:text-control-on-foreground dshx:dark:bg-input/30 dshx:dark:aria-invalid:ring-destructive/40 dshx:dark:data-[state=checked]:bg-control-on',
        !dense && 'dshx:shadow-xs',
        dense && 'dshx:data-[state=checked]:border-control-on-dense dshx:data-[state=checked]:bg-control-on-dense',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="dshx:grid dshx:place-content-center dshx:text-current dshx:transition-none">
        {dense ? <CheckIcon size={12} strokeWidth={1.5} absoluteStrokeWidth /> : <CheckIcon className="dshx:size-3.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
