import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'
import { fieldLook } from './input.js'
import { Slot } from 'radix-ui'

/**
 * Press feedback (DESIGN.md › Motion: controls answer a press within 80ms): every variant washes darker on `:active`,
 * and under a coarse pointer, where there is no hover to show the target first, the button also gives a 3% press.
 * Only colour, shadow and that scale transition, so nothing moves the layout.
 *
 * One control height and one radius (council round 5 A1): the default size is `--dshx-control-h` (32px, 44px on a
 * coarse pointer), the height of every field and the segmented root, and every size shares the fields' 8px radius.
 */
const buttonVariants = cva(
  'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:gap-2 dshx:rounded-lg dshx:text-sm dshx:font-medium dshx:whitespace-nowrap dshx:transition-[color,background-color,border-color,box-shadow,scale] dshx:duration-(--dshx-duration-hover) dshx:pointer-coarse:motion-safe:active:scale-[0.97] dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:pointer-events-none dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:dark:aria-invalid:ring-destructive/40 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default: 'dshx:bg-primary dshx:text-primary-foreground dshx:hover:bg-primary-hover dshx:active:bg-primary/80',
        destructive:
          'dshx:bg-destructive-solid dshx:text-white dshx:hover:bg-destructive-solid/90 dshx:active:bg-destructive-solid/80 dshx:focus-visible:ring-destructive/20 dshx:dark:focus-visible:ring-destructive/40',
        outline:
          'dshx:border dshx:bg-background dshx:shadow-xs dshx:hover:bg-accent dshx:hover:text-accent-foreground dshx:dark:border-input dshx:dark:bg-input/30 dshx:dark:hover:bg-input/50 dshx:active:bg-(--dsw-alias-interactive-bg-active) dshx:dark:active:bg-(--dsw-alias-interactive-bg-active)',
        secondary: 'dshx:bg-secondary dshx:text-secondary-foreground dshx:hover:bg-secondary/80 dshx:active:bg-secondary/70',
        ghost:
          'dshx:hover:bg-accent dshx:hover:text-accent-foreground dshx:dark:hover:bg-accent/50 dshx:active:bg-(--dsw-alias-interactive-bg-active) dshx:dark:active:bg-(--dsw-alias-interactive-bg-active)',
        link: 'dshx:text-primary dshx:underline-offset-4 dshx:hover:underline',
        /*
         * Row-level attention verbs (Review, Answer, Rate…): Needs-you text on its own 12% tint, no border, 18% on hover
         * and 24% pressed. The ink fill stays for the one page primary (DESIGN.md › Components).
         */
        attention:
          'dshx:bg-status-needs-you/12 dshx:text-attention-foreground dshx:hover:bg-status-needs-you/18 dshx:active:bg-status-needs-you/24',
        /** The same tint rung in the danger pair, for a failed row's recovery verb (Retry, Open). */
        'danger-tint': 'dshx:bg-status-failed/12 dshx:text-danger-tint-foreground dshx:hover:bg-status-failed/18 dshx:active:bg-status-failed/24',
        /*
         * A popover trigger that shows a value, not an action (council round 7 A4: a date range, a purpose, a project
         * picker): the field look of `SelectTrigger` (field boundary, page fill, 8px), the value in ink at the body weight
         * and its chevron in secondary ink, so a filter row never mixes the field edge with the quiet button edge. No
         * hover fill, as a select trigger has none; the kit focus ring and the press wash stay. Outside `Button`, read it
         * through `cn(buttonVariants({ variant: 'field' }))` so the body weight replaces the base 500.
         */
        field: cn(
          fieldLook,
          'dshx:justify-between dshx:font-normal dshx:text-foreground dshx:active:bg-(--dsw-alias-interactive-bg-active) dshx:[&_svg:not([class*=text-])]:text-muted-foreground',
        ),
      },
      size: {
        default: 'dshx:h-(--dshx-control-h) dshx:px-3 dshx:py-1.5 dshx:has-[>svg]:px-2.5',
        xs: 'dshx:h-6 dshx:gap-1 dshx:px-2 dshx:text-xs dshx:has-[>svg]:px-1.5 dshx:[&_svg:not([class*=size-])]:size-3',
        sm: 'dshx:h-7 dshx:gap-1.5 dshx:px-2.5 dshx:text-xs dshx:has-[>svg]:px-2 dshx:[&_svg:not([class*=size-])]:size-3.5',
        lg: 'dshx:h-9 dshx:px-5 dshx:has-[>svg]:px-4',
        icon: 'dshx:size-8',
        'icon-xs': 'dshx:size-6 dshx:[&_svg:not([class*=size-])]:size-3',
        'icon-sm': 'dshx:size-7',
        'icon-lg': 'dshx:size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = React.ComponentPropsWithoutRef<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

// forwardRef: React 18 drops `ref` on function components, and Radix triggers (`asChild`) need it.
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'default', asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button'

  return <Comp ref={ref} data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size, className }))} {...props} />
})

export { Button, buttonVariants }
