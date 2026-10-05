import { Button, Checkbox, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import type { ReactNode } from 'react'
import { Field, Select, TextArea, type SelectOption } from './field.js'

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
}

const labelledProps = (props: LabelledFieldProps): LabelledFieldProps => ({
  label: props.label,
  ...(props.description === undefined ? {} : { description: props.description }),
  ...(props.required === undefined ? {} : { required: props.required }),
})

const TextField = (
  props: LabelledFieldProps & {
    readonly placeholder?: string
    readonly type?: 'text' | 'url' | 'email' | 'password' | 'number'
    readonly autoComplete?: string
  },
): JSX.Element => {
  const field = useFieldContext<string>()
  return (
    <Field {...labelledProps(props)} error={useVisibleErrors()}>
      {control => (
        <Input
          {...control}
          autoComplete={props.autoComplete ?? 'off'}
          name={field.name}
          onBlur={field.handleBlur}
          onChange={event => field.handleChange(event.currentTarget.value)}
          placeholder={props.placeholder}
          type={props.type ?? 'text'}
          value={field.state.value}
        />
      )}
    </Field>
  )
}

const TextAreaField = (props: LabelledFieldProps & { readonly placeholder?: string; readonly rows?: number; readonly monospace?: boolean }): JSX.Element => {
  const field = useFieldContext<string>()
  return (
    <Field {...labelledProps(props)} error={useVisibleErrors()}>
      {control => (
        <TextArea
          {...control}
          monospace={props.monospace}
          name={field.name}
          onBlur={field.handleBlur}
          onChange={event => field.handleChange(event.currentTarget.value)}
          placeholder={props.placeholder}
          rows={props.rows}
          value={field.state.value}
        />
      )}
    </Field>
  )
}

const SelectField = <Value extends string>(props: LabelledFieldProps & { readonly options: readonly SelectOption<Value>[] }): JSX.Element => {
  const field = useFieldContext<Value>()
  return (
    <Field {...labelledProps(props)} error={useVisibleErrors()}>
      {control => (
        <Select {...control} name={field.name} onBlur={field.handleBlur} onValueChange={field.handleChange} options={props.options} value={field.state.value} />
      )}
    </Field>
  )
}

const CheckboxField = (props: { readonly label: string; readonly title?: string }): JSX.Element => {
  const field = useFieldContext<boolean>()
  return <Checkbox checked={field.state.value} label={props.label} onChange={field.handleChange} title={props.title} />
}

const SwitchField = (props: { readonly label: string; readonly title?: string }): JSX.Element => {
  const field = useFieldContext<boolean>()
  return <Switch checked={field.state.value} label={props.label} onChange={field.handleChange} title={props.title} />
}

/** Submit button that disables itself while the form is invalid or submitting. */
const SubmitButton = (props: { readonly children: ReactNode; readonly className?: string; readonly disabled?: boolean }): JSX.Element => {
  const form = useFormContext()
  return (
    <form.Subscribe selector={state => [state.canSubmit, state.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => (
        <Button className={props.className} disabled={props.disabled === true || !canSubmit || isSubmitting} type="submit" variant="primary">
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
