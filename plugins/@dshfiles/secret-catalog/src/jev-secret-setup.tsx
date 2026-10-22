import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { useState, type FormEvent } from 'react'
import type { SecretCatalogTranslate } from './locales.js'

interface JevSecretSetupProps {
  readonly unavailable: 'loading' | 'failed' | 'ambiguous' | null
  readonly existing: boolean
  readonly onCancel: () => void
  readonly onSave: (value: string) => Promise<void>
  readonly onPendingChange: (pending: boolean) => void
  readonly onSaved: () => void
  readonly t: SecretCatalogTranslate
}

export const JevSecretSetup = (props: JevSecretSetupProps): JSX.Element => {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (saving || value.length === 0 || props.unavailable !== null) return
    setValue('')
    setSaveFailed(false)
    setSaving(true)
    props.onPendingChange(true)
    let saved = false
    try {
      await props.onSave(value)
      saved = true
    } catch {
      setSaveFailed(true)
    }
    setSaving(false)
    props.onPendingChange(false)
    if (saved) props.onSaved()
  }

  let unavailableMessage: string | null = null
  if (props.unavailable === 'loading') unavailableMessage = props.t('loadingMetadata')
  else if (props.unavailable === 'failed') unavailableMessage = props.t('jevSetupLoadFailed')
  else if (props.unavailable === 'ambiguous') unavailableMessage = props.t('jevSetupAmbiguous')

  return (
    <form className="dshx:flex dshx:flex-col dshx:gap-2" data-testid="jev-secret-setup" noValidate onSubmit={submit}>
      <p className="dshx:px-1 dshx:text-xs dshx:font-medium">{props.t('jevSetupTitle')}</p>
      <p className="dshx:px-1 dshx:text-xs dshx:text-muted-foreground">{props.t('jevSetupDescription')}</p>
      {props.existing && <p className="dshx:px-1 dshx:text-xs dshx:text-warning">{props.t('jevSetupWillReplace')}</p>}
      <label className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-1 dshx:text-xs">
        {props.t('jevSetupValueLabel')}
        <Input
          aria-label={props.t('jevSetupValueLabel')}
          autoComplete="new-password"
          autoFocus
          className="dshx:font-mono! dshx:text-xs"
          disabled={saving}
          onChange={event => setValue(event.currentTarget.value)}
          placeholder={props.t('jevSetupValuePlaceholder')}
          spellCheck={false}
          type="password"
          value={value}
        />
      </label>
      {unavailableMessage !== null && (
        <p className="dshx:px-1 dshx:text-xs dshx:text-muted-foreground" role="status">
          {unavailableMessage}
        </p>
      )}
      {saveFailed && (
        <p className="dshx:px-1 dshx:text-xs dshx:text-destructive" role="alert">
          {props.t('jevSetupSaveFailed')}
        </p>
      )}
      <div className="dshx:flex dshx:justify-end dshx:gap-2">
        <Button disabled={saving} onClick={props.onCancel} size="sm" type="button" variant="ghost">
          {props.t('cancel')}
        </Button>
        <Button disabled={saving || value.length === 0 || props.unavailable !== null} size="sm" type="submit">
          {saving
            ? props.existing
              ? props.t('saving')
              : props.t('adding')
            : props.existing
              ? props.t('jevSetupReplaceAndBind')
              : props.t('jevSetupAddAndBind')}
        </Button>
      </div>
    </form>
  )
}
