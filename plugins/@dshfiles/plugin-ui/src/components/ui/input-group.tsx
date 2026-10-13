'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

import { Button } from './button.js'
import { Input } from './input.js'
import { Textarea } from './textarea.js'

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        'dshx:group/input-group dshx:relative dshx:flex dshx:w-full dshx:items-center dshx:rounded-md dshx:border dshx:border-input dshx:shadow-xs dshx:transition-[color,box-shadow] dshx:outline-none dshx:dark:bg-input/30',
        'dshx:h-8 dshx:min-w-0 dshx:has-[>textarea]:h-auto',

        // Variants based on alignment.
        'dshx:has-[>[data-align=inline-start]]:[&>input]:pl-2',
        'dshx:has-[>[data-align=inline-end]]:[&>input]:pr-2',
        'dshx:has-[>[data-align=block-start]]:h-auto dshx:has-[>[data-align=block-start]]:flex-col dshx:has-[>[data-align=block-start]]:[&>input]:pb-3',
        'dshx:has-[>[data-align=block-end]]:h-auto dshx:has-[>[data-align=block-end]]:flex-col dshx:has-[>[data-align=block-end]]:[&>input]:pt-3',

        // Focus state.
        'dshx:has-[[data-slot=input-group-control]:focus-visible]:border-ring dshx:has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] dshx:has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50',

        // Error state.
        'dshx:has-[[data-slot][aria-invalid=true]]:border-destructive dshx:has-[[data-slot][aria-invalid=true]]:ring-destructive/20 dshx:dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40',

        className,
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  'dshx:flex dshx:h-auto dshx:cursor-text dshx:items-center dshx:justify-center dshx:gap-2 dshx:py-1.5 dshx:text-sm dshx:font-medium dshx:text-muted-foreground dshx:select-none dshx:group-data-[disabled=true]/input-group:opacity-50 dshx:[&>kbd]:rounded-[calc(var(--radius)-5px)] dshx:[&>svg:not([class*=size-])]:size-4',
  {
    variants: {
      align: {
        'inline-start': 'dshx:order-first dshx:pl-3 dshx:has-[>button]:ml-[-0.45rem] dshx:has-[>kbd]:ml-[-0.35rem]',
        'inline-end': 'dshx:order-last dshx:pr-3 dshx:has-[>button]:mr-[-0.45rem] dshx:has-[>kbd]:mr-[-0.35rem]',
        'block-start': 'dshx:order-first dshx:w-full dshx:justify-start dshx:px-3 dshx:pt-3 dshx:group-has-[>input]/input-group:pt-2.5 dshx:[.border-b]:pb-3',
        'block-end': 'dshx:order-last dshx:w-full dshx:justify-start dshx:px-3 dshx:pb-3 dshx:group-has-[>input]/input-group:pb-2.5 dshx:[.border-t]:pt-3',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
)

function InputGroupAddon({ className, align = 'inline-start', ...props }: React.ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={e => {
        if ((e.target as HTMLElement).closest('button')) {
          return
        }
        e.currentTarget.parentElement?.querySelector('input')?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva('dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:shadow-none', {
  variants: {
    size: {
      xs: 'dshx:h-6 dshx:gap-1 dshx:rounded-[calc(var(--radius)-5px)] dshx:px-2 dshx:has-[>svg]:px-2 dshx:[&>svg:not([class*=size-])]:size-3.5',
      sm: 'dshx:h-7 dshx:gap-1.5 dshx:rounded-md dshx:px-2.5 dshx:has-[>svg]:px-2.5',
      'icon-xs': 'dshx:size-6 dshx:rounded-[calc(var(--radius)-5px)] dshx:p-0 dshx:has-[>svg]:p-0',
      'icon-sm': 'dshx:size-8 dshx:p-0 dshx:has-[>svg]:p-0',
    },
  },
  defaultVariants: {
    size: 'xs',
  },
})

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size'> & VariantProps<typeof inputGroupButtonVariants>) {
  return <Button type={type} data-size={size} variant={variant} className={cn(inputGroupButtonVariants({ size }), className)} {...props} />
}

function InputGroupText({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground dshx:[&_svg]:pointer-events-none dshx:[&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  )
}

const InputGroupInput = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(function InputGroupInput({ className, ...props }, ref) {
  return (
    <Input
      ref={ref}
      data-slot="input-group-control"
      className={cn(
        'dshx:flex-1 dshx:rounded-none dshx:border-0 dshx:bg-transparent dshx:shadow-none dshx:focus-visible:ring-0 dshx:dark:bg-transparent',
        className,
      )}
      {...props}
    />
  )
})

function InputGroupTextarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        'dshx:flex-1 dshx:resize-none dshx:rounded-none dshx:border-0 dshx:bg-transparent dshx:py-3 dshx:shadow-none dshx:focus-visible:ring-0 dshx:dark:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea }
