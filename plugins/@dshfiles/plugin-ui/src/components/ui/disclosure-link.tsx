import * as React from 'react'
import { Slot } from 'radix-ui'
import { cn } from '../../lib/utils.js'

export interface DisclosureLinkProps extends React.ComponentPropsWithoutRef<'button'> {
  /** Whether what it discloses is showing: sets `aria-expanded` and turns the chevron. Leave it out for a plain link. */
  readonly open?: boolean | undefined
  /** Render the child (an `<a>`, a Radix trigger) with the link's look instead of a `<button>`. */
  readonly asChild?: boolean | undefined
}

/**
 * The disclosure link (council round 15 A3; DESIGN.md › Components): text that opens more of the same place ("More font
 * settings") in the link token, 13/18 at 500, then a 12px chevron 4px after it, turned while `open`. No underline at
 * rest, one under the pointer; 44px tall on a coarse pointer. The look is the `dshx:disclosure-link` utility
 * (disclosure.css), so a core control styled from outside matches it. The kit sheet draws its focus ring.
 */
export const DisclosureLink = React.forwardRef<HTMLButtonElement, DisclosureLinkProps>(function DisclosureLink(
  { open, asChild = false, className, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      ref={ref}
      type={asChild ? type : (type ?? 'button')}
      aria-expanded={open}
      data-state={open === undefined ? undefined : open ? 'open' : 'closed'}
      data-slot="disclosure-link"
      className={cn('dshx:disclosure-link', className)}
      {...props}
    />
  )
})
