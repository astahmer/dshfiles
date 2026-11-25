import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'
import { Slot } from 'radix-ui'

/**
 * Press feedback (DESIGN.md › Motion: controls answer a press within 80ms): every variant washes darker on `:active`,
 * and under a coarse pointer, where there is no hover to show the target first, the button also gives a 3% press.
 * Only colour, shadow and that scale transition, so nothing moves the layout.
 */
const buttonVariants = cva(
  'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:gap-2 dshx:rounded-md dshx:text-sm dshx:font-medium dshx:whitespace-nowrap dshx:transition-[color,background-color,border-color,box-shadow,scale] dshx:duration-(--dshx-duration-hover) dshx:pointer-coarse:motion-safe:active:scale-[0.97] dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:pointer-events-none dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:dark:aria-invalid:ring-destructive/40 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default: 'dshx:bg-primary dshx:text-primary-foreground dshx:hover:bg-primary/90 dshx:active:bg-primary/80',
        destructive:
          'dshx:bg-destructive-solid dshx:text-white dshx:hover:bg-destructive-solid/90 dshx:active:bg-destructive-solid/80 dshx:focus-visible:ring-destructive/20 dshx:dark:focus-visible:ring-destructive/40',
        outline:
          'dshx:border dshx:bg-background dshx:shadow-xs dshx:hover:bg-accent dshx:hover:text-accent-foreground dshx:dark:border-input dshx:dark:bg-input/30 dshx:dark:hover:bg-input/50 dshx:active:bg-(--dsw-alias-interactive-bg-active) dshx:dark:active:bg-(--dsw-alias-interactive-bg-active)',
        secondary: 'dshx:bg-secondary dshx:text-secondary-foreground dshx:hover:bg-secondary/80 dshx:active:bg-secondary/70',
        ghost:
          'dshx:hover:bg-accent dshx:hover:text-accent-foreground dshx:dark:hover:bg-accent/50 dshx:active:bg-(--dsw-alias-interactive-bg-active) dshx:dark:active:bg-(--dsw-alias-interactive-bg-active)',
        link: 'dshx:text-primary dshx:underline-offset-4 dshx:hover:underline',
      },
      size: {
        default: 'dshx:h-8 dshx:px-3 dshx:py-1.5 dshx:has-[>svg]:px-2.5',
        xs: 'dshx:h-6 dshx:gap-1 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:has-[>svg]:px-1.5 dshx:[&_svg:not([class*=size-])]:size-3',
        sm: 'dshx:h-7 dshx:gap-1.5 dshx:rounded-md dshx:px-2.5 dshx:text-xs dshx:has-[>svg]:px-2 dshx:[&_svg:not([class*=size-])]:size-3.5',
        lg: 'dshx:h-9 dshx:rounded-md dshx:px-5 dshx:has-[>svg]:px-4',
        icon: 'dshx:size-8',
        'icon-xs': 'dshx:size-6 dshx:rounded-md dshx:[&_svg:not([class*=size-])]:size-3',
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
