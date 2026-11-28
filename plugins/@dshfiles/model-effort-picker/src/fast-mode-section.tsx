import { useEffect, useId, useState } from 'react'
import { aiAccountsFastModeApi } from '@dshfiles/ai-accounts/model-fast-mode-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { errorMessage } from '@dshfiles/plugin-ui/query'

type Props = {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly disabled: boolean
  readonly onEnabledChange: (enabled: boolean) => void
  /** On a draft (S1) the switch stages its value; "Use ‹model›" applies it. */
  readonly draft?: { readonly value: boolean | undefined; readonly onChange: (enabled: boolean) => void } | null
}

/**
 * Council picker round 1, C2: Fast mode is one visible, labelled row in details, the kit Switch at its end (28×16 drawn,
 * a 44 px row on touch). The label says what it does and what it costs, so no tooltip is needed.
 */
export const FastModeRow = (props: {
  readonly enabled: boolean
  readonly disabled: boolean
  readonly error: string | null
  readonly onChange: (enabled: boolean) => void
}) => {
  const id = useId()
  return (
    <div className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1" data-model-fast-mode>
      <div className="dshx:flex dshx:min-h-8 dshx:items-center dshx:justify-between dshx:gap-2 dshx:pointer-coarse:min-h-11">
        <label className="dshx:min-w-0 dshx:text-xs dshx:font-medium" htmlFor={id}>
          Fast mode <span className="dshx:font-normal dshx:text-muted-foreground">· may cost more</span>
        </label>
        <Switch
          checked={props.enabled}
          className="dshx:h-4 dshx:w-7"
          data-model-fast-mode-toggle
          disabled={props.disabled}
          id={id}
          onCheckedChange={props.onChange}
          size="sm"
        />
      </div>
      {props.error === null ? null : (
        <p className="dshx:text-2xs dshx:text-destructive" data-model-fast-mode-error>
          {props.error} Try the switch again, or reopen the picker.
        </p>
      )}
    </div>
  )
}

/** Fast mode for the inspected route: hidden unless AI Accounts says the route supports it. */
export const FastModeSection = ({
  sessionId,
  provider,
  model,
  disabled,
  onEnabledChange,
  draft = null,
  onStatus,
}: Props & {
  /** Reports the route's stored state once it is known, so the list can mark the routes where Fast mode is on. */
  readonly onStatus?: (enabled: boolean) => void
}) => {
  const input = { sessionId, provider, model }
  const api = useApi(aiAccountsFastModeApi)
  const state = useApiQuery(aiAccountsFastModeApi, 'status', { input })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = state.data
  useEffect(() => {
    if (status !== undefined && status.available) onStatus?.(status.enabled)
  }, [status, onStatus])
  if (status === undefined || !status.available) return null

  const update = async (enabled: boolean): Promise<void> => {
    if (draft !== null) {
      draft.onChange(enabled)
      return
    }
    setPending(true)
    setError(null)
    try {
      const updated = await api.setFast({ ...input, enabled })
      onEnabledChange(updated.enabled)
      await state.refetch()
    } catch (cause) {
      setError(errorMessage(cause, 'Fast mode could not be updated.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <FastModeRow
      disabled={(disabled && draft === null) || pending}
      enabled={draft?.value ?? status.enabled}
      error={error}
      onChange={enabled => void update(enabled)}
    />
  )
}
