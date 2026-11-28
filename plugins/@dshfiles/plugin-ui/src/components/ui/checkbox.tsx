import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { CheckIcon, MinusIcon } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'

/**
 * `size="sm"` is the dense checkbox (council round 11 A5) for a table column (AI accounts' "Show model"): the same
 * 16px box and 44px touch area, a 12px tick at an absolute 1.5px stroke inset 2px, and no shadow, so a column of
 * checked boxes reads as small crisp marks. `default` keeps the 14px tick and the shadow. The dense box fills at
 * `control-on-dense`: oklch(0.50 0.01 65) in light since council round 13 A1 (was 0.38), well off the near-black ink so
 * a column of checked boxes stops reading as dark squares, with a white tick (still 3:1 on every surface, the tick
 * 4.5:1 on it). In dark it is oklch(0.68 0.008 65) under the dark tick since council round 14 A3 (was the 0.82 on state).
 * `checked="indeterminate"` fills the same way and draws a dash, so a partial parent never reads as fully checked.
 */
function Checkbox({ className, size = 'default', ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root> & { readonly size?: 'default' | 'sm' }) {
  const dense = size === 'sm'
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      data-size={size}
      className={cn(
        'dshx:peer dshx:group dshx:size-4 dshx:shrink-0 dshx:rounded-sm dshx:border dshx:border-field-border dshx:transition-[background-color,border-color,box-shadow] dshx:duration-(--dshx-duration-fade) dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:data-[state=checked]:border-control-on dshx:data-[state=checked]:bg-control-on dshx:data-[state=checked]:text-control-on-foreground dshx:data-[state=indeterminate]:border-control-on dshx:data-[state=indeterminate]:bg-control-on dshx:data-[state=indeterminate]:text-control-on-foreground dshx:dark:bg-input/30 dshx:dark:aria-invalid:ring-destructive/40 dshx:dark:data-[state=checked]:bg-control-on dshx:dark:data-[state=indeterminate]:bg-control-on',
        !dense && 'dshx:shadow-xs',
        dense &&
          'dshx:data-[state=checked]:border-control-on-dense dshx:data-[state=checked]:bg-control-on-dense dshx:dark:data-[state=checked]:bg-control-on-dense dshx:data-[state=indeterminate]:border-control-on-dense dshx:data-[state=indeterminate]:bg-control-on-dense dshx:dark:data-[state=indeterminate]:bg-control-on-dense',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="dshx:grid dshx:place-content-center dshx:text-current dshx:transition-none">
        {dense ? (
          <>
            <CheckIcon size={12} strokeWidth={1.5} absoluteStrokeWidth className="dshx:group-data-[state=indeterminate]:hidden" />
            <MinusIcon size={12} strokeWidth={1.5} absoluteStrokeWidth className="dshx:hidden dshx:group-data-[state=indeterminate]:block" />
          </>
        ) : (
          <>
            <CheckIcon className="dshx:size-3.5 dshx:group-data-[state=indeterminate]:hidden" />
            <MinusIcon className="dshx:hidden dshx:size-3.5 dshx:group-data-[state=indeterminate]:block" />
          </>
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
