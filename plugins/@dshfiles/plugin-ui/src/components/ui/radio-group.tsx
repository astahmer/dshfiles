import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { CircleIcon } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn('dshx:grid dshx:gap-3', className)} {...props} />
}

function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'dshx:aspect-square dshx:size-4 dshx:shrink-0 dshx:rounded-full dshx:border dshx:border-input dshx:text-primary dshx:shadow-xs dshx:transition-[color,box-shadow] dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:dark:bg-input/30 dshx:dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator data-slot="radio-group-indicator" className="dshx:relative dshx:flex dshx:items-center dshx:justify-center">
        <CircleIcon className="dshx:absolute dshx:top-1/2 dshx:left-1/2 dshx:size-2 dshx:-translate-x-1/2 dshx:-translate-y-1/2 dshx:fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
