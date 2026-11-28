import { useEffect, useRef } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { CheckIcon, ChevronRightIcon, ZapIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ModelPickerModel, type ModelQuota } from './model-picker-model.js'
import { BrandMark, ProviderLabel, QuotaText, TruncatedTooltip } from './picker-atoms.js'

type CatalogGroup = ModelDirectoryState['groups'][number]
type CatalogModel = CatalogGroup['models'][number]

/**
 * One model in the picker's listbox (council picker round 1, C5): the row is the `option` the search combobox points at
 * with `aria-activedescendant`, so the list is one tab stop. A click or Enter uses the model; the chevron (pointer and
 * touch; Right arrow from the keyboard) opens its details. `aria-selected` marks the model in use, and in select mode
 * `aria-checked` marks the routes collected for a fan-out.
 */
export const ModelRow = (props: {
  readonly id?: string
  readonly group: CatalogGroup
  readonly model: CatalogModel
  readonly active: boolean
  readonly busy: boolean
  /** The keyboard's current row: it draws the kit focus ring (2 px, 1 px offset). */
  readonly highlighted?: boolean
  /** Fast mode is on for this route (C2): a static ink bolt, not a switch. Amber stays for low quota. */
  readonly fastOn?: boolean
  readonly quota: ModelQuota | undefined
  readonly providerLabel: string | undefined
  readonly current: ModelSelection | null
  readonly fanOutSelected: boolean
  readonly onSelect: (selection: ModelSelection) => void
  readonly onFanOut: (selection: ModelSelection) => void
  readonly onInspect: () => void
  readonly onHover?: () => void
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
  const selectMode = props.selectSeveral === true
  const quotaId = props.id === undefined ? undefined : `${props.id}-quota`

  return (
    <div
      aria-checked={selectMode ? props.fanOutSelected : undefined}
      aria-describedby={props.quota === undefined ? undefined : quotaId}
      aria-disabled={props.busy || undefined}
      aria-label={`Use ${name}${props.providerLabel === undefined ? '' : ` via ${props.providerLabel}`} (${props.group.name})`}
      aria-selected={selectMode ? undefined : props.active}
      className={cn(
        'dshx:group/row dshx:flex dshx:h-8 dshx:cursor-default dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-1.5 dshx:transition-colors dshx:hover:bg-accent/60 dshx:pointer-coarse:h-11',
        (props.active || props.fanOutSelected) && 'dshx:bg-selected-wash',
        props.active && 'dshx:selected-edge',
        props.highlighted === true && 'dshx:outline-2 dshx:outline-offset-1 dshx:outline-[var(--dsw-alias-state-business-primary)] dshx:outline-solid',
      )}
      data-active-visible={props.highlighted === true || undefined}
      data-fan-out-selected={props.fanOutSelected || undefined}
      data-model-picker-option
      data-model-picker-row
      id={props.id}
      onClick={event => {
        if (press.current.fired) {
          press.current.fired = false
          return
        }
        if (props.busy) return
        const selection = ModelPickerModel.selectionForModel(props.group, props.model, props.current)
        if (event.shiftKey || selectMode) props.onFanOut(selection)
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
      onPointerMove={props.onHover}
      onPointerUp={cancelPress}
      role="option"
    >
      {/* N6: in select mode the mark column holds a 16 px checkbox (the option itself carries aria-checked). */}
      {selectMode ? (
        <span
          aria-hidden="true"
          className={cn(
            'dshx:flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-sm dshx:border dshx:border-field-border',
            props.fanOutSelected && 'dshx:border-control-on-dense dshx:bg-control-on-dense dshx:text-control-on-foreground',
          )}
          data-model-fan-out-check
        >
          {props.fanOutSelected ? <CheckIcon className="dshx:size-3" /> : null}
        </span>
      ) : (
        <BrandMark brand={brand} className="dshx:size-4" name={name} />
      )}
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1.5 dshx:overflow-hidden">
        <TruncatedTooltip content={props.model.id}>
          <span
            className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-[450]', props.active && 'dshx:font-selected')}
            data-model-picker-name
          >
            {name}
          </span>
        </TruncatedTooltip>
        {props.providerLabel === undefined ? null : <ProviderLabel className="dshx:max-w-[7rem]" label={props.providerLabel} />}
      </span>
      {/* b:16yr: one row per model, so no account badge or per-row effort glyph: the account and the reasoning effort are
          chosen in the detail panel. What stays is what is left on the account a click would use, quiet unless low. */}
      <span className="dshx:flex dshx:w-8 dshx:shrink-0 dshx:justify-end" data-model-picker-quota>
        {props.quota === undefined ? null : (
          <>
            <QuotaText label={props.quota.label} onReserve={props.quota.onReserve} percent={props.quota.percent} />
            <span className="dshx:sr-only" id={quotaId}>
              {`${String(Math.round(props.quota.percent))} % left on ${props.group.name}`}
            </span>
          </>
        )}
      </span>
      <span className="dshx:flex dshx:w-3.5 dshx:shrink-0 dshx:items-center dshx:justify-center">
        {props.active ? <CheckIcon aria-hidden="true" className="dshx:size-3.5 dshx:text-foreground" data-model-current-check /> : null}
      </span>
      <span className="dshx:flex dshx:w-4 dshx:shrink-0 dshx:items-center dshx:justify-center">
        {props.fastOn === true ? <ZapIcon aria-label="Fast mode on" className="dshx:size-3 dshx:text-foreground" data-model-fast-on role="img" /> : null}
      </span>
      {selectMode ? null : (
        <>
          {/* Pointer and touch only: the keyboard opens details with Right, so this is no second tab stop inside the option. */}
          <button
            aria-hidden="true"
            className="dshx-hit-44 dshx:flex dshx:size-[18px] dshx:pointer-coarse:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
            data-model-details-label={`Details for ${name}`}
            data-model-details-trigger
            onClick={event => {
              event.stopPropagation()
              props.onInspect()
            }}
            onPointerDown={event => event.stopPropagation()}
            tabIndex={-1}
            type="button"
          >
            <ChevronRightIcon aria-hidden="true" className="dshx:size-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
