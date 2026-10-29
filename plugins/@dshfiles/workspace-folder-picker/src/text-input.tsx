import { Field, FieldError, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'

export const TextInput = (props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly error: string | undefined
  readonly placeholder?: string
  readonly onChange: (value: string) => void
}): JSX.Element => (
  <Field data-invalid={props.error !== undefined}>
    <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
    <Input
      aria-invalid={props.error !== undefined}
      autoComplete="off"
      className="dshx:font-mono!"
      id={props.id}
      onChange={event => props.onChange(event.currentTarget.value)}
      placeholder={props.placeholder}
      value={props.value}
    />
    {props.error !== undefined && <FieldError>{props.error}</FieldError>}
  </Field>
)
