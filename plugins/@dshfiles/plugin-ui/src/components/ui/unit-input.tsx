import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { InputGroup, InputGroupAddon, InputGroupInput } from './input-group.js'

/**
 * A number with its unit (council round 3 A4): one field in the kit field look with the unit as a muted inner suffix
 * (`14 px`, `120 ms`), never a number glued to a second control for the unit. The browser's spin buttons are hidden so
 * the suffix sits flush; arrow keys still step the value. A screen reader hears the unit with the field.
 * `className` sizes the field (`dshx:w-24`); every other prop goes to the `<input type="number">`.
 */
export interface UnitInputProps extends Omit<React.ComponentPropsWithoutRef<'input'>, 'type'> {
  /** The unit shown inside the field's trailing edge: `px`, `ms`, `%`, `tokens`. */
  readonly unit: string
}

const UnitInput = React.forwardRef<HTMLInputElement, UnitInputProps>(function UnitInput({ unit, className, disabled, ...props }, ref) {
  const unitId = React.useId()
  const describedBy = [props['aria-describedby'], unitId].filter(Boolean).join(' ')
  return (
    <InputGroup data-unit-input="" data-disabled={disabled === true ? 'true' : undefined} className={cn('dshx:w-28', className)}>
      <InputGroupInput
        ref={ref}
        type="number"
        inputMode="decimal"
        disabled={disabled}
        {...props}
        aria-describedby={describedBy}
        className="dshx:tabular-nums dshx:[appearance:textfield] dshx:[&::-webkit-inner-spin-button]:appearance-none dshx:[&::-webkit-outer-spin-button]:appearance-none"
      />
      <InputGroupAddon align="inline-end" id={unitId} className="dshx:font-normal dshx:tabular-nums">
        {unit}
      </InputGroupAddon>
    </InputGroup>
  )
})

export { UnitInput }
