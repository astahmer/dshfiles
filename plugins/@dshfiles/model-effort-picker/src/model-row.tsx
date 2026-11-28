import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { CheckIcon, ChevronRightIcon, ZapIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { AccountDot, type AccountAccent } from '@dshfiles/ai-accounts/account-color'
import { ModelPickerModel, type ModelQuota } from './model-picker-model.js'
import { BrandMark, QuotaText, SnugHead, TruncatedTooltip } from './picker-atoms.js'

type CatalogGroup = ModelDirectoryState['groups'][number]
type CatalogModel = CatalogGroup['models'][number]

/**
 * One model in the picker's listbox (council picker round 1, C5): the row is the `option` the search combobox points at
 * with `aria-activedescendant`, so the list is one tab stop. A click or Enter uses the model; the chevron (pointer and
 * touch; Right arrow from the keyboard) opens its details. `aria-selected` marks the model in use, and in select mode
 * the routes collected for a fan-out.
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
  /** Fast mode is on for this route (C2): a static ink bolt, not a switch. Amber stays for low quota. */
  readonly fastOn?: boolean
  readonly quota: ModelQuota | undefined
  readonly providerLabel: string | undefined
  /** Round 3 R3: the row's account as its short tag ("CC1"), muted, instead of the service name on every row. */
  readonly accountTag?: string | undefined
  /** Round 4 T16: the search text, drawn at 600 where it occurs in the name. */
  readonly query?: string | undefined
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
  const parts = ModelPickerModel.nameTail(name)
  // Round 6 V12: a cut head shrinks to what it draws, so the tail follows its ellipsis directly.
  const snugHead = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const head = snugHead.current
    const row = head?.parentElement?.parentElement
    if (head === null || parts.tail === '' || row === null || row === undefined || typeof ResizeObserver === 'undefined') return
    const context = document.createElement('canvas').getContext('2d')
    if (context === null) return
    const fit = (): void => {
      head.style.maxWidth = ''
      const style = getComputedStyle(head)
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const width = SnugHead.width({ text: head.textContent ?? '', room: head.clientWidth, measure: text => context.measureText(text).width })
      if (width !== undefined) head.style.maxWidth = `${String(width)}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(row)
    return () => observer.disconnect()
  }, [parts.tail, name])
  const selectMode = props.selectSeveral === true
  const quotaId = props.id === undefined ? undefined : `${props.id}-quota`

  // Round 3 R10: the option is the model; the chevron beside it is its own control ("Details for <model>"), so VoiceOver
  // can reach details without the Right key. The row only draws them as one line.
  // Round 4 T12: the option is named by what it is, "gpt-6-luna, Command Code 1" (the account names its service).
  const optionName = `${name}, ${props.group.name}`
  return (
    <div
      className={cn(
        'dshx:group/row dshx:relative dshx:flex dshx:h-8 dshx:cursor-default dshx:items-center dshx:gap-1 dshx:rounded-md dshx:pr-0.5 dshx:pointer-coarse:pr-0 dshx:transition-colors dshx:hover:bg-accent/60 dshx:pointer-coarse:h-11',
        // Round 4 T1, round 5 U4: a row's wash means one thing, what Enter does. The model in use is its check and 600
        // weight, a collected route its checkbox, and the inspected model is named by the details header (no bar).
        props.highlighted === true && 'dshx:bg-foreground/12 dshx:hover:bg-foreground/12',
        props.highlighted === true && props.keyboard === true && 'dshx:outline-1 dshx:-outline-offset-1 dshx:outline-foreground/50 dshx:outline-solid',
      )}
      data-active-visible={props.highlighted === true || undefined}
      data-fan-out-selected={props.fanOutSelected || undefined}
      data-model-picker-row
      onPointerMove={props.onHover}
      role="presentation"
    >
      <div
        aria-describedby={props.quota === undefined ? undefined : quotaId}
        aria-disabled={props.busy || undefined}
        aria-label={optionName}
        // Round 4 T9: in select mode aria-selected marks a collected route (the listbox is multiselectable), which
        // VoiceOver reads; outside it, the model in use.
        aria-selected={selectMode ? props.fanOutSelected : props.active}
        className={cn('dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:self-stretch dshx:pl-1.5', selectMode && 'dshx:pr-2')}
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
        {/* N6: in select mode the mark column holds a 16 px checkbox (the option itself carries aria-selected); round 3 R3:
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
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1 dshx:overflow-hidden">
          <TruncatedTooltip content={props.model.id}>
            <span
              className={cn(
                // Round 5 U7: the name takes its own width, so the Fast bolt sits 4 px after it.
                'dshx:flex dshx:min-w-0 dshx:flex-[0_1_auto] dshx:overflow-hidden dshx:text-sm dshx:font-[450]',
                props.active && 'dshx:font-semibold',
              )}
              data-model-picker-name
            >
              {/* Round 5 U1: the head shrinks with one ellipsis; the tail ("-preview") always shows. */}
              <span className="dshx:min-w-0 dshx:truncate" data-truncates ref={snugHead}>
                <MatchedName from={0} name={name} query={props.query} to={parts.head.length} />
              </span>
              {parts.tail === '' ? null : (
                <span className="dshx:shrink-0 dshx:whitespace-pre">
                  <MatchedName from={parts.head.length} name={name} query={props.query} to={name.length} />
                </span>
              )}
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
        {/* Round 5 U8: select mode has no check column, so the quota sits 8 px from the row's edge. */}
        {selectMode ? null : (
          <span className="dshx:flex dshx:w-3.5 dshx:shrink-0 dshx:items-center dshx:justify-center" data-model-row-check-slot>
            {props.active ? <CheckIcon aria-hidden="true" className="dshx:size-3.5 dshx:text-foreground dshx:shrink-0" data-model-current-check /> : null}
          </span>
        )}
      </div>
      {selectMode ? null : (
        <button
          aria-label={`Details for ${name}`}
          className="dshx-hit-44 dshx:flex dshx:size-6 dshx:pointer-coarse:size-11 dshx:pointer-coarse:@max-pane-compact:-mr-2 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
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

/**
 * The part [from, to) of a name, with the first case-insensitive occurrence of the search (found in the whole name, so
 * a match across the head and tail stays one match) underlined (no other change to the text).
 */
export const MatchedName = ({
  name,
  query,
  from = 0,
  to = name.length,
}: {
  readonly name: string
  readonly query: string | undefined
  readonly from?: number
  readonly to?: number
}) => {
  const needle = query?.trim() ?? ''
  const at = needle === '' ? -1 : name.toLowerCase().indexOf(needle.toLowerCase())
  const start = Math.max(from, at)
  const end = Math.min(to, at + needle.length)
  if (at < 0 || start >= end) return <>{name.slice(from, to)}</>
  return (
    <>
      {name.slice(from, start)}
      {/* Round 5 U14: an underline, not 600, so a match never reads as the model in use. */}
      <span className="dshx:underline dshx:decoration-foreground/50 dshx:underline-offset-2" data-model-match>
        {name.slice(start, end)}
      </span>
      {name.slice(end, to)}
    </>
  )
}
