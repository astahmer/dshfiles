import { useEffect, useRef, useState } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { aiAccountsFastModeApi } from '@dshfiles/ai-accounts/model-fast-mode-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ModelPickerModel, type ModelQuota } from './model-picker-model.js'
import { BrandMark, ProviderLabel, QuotaText } from './picker-atoms.js'

type CatalogGroup = ModelDirectoryState['groups'][number]
type CatalogModel = CatalogGroup['models'][number]

type FastModeRoute = { readonly sessionId: string; readonly provider: string; readonly model: string }

/**
 * Reads its route once the row is pointed at or focused, and keeps the answer while the row stays mounted: a big
 * catalog would otherwise ask the Host about every model on open, though only a few routes support Fast mode.
 */
const FastModeToggle = ({
  input,
  modelName,
  busy,
  revealed,
}: {
  readonly input: FastModeRoute
  readonly modelName: string
  readonly busy: boolean
  readonly revealed: boolean
}) => {
  const state = useApiQuery(aiAccountsFastModeApi, 'status', { enabled: revealed, input })
  const api = useApi(aiAccountsFastModeApi)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (state.data === undefined || !state.data.available) return null
  const enabled = state.data.enabled
  return (
    <span
      className={cn(
        'dshx:flex dshx:items-center dshx:justify-center',
        !enabled && 'dshx:opacity-0 dshx:group-hover/row:opacity-100 dshx:focus-within:opacity-100',
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Switch
            aria-label={`Fast mode for ${modelName}`}
            checked={enabled}
            className="dshx:data-[size=sm]:h-3.5 dshx:data-[size=sm]:w-6 dshx:data-[state=unchecked]:bg-muted-foreground/35"
            data-model-fast-mode-inline
            disabled={busy || pending}
            onCheckedChange={(next: boolean) => {
              setPending(true)
              setError(null)
              void api
                .setFast({ ...input, enabled: next })
                .then(() => state.refetch())
                .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
                .finally(() => setPending(false))
            }}
            size="sm"
          />
        </TooltipTrigger>
        <TooltipContent side="top">{error ?? (enabled ? 'Fast mode on' : 'Fast mode off')}</TooltipContent>
      </Tooltip>
    </span>
  )
}

export const ModelRow = (props: {
  readonly group: CatalogGroup
  readonly model: CatalogModel
  readonly active: boolean
  readonly busy: boolean
  readonly sessionId: string
  readonly quota: ModelQuota | undefined
  readonly providerLabel: string | undefined
  readonly current: ModelSelection | null
  readonly fanOutSelected: boolean
  readonly onSelect: (selection: ModelSelection) => void
  readonly onFanOut: (selection: ModelSelection) => void
  readonly onInspect: () => void
  /** Select several is on: a click collects the route for a fan-out instead of switching the model. */
  readonly selectSeveral?: boolean
}) => {
  const [revealed, setRevealed] = useState(false)
  // A long press on touch collects the route (b:ysaj), and the click it ends with is swallowed.
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; fired: boolean }>({ timer: undefined, fired: false })
  const cancelPress = (): void => {
    if (press.current.timer !== undefined) clearTimeout(press.current.timer)
    press.current.timer = undefined
  }
  useEffect(() => cancelPress, [])
  const name = ModelPickerModel.displayName({ group: props.group, model: props.model })
  const brand = ModelPickerModel.brandFor({ model: props.model })

  return (
    <div
      className={cn(
        'dshx:group/row dshx:flex dshx:h-7 dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:px-1.5 dshx:transition-colors dshx:hover:bg-accent/60',
        props.active && 'dshx:bg-info/10 dshx:ring-1 dshx:ring-info/60',
        props.fanOutSelected && 'dshx:bg-primary/10 dshx:ring-1 dshx:ring-primary/60',
      )}
      data-fan-out-selected={props.fanOutSelected || undefined}
      data-model-picker-row
      onFocus={() => setRevealed(true)}
      onPointerEnter={() => setRevealed(true)}
    >
      <button
        aria-label={`Use ${name}${props.providerLabel === undefined ? '' : ` via ${props.providerLabel}`} (${props.group.name})`}
        aria-pressed={props.active || props.fanOutSelected}
        className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:overflow-hidden dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
        data-model-picker-option
        disabled={props.busy}
        onClick={event => {
          if (press.current.fired) {
            press.current.fired = false
            return
          }
          const selection = ModelPickerModel.selectionForModel(props.group, props.model, props.current)
          if (event.shiftKey || props.selectSeveral === true) props.onFanOut(selection)
          else props.onSelect(selection)
        }}
        onContextMenu={event => {
          if (press.current.fired) event.preventDefault()
        }}
        onPointerCancel={cancelPress}
        onPointerDown={event => {
          press.current.fired = false
          if (event.pointerType !== 'touch') return
          cancelPress()
          press.current.timer = setTimeout(() => {
            press.current.timer = undefined
            press.current.fired = true
            props.onFanOut(ModelPickerModel.selectionForModel(props.group, props.model, props.current))
          }, 500)
        }}
        onPointerLeave={cancelPress}
        onPointerUp={cancelPress}
        type="button"
      >
        <BrandMark brand={brand} className="dshx:size-4" name={name} />
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1 dshx:overflow-hidden">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-2xs dshx:font-medium" data-model-picker-name>
                {name}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{name}</TooltipContent>
          </Tooltip>
          {props.providerLabel === undefined ? null : (
            <>
              <span aria-hidden="true" className="dshx:shrink-0 dshx:text-2xs dshx:text-muted-foreground/50">
                ·
              </span>
              <ProviderLabel className="dshx:max-w-[7rem]" label={props.providerLabel} />
            </>
          )}
        </span>
      </button>
      {/* b:16yr: one row per model, so no account badge or per-row effort glyph: the account and the reasoning effort are
          chosen in the detail panel. What stays is what is left on the account a click would use, quiet unless low. */}
      <span className="dshx:flex dshx:w-8 dshx:shrink-0 dshx:justify-end" data-model-picker-quota>
        {props.quota === undefined ? null : <QuotaText label={props.quota.label} onReserve={props.quota.onReserve} percent={props.quota.percent} />}
      </span>
      <span
        className="dshx:flex dshx:min-w-6 dshx:shrink-0 dshx:items-center dshx:justify-center"
        onClick={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
      >
        <FastModeToggle
          busy={props.busy}
          input={{ sessionId: props.sessionId, model: props.model.id, provider: props.group.id }}
          modelName={name}
          revealed={revealed}
        />
      </span>
      <button
        aria-label={`Details for ${name}`}
        className="dshx:flex dshx:size-[18px] dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
        data-model-details-trigger
        onClick={props.onInspect}
        type="button"
      >
        <ChevronRightIcon aria-hidden="true" className="dshx:size-3.5" />
      </button>
    </div>
  )
}
