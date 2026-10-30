import { useState } from 'react'
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
}

export const FastModeSection = ({ sessionId, provider, model, disabled, onEnabledChange }: Props) => {
  const input = { sessionId, provider, model }
  const api = useApi(aiAccountsFastModeApi)
  const state = useApiQuery(aiAccountsFastModeApi, 'status', { input })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = state.data
  if (status === undefined || !status.available) return null

  const update = async (enabled: boolean): Promise<void> => {
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
    <section
      className="dshx:mt-3 dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:px-3 dshx:py-2.5"
      data-model-fast-mode
    >
      <p className="dshx:text-sm dshx:font-semibold">Fast mode</p>
      <Switch
        aria-label="Fast mode; may cost more"
        checked={status.enabled}
        data-model-fast-mode-toggle
        disabled={disabled || pending}
        onCheckedChange={(enabled: boolean) => void update(enabled)}
      />
      {error !== null && (
        <p className="dshx:w-full dshx:text-xs dshx:text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
