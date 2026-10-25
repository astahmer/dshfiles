import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { PencilIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import { accountDraftSchema, type AccountProfile } from './api.js'
import { ProviderGlyph } from './provider-glyph.js'

/** Only the unsent name is local; accepted names remain in the provisional Host snapshot. */
export const AccountConnectionSummary = (props: {
  readonly account: AccountProfile
  readonly editable: boolean
  readonly busy: boolean
  readonly saveName: (name: string) => Promise<unknown>
}): JSX.Element => {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(props.account.displayName)
  const [error, setError] = useState<string | null>(null)
  const cancel = (): void => {
    setValue(props.account.displayName)
    setError(null)
    setEditing(false)
  }
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3">
      <ProviderGlyph kind={props.account.kind} className="dshx:size-8 dshx:shrink-0" />
      {editing ? (
        <form
          data-account-name-editor
          className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-2"
          onSubmit={event => {
            event.preventDefault()
            const parsed = accountDraftSchema.shape.displayName.safeParse(value.trim())
            if (!parsed.success) {
              setError('Enter a name between 1 and 120 characters.')
              return
            }
            void props
              .saveName(parsed.data)
              .then(() => setEditing(false))
              .catch(() => setError('Could not update the name. Try again.'))
          }}
        >
          <Input
            aria-label="Account name"
            aria-invalid={error !== null}
            autoFocus
            disabled={props.busy}
            maxLength={120}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              cancel()
            }}
            value={value}
          />
          {error === null ? null : (
            <p role="alert" className="dshx:text-xs dshx:text-destructive">
              {error}
            </p>
          )}
          <div className="dshx:flex dshx:gap-2">
            <Button type="submit" size="xs" disabled={props.busy}>
              Save name
            </Button>
            <Button type="button" size="xs" variant="ghost" disabled={props.busy} onClick={cancel}>
              Cancel name edit
            </Button>
          </div>
        </form>
      ) : (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1">
          <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold">{props.account.displayName}</span>
          {props.editable ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild onFocus={event => event.preventDefault()}>
                  <Button
                    aria-label="Edit account name"
                    disabled={props.busy}
                    onClick={() => {
                      setValue(props.account.displayName)
                      setError(null)
                      setEditing(true)
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <PencilIcon className="dshx:size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit account name</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      )}
    </div>
  )
}
