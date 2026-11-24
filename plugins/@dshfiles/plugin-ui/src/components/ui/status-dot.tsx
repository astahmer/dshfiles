import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../../lib/utils.js'

const statusDotVariants = cva('dshx:shrink-0 dshx:rounded-full', {
  variants: {
    tone: {
      current: 'dshx:bg-current',
      success: 'dshx:bg-success',
      destructive: 'dshx:bg-destructive',
      warning: 'dshx:bg-warning',
      info: 'dshx:bg-info',
      muted: 'dshx:bg-muted-foreground/50',
    },
    /** DESIGN.md › Colour roles 4: green connected, amber limited, red down, a faint ring when off. */
    health: {
      ok: 'dshx:bg-health-ok',
      limited: 'dshx:bg-health-limited',
      down: 'dshx:bg-health-down',
      off: 'dshx:border dshx:border-health-off',
    },
    size: {
      sm: 'dshx:size-1.5',
      default: 'dshx:size-2',
    },
  },
  defaultVariants: { size: 'default' },
})

/** Whether a resource (account, host, MCP server, receiver) is up: one `HealthDot` beside its name. */
export type Health = NonNullable<VariantProps<typeof statusDotVariants>['health']>

/** The label beside a `HealthDot`: muted while healthy or off, in the dot's colour when it is not healthy. */
export const healthTextClass = {
  ok: 'dshx:text-muted-foreground',
  limited: 'dshx:text-health-limited',
  down: 'dshx:text-health-down',
  off: 'dshx:text-muted-foreground',
} as const satisfies Record<Health, string>

/**
 * A status dot. Pick a semantic `tone`, a `health`, or omit both and pass the color through `className` for computed
 * hues. It is decorative unless it gets an `aria-label`, which makes it an image with that name.
 */
export const StatusDot = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<'span'> & VariantProps<typeof statusDotVariants>>(function StatusDot(
  { className, tone, size, health, ...props },
  ref,
) {
  const labelled = props['aria-label'] !== undefined
  return (
    <span
      ref={ref}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      data-slot="status-dot"
      data-health={health ?? undefined}
      className={cn(statusDotVariants({ tone, size, health }), className)}
      {...props}
    />
  )
})

/** The one health mark of a resource that is up or down; pair it with a label in `healthTextClass[health]`. */
export const HealthDot = React.forwardRef<
  HTMLSpanElement,
  Omit<React.ComponentPropsWithoutRef<'span'>, 'children'> & { readonly health: Health; readonly size?: VariantProps<typeof statusDotVariants>['size'] }
>(function HealthDot(props, ref) {
  return <StatusDot ref={ref} {...props} />
})
