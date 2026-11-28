import { useState } from 'react'
import * as Schema from 'effect/Schema'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { accountDraftSchema } from './api.js'

export const AccountNameEditor = (props: {
  readonly name: string
  readonly editing: boolean
  readonly disabled: boolean
  readonly onEditingChange: (editing: boolean) => void
  readonly onChange: (name: string) => void
}): JSX.Element =>
  props.editing ? (
    <NameForm key={props.name} {...props} />
  ) : (
    // Section-title size: the page title is the only larger text. Rename lives in the account's ⋯ menu.
    <h2 className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold">{props.name}</h2>
  )
const NameForm = (props: Parameters<typeof AccountNameEditor>[0]): JSX.Element => {
  const [value, setValue] = useState(props.name)
  const [invalid, setInvalid] = useState(false)
  const commit = (): void => {
    const name = Schema.decodeUnknownResult(accountDraftSchema.fields.displayName)(value.trim())
    if (name._tag === 'Failure') {
      setInvalid(true)
      return
    }
    props.onChange(name.success)
    props.onEditingChange(false)
  }
  return (
    <form
      className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-wrap dshx:items-center dshx:gap-2"
      onSubmit={event => {
        event.preventDefault()
        commit()
      }}
    >
      <Input
        aria-label="Account name"
        aria-invalid={invalid}
        autoFocus
        className="dshx:min-w-0 dshx:flex-1"
        disabled={props.disabled}
        maxLength={120}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            props.onEditingChange(false)
          }
        }}
        value={value}
      />
      <Button disabled={props.disabled} size="xs" type="submit">
        Done
      </Button>
      <Button onClick={() => props.onEditingChange(false)} size="xs" type="button" variant="ghost">
        Cancel rename
      </Button>
      {invalid ? (
        <p className="dshx:w-full dshx:text-xs dshx:text-destructive" role="alert">
          Enter a name between 1 and 120 characters.
        </p>
      ) : null}
    </form>
  )
}
