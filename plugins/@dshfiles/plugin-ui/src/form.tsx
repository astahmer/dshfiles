import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import { useId, type ReactNode } from 'react'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from './components/ui/field'
import { Input } from './components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Switch } from './components/ui/switch'
import { Textarea } from './components/ui/textarea'
import { cn } from './lib/utils'

export * from '@tanstack/react-form'

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts()

/** Messages of a field's current errors: strings, Standard Schema issues, or Errors. */
export const fieldErrorMessages = (errors: readonly unknown[]): readonly string[] =>
  errors.flatMap(error => {
    if (typeof error === 'string') return [error]
    if (error !== null && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return [error.message]
    return []
  })

const useVisibleErrors = (): readonly string[] => {
  const field = useFieldContext<unknown>()
  const meta = field.state.meta
  return meta.isTouched || field.form.state.submissionAttempts > 0 ? fieldErrorMessages(meta.errors) : []
}

interface LabelledFieldProps {
  readonly label: ReactNode
  readonly description?: ReactNode
  readonly required?: boolean
  readonly className?: string
}

/** Label, description and error wired to one control by id (`aria-describedby`, `aria-invalid`). */
const LabelledField = (props: LabelledFieldProps & { readonly children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode }): JSX.Element => {
  const id = useId()
  const errors = useVisibleErrors()
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const describedBy = [props.description === undefined ? undefined : descriptionId, errors.length === 0 ? undefined : errorId].filter(Boolean).join(' ')
  return (
    <Field className={props.className} data-invalid={errors.length > 0 || undefined}>
      <FieldLabel htmlFor={id}>
        {props.label}
        {props.required === true && (
          <span aria-hidden className="dshx:text-destructive">
            *
          </span>
        )}
      </FieldLabel>
      {props.children({
        id,
        ...(describedBy.length === 0 ? {} : { 'aria-describedby': describedBy }),
        ...(errors.length === 0 ? {} : { 'aria-invalid': true as const }),
      })}
      {props.description !== undefined && <FieldDescription id={descriptionId}>{props.description}</FieldDescription>}
      <FieldError errors={errors.map(message => ({ message }))} id={errorId} />
    </Field>
  )
}

const TextField = (
  props: LabelledFieldProps & {
    readonly placeholder?: string
    readonly type?: 'text' | 'url' | 'email' | 'password' | 'number'
    readonly autoComplete?: string
    readonly monospace?: boolean
  },
): JSX.Element => {
  const field = useFieldContext<string>()
  return (
    <LabelledField {...props}>
      {control => (
        <Input
          {...control}
          autoComplete={props.autoComplete ?? 'off'}
          className={cn(props.monospace === true && 'dshx:font-mono')}
          name={field.name}
          onBlur={field.handleBlur}
          onChange={event => field.handleChange(event.currentTarget.value)}
          placeholder={props.placeholder}
          required={props.required}
          type={props.type ?? 'text'}
          value={field.state.value}
        />
      )}
    </LabelledField>
  )
}

const TextAreaField = (props: LabelledFieldProps & { readonly placeholder?: string; readonly rows?: number; readonly monospace?: boolean }): JSX.Element => {
  const field = useFieldContext<string>()
  return (
    <LabelledField {...props}>
      {control => (
        <Textarea
          {...control}
          className={cn(props.monospace === true && 'dshx:font-mono dshx:text-xs')}
          name={field.name}
          onBlur={field.handleBlur}
          onChange={event => field.handleChange(event.currentTarget.value)}
          placeholder={props.placeholder}
          required={props.required}
          rows={props.rows}
          value={field.state.value}
        />
      )}
    </LabelledField>
  )
}

export interface SelectOption<Value extends string> {
  readonly value: Value
  readonly label: string
  readonly disabled?: boolean
}

const SelectField = <Value extends string>(props: LabelledFieldProps & { readonly options: readonly SelectOption<Value>[]; readonly placeholder?: string }): JSX.Element => {
  const field = useFieldContext<Value>()
  return (
    <LabelledField {...props}>
      {control => (
        <Select
          name={field.name}
          onValueChange={value => {
            const next = props.options.find(option => option.value === value)
            if (next !== undefined) field.handleChange(next.value)
          }}
          value={field.state.value}
        >
          <SelectTrigger {...control} className="dshx:w-full" onBlur={field.handleBlur}>
            <SelectValue placeholder={props.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {props.options.map(option => (
              <SelectItem disabled={option.disabled} key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </LabelledField>
  )
}

const ToggleField = (props: { readonly label: ReactNode; readonly description?: ReactNode; readonly kind: 'checkbox' | 'switch' }): JSX.Element => {
  const field = useFieldContext<boolean>()
  const id = useId()
  const Control = props.kind === 'checkbox' ? Checkbox : Switch
  return (
    <Field orientation="horizontal">
      <Control checked={field.state.value} id={id} name={field.name} onBlur={field.handleBlur} onCheckedChange={checked => field.handleChange(checked === true)} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
        {props.description !== undefined && <FieldDescription>{props.description}</FieldDescription>}
      </FieldContent>
    </Field>
  )
}

const CheckboxField = (props: { readonly label: ReactNode; readonly description?: ReactNode }): JSX.Element => <ToggleField {...props} kind="checkbox" />

const SwitchField = (props: { readonly label: ReactNode; readonly description?: ReactNode }): JSX.Element => <ToggleField {...props} kind="switch" />

/** Submit button that disables itself while the form is invalid or submitting. */
const SubmitButton = (props: { readonly children: ReactNode; readonly className?: string; readonly disabled?: boolean }): JSX.Element => {
  const form = useFormContext()
  return (
    <form.Subscribe selector={state => [state.canSubmit, state.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => (
        <Button className={props.className} disabled={props.disabled === true || !canSubmit || isSubmitting} type="submit">
          {props.children}
        </Button>
      )}
    </form.Subscribe>
  )
}

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, TextAreaField, SelectField, CheckboxField, SwitchField },
  formComponents: { SubmitButton },
})

export { useFieldContext, useFormContext }
