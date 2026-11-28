import { useEffect, useRef } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { CheckIcon, ChevronRightIcon, ZapIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { AccountAccent } from './account-color.js'
import { AccountDot } from './account-dot.js'
import { ModelPickerModel, type ModelQuota } from './model-picker-model.js'
import { BrandMark, QuotaText, TruncatedTooltip } from './picker-atoms.js'

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
  /**
   * The search's active option, what Enter uses (round 4 T1): the strongest row state, the selected wash at 12 % ink
   * (≥ 1.25:1 on the popover in both schemes). The focus ring stays on the search.
   */
  readonly highlighted?: boolean
  /** The active option was reached with the keyboard: a 1 px inset neutral outline (≥ 3:1) joins the wash. */
  readonly keyboard?: boolean
  /** Round 3 R11: the model the details pane shows; a neutral 2 px leading bar marks it (the check stays for the model in use). */
  readonly inspected?: boolean
  /** Fast mode is on for this route (C2): a static ink bolt, not a switch. Amber stays for low quota. */
  readonly fastOn?: boolean
  readonly quota: ModelQuota | undefined
  readonly providerLabel: string | undefined
  /** Round 3 R3: the row's account as its short tag ("CC1"), muted, instead of the service name on every row. */
  readonly accountTag?: string | undefined
  /** Round 4 T7: the account's dot before its tag, as on the trigger and in the fallbacks. */
  readonly accountAccent?: AccountAccent | undefined
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
  const shownName = ModelPickerModel.middleTruncate(name)
  const selectMode = props.selectSeveral === true
  const quotaId = props.id === undefined ? undefined : `${props.id}-quota`

  // Round 3 R10: the option is the model; the chevron beside it is its own control ("Details for <model>"), so VoiceOver
  // can reach details without the Right key. The row only draws them as one line.
  const optionName = `${selectMode ? '' : 'Use '}${name}${props.providerLabel === undefined ? '' : ` via ${props.providerLabel}`} (${props.group.name})`
  return (
    <div
      className={cn(
        'dshx:group/row dshx:relative dshx:flex dshx:h-8 dshx:cursor-default dshx:items-center dshx:gap-1 dshx:rounded-md dshx:pr-0.5 dshx:transition-colors dshx:hover:bg-accent/60 dshx:pointer-coarse:h-11',
        // Round 4 T1: the list is not a radio group, so the model in use carries no wash or edge, only its check and 600
        // weight; a fan-out choice keeps the wash beside its checkbox.
        props.fanOutSelected && 'dshx:bg-selected-wash',
        // Round 3 R11: the search's active option (what Enter uses) shows the hover wash; the focus ring stays on the search.
        props.highlighted === true && 'dshx:bg-foreground/12 dshx:hover:bg-foreground/12',
        props.highlighted === true && props.keyboard === true && 'dshx:outline-1 dshx:-outline-offset-1 dshx:outline-foreground/50 dshx:outline-solid',
        props.inspected === true &&
          'dshx:before:absolute dshx:before:inset-y-1.5 dshx:before:left-0 dshx:before:w-0.5 dshx:before:rounded-full dshx:before:bg-muted-foreground',
      )}
      data-active-visible={props.highlighted === true || undefined}
      data-fan-out-selected={props.fanOutSelected || undefined}
      data-model-inspected={props.inspected === true || undefined}
      data-model-picker-row
      onPointerMove={props.onHover}
      role="presentation"
    >
      <div
        aria-checked={selectMode ? props.fanOutSelected : undefined}
        aria-describedby={props.quota === undefined ? undefined : quotaId}
        aria-disabled={props.busy || undefined}
        aria-label={optionName}
        aria-selected={selectMode ? undefined : props.active}
        className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:self-stretch dshx:pl-1.5"
        data-model-picker-option
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
        onPointerUp={cancelPress}
        role="option"
      >
        {/* N6: in select mode the mark column holds a 16 px checkbox (the option itself carries aria-checked); round 3 R3:
          the brand mark stays after it. */}
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
        ) : null}
        <BrandMark brand={brand} className="dshx:size-4" name={name} />
        {/* Round 3 R3: the name comes first and truncates last. The account tag is short and fixed, so nothing beside the
          name takes its room while it still fits. */}
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1.5 dshx:overflow-hidden">
          <TruncatedTooltip content={props.model.id} shortened={shownName !== name}>
            <span
              className={cn('dshx:min-w-0 dshx:flex-[1_1_auto] dshx:truncate dshx:text-sm dshx:font-[450]', props.active && 'dshx:font-semibold')}
              data-model-picker-name
            >
              {shownName}
            </span>
          </TruncatedTooltip>
          {/* Round 4 T7: the bolt sits next to the name, so it never moves the trailing columns. */}
          {props.fastOn === true ? (
            <ZapIcon aria-label="Fast mode on" className="dshx:size-3 dshx:text-foreground dshx:shrink-0 dshx:self-center" data-model-fast-on role="img" />
          ) : null}
        </span>
        {/* Round 4 T7: fixed trailing columns (account, quota, check), so they line up on every row. */}
        <span className="dshx:flex dshx:w-12 dshx:shrink-0 dshx:items-center dshx:gap-1" data-model-row-account-slot>
          {props.accountTag === undefined ? null : (
            <>
              {props.accountAccent === undefined ? null : <AccountDot accent={props.accountAccent} className="dshx:size-1.5" />}
              <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums" data-model-row-account>
                {props.accountTag}
              </span>
            </>
          )}
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
        <span className="dshx:flex dshx:w-3.5 dshx:shrink-0 dshx:items-center dshx:justify-center" data-model-row-check-slot>
          {props.active ? <CheckIcon aria-hidden="true" className="dshx:size-3.5 dshx:text-foreground dshx:shrink-0" data-model-current-check /> : null}
        </span>
      </div>
      {selectMode ? null : (
        <button
          aria-label={`Details for ${name}`}
          className="dshx-hit-44 dshx:flex dshx:size-6 dshx:pointer-coarse:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
          data-model-details-label={`Details for ${name}`}
          data-model-details-trigger
          onClick={props.onInspect}
          // The keyboard opens details with Right from the search, so the chevron is no extra tab stop; a screen reader
          // reaches it by swiping, as its own button.
          tabIndex={-1}
          type="button"
        >
          <ChevronRightIcon aria-hidden="true" className="dshx:size-3.5" />
        </button>
      )}
    </div>
  )
}
