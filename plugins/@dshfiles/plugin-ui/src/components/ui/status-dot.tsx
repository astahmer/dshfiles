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
    size: {
      sm: 'dshx:size-1.5',
      default: 'dshx:size-2',
    },
  },
  defaultVariants: { size: 'default' },
})

/**
 * A status dot. Pick a semantic `tone`, or omit it and pass the color through `className` for computed hues. It is
 * decorative unless it gets an `aria-label`, which makes it an image with that name.
 */
export const StatusDot = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<'span'> & VariantProps<typeof statusDotVariants>>(function StatusDot(
  { className, tone, size, ...props },
  ref,
) {
  const labelled = props['aria-label'] !== undefined
  return (
    <span
      ref={ref}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      data-slot="status-dot"
      className={cn(statusDotVariants({ tone, size }), className)}
      {...props}
    />
  )
})
