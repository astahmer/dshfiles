import { useEffect, useRef } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CheckIcon, ChevronRightIcon, ZapIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ModelPickerModel, type ModelQuota } from './model-picker-model.js'
import { BrandMark, ProviderLabel, QuotaText } from './picker-atoms.js'

type CatalogGroup = ModelDirectoryState['groups'][number]
type CatalogModel = CatalogGroup['models'][number]

export const ModelRow = (props: {
  readonly group: CatalogGroup
  readonly model: CatalogModel
  readonly active: boolean
  readonly busy: boolean
  /** Fast mode is on for this route (C2): a static ink bolt, not a switch. Amber stays for low quota. */
  readonly fastOn?: boolean
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
        'dshx:group/row dshx:flex dshx:h-7 dshx:pointer-coarse:h-11 dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:px-1.5 dshx:transition-colors dshx:hover:bg-accent/60',
        (props.active || props.fanOutSelected) && 'dshx:bg-selected-wash',
        props.active && 'dshx:selected-edge',
      )}
      data-fan-out-selected={props.fanOutSelected || undefined}
      data-model-picker-row
    >
      <button
        aria-label={`Use ${name}${props.providerLabel === undefined ? '' : ` via ${props.providerLabel}`} (${props.group.name})`}
        aria-pressed={props.active || props.fanOutSelected}
        className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:self-stretch dshx:items-center dshx:gap-1.5 dshx:overflow-hidden dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
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
              <span
                className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-2xs dshx:font-medium', props.active && 'dshx:font-selected')}
                data-model-picker-name
              >
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
      <span className="dshx:flex dshx:w-3.5 dshx:shrink-0 dshx:items-center dshx:justify-center">
        {props.active ? <CheckIcon aria-hidden="true" className="dshx:size-3.5 dshx:text-foreground" data-model-current-check /> : null}
      </span>
      <span className="dshx:flex dshx:w-4 dshx:shrink-0 dshx:items-center dshx:justify-center">
        {props.fastOn === true ? <ZapIcon aria-label="Fast mode on" className="dshx:size-3 dshx:text-foreground" data-model-fast-on role="img" /> : null}
      </span>
      <button
        aria-label={`Details for ${name}`}
        className="dshx-hit-44 dshx:flex dshx:size-[18px] dshx:pointer-coarse:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
        data-model-details-trigger
        onClick={props.onInspect}
        type="button"
      >
        <ChevronRightIcon aria-hidden="true" className="dshx:size-3.5" />
      </button>
    </div>
  )
}
