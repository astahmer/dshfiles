import { useState } from 'react'
import { aiAccountsFastModeApi } from '@dshfiles/ai-accounts/model-fast-mode-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CircleAlertIcon, ZapIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

type Props = {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly disabled: boolean
  readonly onEnabledChange: (enabled: boolean) => void
}

/** Fast mode for the inspected route: the same switch the composer shows, next to the model it applies to. */
export const FastModeSection = ({ sessionId, provider, model, disabled, onEnabledChange }: Props) => {
  const input = { sessionId, provider, model }
  const api = useApi(aiAccountsFastModeApi)
  const state = useApiQuery(aiAccountsFastModeApi, 'status', { input })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = state.data
  if (status === undefined) return <span className="dshx:h-5 dshx:w-24" />
  if (!status.available) return null

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
    <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5" data-model-fast-mode>
      <ZapIcon aria-hidden="true" className={cn('dshx:size-3.5 dshx:shrink-0', status.enabled ? 'dshx:text-warning' : 'dshx:text-muted-foreground')} />
      <span className="dshx:text-[10px] dshx:text-muted-foreground">Fast mode</span>
      <Switch
        aria-label="Fast mode; may cost more"
        checked={status.enabled}
        className="dshx:data-[size=sm]:h-4 dshx:data-[size=sm]:w-7"
        data-model-fast-mode-toggle
        disabled={disabled || pending}
        onCheckedChange={(enabled: boolean) => void update(enabled)}
        size="sm"
      />
      {error === null ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button aria-label={error} className="dshx:flex dshx:size-4 dshx:items-center dshx:justify-center dshx:text-destructive" type="button">
              <CircleAlertIcon aria-hidden="true" className="dshx:size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="dshx:max-w-56 dshx:text-pretty" side="top">
            {error}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
