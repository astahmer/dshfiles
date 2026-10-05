import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import styles from './field.module.css'

export interface FieldControlProps {
  readonly id: string
  readonly 'aria-describedby'?: string
  readonly 'aria-invalid'?: true
  readonly required?: true
}

export type FieldError = string | readonly string[] | null | undefined

export interface FieldProps {
  readonly label: ReactNode
  readonly description?: ReactNode
  readonly error?: FieldError
  readonly required?: boolean
  readonly className?: string
  readonly children: (control: FieldControlProps) => ReactNode
}

const errorMessages = (error: FieldError): readonly string[] => {
  if (error === null || error === undefined) return []
  if (typeof error === 'string') return error.length === 0 ? [] : [error]
  return error.filter(message => message.length > 0)
}

const joinClassNames = (...classNames: readonly (string | false | undefined)[]): string => classNames.filter(Boolean).join(' ')

/**
 * Label, description, and error around one control, wired for assistive technology.
 * The control renders through `children` so any input — Host `Input`, `TextArea`,
 * `Select`, or a custom widget — receives the same id and descriptions.
 */
export const Field = (props: FieldProps): JSX.Element => {
  const id = useId()
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const errors = errorMessages(props.error)
  const describedBy = [props.description === undefined ? undefined : descriptionId, errors.length === 0 ? undefined : errorId].filter(Boolean).join(' ')
  const control: FieldControlProps = {
    id,
    ...(describedBy.length === 0 ? {} : { 'aria-describedby': describedBy }),
    ...(errors.length === 0 ? {} : { 'aria-invalid': true as const }),
    ...(props.required === true ? { required: true as const } : {}),
  }
  return (
    <div className={joinClassNames(styles.field, props.className)}>
      <label className={styles.label} htmlFor={id}>
        {props.label}
        {props.required === true && (
          <span aria-hidden className={styles.required}>
            *
          </span>
        )}
      </label>
      {props.children(control)}
      {props.description !== undefined && (
        <p className={styles.description} id={descriptionId}>
          {props.description}
        </p>
      )}
      {errors.length > 0 && (
        <p className={styles.error} id={errorId} role="alert">
          {errors.join(' ')}
        </p>
      )}
    </div>
  )
}

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { readonly monospace?: boolean }

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(({ className, monospace, ...rest }, ref) => (
  <textarea ref={ref} className={joinClassNames(styles.control, styles.textArea, monospace === true && styles.monospace, className)} {...rest} />
))
TextArea.displayName = 'TextArea'

export interface SelectOption<Value extends string> {
  readonly value: Value
  readonly label: string
  readonly disabled?: boolean
}

export type SelectProps<Value extends string> = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'> & {
  readonly value: Value
  readonly options: readonly SelectOption<Value>[]
  readonly onValueChange: (value: Value) => void
}

/** Native select styled with DSH tokens; values are typed by the option list. */
export const Select = <Value extends string>({ className, options, value, onValueChange, ...rest }: SelectProps<Value>): JSX.Element => (
  <select
    className={joinClassNames(styles.control, styles.select, className)}
    onChange={event => {
      const next = options.find(option => option.value === event.currentTarget.value)
      if (next !== undefined) onValueChange(next.value)
    }}
    value={value}
    {...rest}
  >
    {options.map(option => (
      <option disabled={option.disabled} key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
)

/** Class for a plain `<input>` that must look like the other field controls (e.g. `type="number"`, `type="color"`). */
export const fieldControlClassName = styles.control

export { joinClassNames }
