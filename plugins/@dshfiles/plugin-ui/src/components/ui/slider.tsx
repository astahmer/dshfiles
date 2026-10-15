'use client'

import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { Slider as SliderPrimitive } from 'radix-ui'

function Slider({ className, min = 0, max = 100, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const { value, defaultValue } = props
  const _values = React.useMemo(() => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]), [value, defaultValue, min, max])

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      min={min}
      max={max}
      className={cn(
        'dshx:relative dshx:flex dshx:w-full dshx:touch-none dshx:items-center dshx:select-none dshx:data-[disabled]:opacity-50 dshx:data-[orientation=vertical]:h-full dshx:data-[orientation=vertical]:min-h-44 dshx:data-[orientation=vertical]:w-auto dshx:data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          'dshx:relative dshx:grow dshx:overflow-hidden dshx:rounded-full dshx:bg-muted dshx:data-[orientation=horizontal]:h-1.5 dshx:data-[orientation=horizontal]:w-full dshx:data-[orientation=vertical]:h-full dshx:data-[orientation=vertical]:w-1.5',
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn('dshx:absolute dshx:bg-primary dshx:data-[orientation=horizontal]:h-full dshx:data-[orientation=vertical]:w-full')}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="dshx:block dshx:size-4 dshx:shrink-0 dshx:rounded-full dshx:border dshx:border-primary dshx:bg-white dshx:shadow-sm dshx:ring-ring/50 dshx:transition-[color,box-shadow] dshx:hover:ring-4 dshx:focus-visible:ring-4 dshx:focus-visible:outline-hidden dshx:disabled:pointer-events-none dshx:disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
