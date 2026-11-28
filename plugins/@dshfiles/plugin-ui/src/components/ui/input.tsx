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

/**
 * The quiet trigger (council round 10 A1): a control that opens a list or a popover and shows a value (the Select and
 * Combobox triggers, `Button variant="field"`) is a filled chip, `bg-trigger-fill` (light oklch 0.955, dark 0.235),
 * with a quiet 1px hairline at rest (`border-border`, the divider step `--dsw-alias-border-l2`; council round 11 A2, so
 * the chip never vanishes into its surface), and a filter row reads as calm chips beside the one edged text field. The 3:1
 * `border-field-border` edge appears on hover and while the list is open; on focus each control's edge takes the accent
 * (`focus-visible:border-ring`) under the kit's 2px accent outline. The edge is always there in the box model, so nothing moves. Text-entry fields keep `fieldLook`.
 */
export const triggerLook =
  'dshx:rounded-lg dshx:border dshx:border-border dshx:bg-trigger-fill dshx:not-disabled:hover:border-field-border dshx:data-[state=open]:border-field-border dshx:aria-expanded:border-field-border'

/**
 * A typeable combobox at rest (council round 11 A4): a text field that also opens a list (Review's "Compare against",
 * a branch or revision you may type) sits beside quiet triggers, so at rest it takes the trigger look, the fill and the
 * 1px hairline; it takes the field look, the page fill and the 3:1 `border-field-border` edge, while it has focus (so
 * while you type), while its list is open and on hover. Focus keeps the field's accent edge and ring on top. Use it as
 * `Input rest="trigger"`, or put the class string on a wrapper that holds the input (an `InputGroup`): `focus-within`
 * reaches the wrapper too. The box never changes size.
 */
/**
 * The quiet secondary (council round 18 A3): one look for every action beside a search field (a Modified filter, a View
 * or Filter menu, a Filters sheet, a toolbar ⋯). It is the quiet trigger's chip (the trigger fill and the 1px hairline,
 * the 3:1 field edge on hover and while open), with the label and glyph in secondary ink at 500, ink on hover and while
 * open. A pressed toggle (`aria-pressed`, which Radix Toggle sets too) takes the selection wash, the field edge and ink,
 * so on reads apart from off without colour alone. Header actions stay `outline`; a control that shows a value stays
 * `field`. Use it as `Button variant="quiet"` or `Toggle variant="quiet"`; outside them, read
 * `cn(buttonVariants({ variant: 'quiet' }))`.
 */
export const quietLook = `${triggerLook} dshx:text-muted-foreground dshx:hover:bg-trigger-fill dshx:hover:text-foreground dshx:aria-expanded:text-foreground dshx:data-[state=open]:text-foreground dshx:aria-pressed:border-field-border dshx:aria-pressed:bg-selected-wash dshx:aria-pressed:text-foreground`

export const typeableTriggerLook =
  'dshx:rounded-lg dshx:border dshx:border-border dshx:bg-trigger-fill dshx:not-disabled:hover:border-field-border dshx:aria-expanded:border-field-border dshx:focus-within:border-field-border dshx:focus-within:bg-background'

export interface InputProps extends React.ComponentPropsWithoutRef<'input'> {
  /**
   * The look at rest: `field` (default) is the edged text field; `trigger` is `typeableTriggerLook`, for a typeable
   * combobox that sits beside quiet triggers.
   */
  readonly rest?: 'field' | 'trigger'
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, type, rest = 'field', ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      data-rest={rest === 'trigger' ? 'trigger' : undefined}
      className={cn(
        rest === 'trigger' ? typeableTriggerLook : fieldLook,
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
