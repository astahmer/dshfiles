'use client'

import { useMemo } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

import { Label } from './label.js'
import { Separator } from './separator.js'

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn('dshx:flex dshx:flex-col dshx:gap-6', 'dshx:has-[>[data-slot=checkbox-group]]:gap-3 dshx:has-[>[data-slot=radio-group]]:gap-3', className)}
      {...props}
    />
  )
}

function FieldLegend({ className, variant = 'legend', ...props }: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn('dshx:mb-3 dshx:font-medium', 'dshx:data-[variant=legend]:text-base', 'dshx:data-[variant=label]:text-sm', className)}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        'dshx:group/field-group dshx:@container/field-group dshx:flex dshx:w-full dshx:flex-col dshx:gap-7 dshx:data-[slot=checkbox-group]:gap-3 dshx:[&>[data-slot=field-group]]:gap-4',
        className,
      )}
      {...props}
    />
  )
}

const fieldVariants = cva('dshx:group/field dshx:flex dshx:w-full dshx:gap-3 dshx:data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: ['flex-col [&>*]:w-full [&>.sr-only]:w-auto'],
      horizontal: [
        'dshx:flex-row dshx:items-center',
        'dshx:[&>[data-slot=field-label]]:flex-auto',
        'dshx:has-[>[data-slot=field-content]]:items-start dshx:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      ],
      responsive: [
        'dshx:flex-col dshx:@md/field-group:flex-row dshx:@md/field-group:items-center dshx:[&>*]:w-full dshx:@md/field-group:[&>*]:w-auto dshx:[&>.sr-only]:w-auto',
        'dshx:@md/field-group:[&>[data-slot=field-label]]:flex-auto',
        'dshx:@md/field-group:has-[>[data-slot=field-content]]:items-start dshx:@md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      ],
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
})

function Field({ className, orientation = 'vertical', ...props }: React.ComponentProps<'div'> & VariantProps<typeof fieldVariants>) {
  return <div role="group" data-slot="field" data-orientation={orientation} className={cn(fieldVariants({ orientation }), className)} {...props} />
}

function FieldContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-content"
      className={cn('dshx:group/field-content dshx:flex dshx:flex-1 dshx:flex-col dshx:gap-1.5 dshx:leading-snug', className)}
      {...props}
    />
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'dshx:group/field-label dshx:peer/field-label dshx:flex dshx:w-fit dshx:gap-2 dshx:leading-snug dshx:group-data-[disabled=true]/field:opacity-50',
        'dshx:has-[>[data-slot=field]]:w-full dshx:has-[>[data-slot=field]]:flex-col dshx:has-[>[data-slot=field]]:rounded-md dshx:has-[>[data-slot=field]]:border dshx:[&>*]:data-[slot=field]:p-4',
        'dshx:has-data-[state=checked]:border-primary dshx:has-data-[state=checked]:bg-primary/5 dshx:dark:has-data-[state=checked]:bg-primary/10',
        className,
      )}
      {...props}
    />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        'dshx:flex dshx:w-fit dshx:items-center dshx:gap-2 dshx:text-sm dshx:leading-snug dshx:font-medium dshx:group-data-[disabled=true]/field:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        'dshx:text-sm dshx:leading-normal dshx:font-normal dshx:text-muted-foreground dshx:group-has-[[data-orientation=horizontal]]/field:text-balance',
        'dshx:last:mt-0 dshx:nth-last-2:-mt-1 dshx:[[data-variant=legend]+&]:-mt-1.5',
        'dshx:[&>a]:underline dshx:[&>a]:underline-offset-4 dshx:[&>a:hover]:text-primary',
        className,
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn('dshx:relative dshx:-my-2 dshx:h-5 dshx:text-sm dshx:group-data-[variant=outline]/field-group:-mb-2', className)}
      {...props}
    >
      <Separator className="dshx:absolute dshx:inset-0 dshx:top-1/2" />
      {children && (
        <span
          className="dshx:relative dshx:mx-auto dshx:block dshx:w-fit dshx:bg-background dshx:px-2 dshx:text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [...new Map(errors.map(error => [error?.message, error])).values()]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="dshx:ml-4 dshx:flex dshx:list-disc dshx:flex-col dshx:gap-1">
        {uniqueErrors.map((error, index) => error?.message && <li key={index}>{error.message}</li>)}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div role="alert" data-slot="field-error" className={cn('dshx:text-sm dshx:font-normal dshx:text-destructive', className)} {...props}>
      {content}
    </div>
  )
}

export { Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldContent, FieldTitle }
