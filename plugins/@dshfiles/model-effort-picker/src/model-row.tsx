import { useRef, useState } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { aiAccountsFastModeApi } from '@dshfiles/ai-accounts/model-fast-mode-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@dshfiles/plugin-ui/components/ui/hover-card'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { accountColor } from './account-color.js'
import { effortGlyph } from './effort-levels.js'
import { ModelPickerModel, type ModelQuota } from './model-picker-model.js'
import { AccountBadge, BrandMark, EffortBars, ProviderLabel, QuotaText } from './picker-atoms.js'

type CatalogGroup = ModelDirectoryState['groups'][number]
type CatalogModel = CatalogGroup['models'][number]

type FastModeRoute = { readonly sessionId: string; readonly provider: string; readonly model: string }

/**
 * Mounted with every row so its answer is already there when a pointer arrives; the row reveals the switch on hover
 * and keeps it visible while Fast mode is on.
 */
const FastModeToggle = ({ input, modelName, busy }: { readonly input: FastModeRoute; readonly modelName: string; readonly busy: boolean }) => {
  const state = useApiQuery(aiAccountsFastModeApi, 'status', { input })
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

type EffortPickerProps = {
  readonly efforts: NonNullable<CatalogModel['reasoning']>['efforts']
  readonly effortIndex: number
  readonly busy: boolean
  readonly onSelect: (index: number) => void
}

const EffortPicker = ({ efforts, effortIndex, busy, onSelect }: EffortPickerProps) => {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const total = efforts.length
  return (
    <HoverCard closeDelay={80} onOpenChange={setOpen} open={open} openDelay={120}>
      <HoverCardTrigger asChild>
        <button
          aria-label={total === 0 ? 'No reasoning levels' : `Reasoning effort: ${efforts[effortIndex]?.name ?? 'Default'}`}
          className="dshx:flex dshx:size-[18px] dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:outline-none dshx:hover:bg-muted dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
          data-model-effort-trigger
          disabled={total === 0}
          onClick={() => setOpen(true)}
          ref={triggerRef}
          type="button"
        >
          <EffortBars glyph={effortGlyph({ index: effortIndex, total })} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="dshx-root dshx:w-auto dshx:p-1.5" collisionPadding={8} data-model-effort-popover side="bottom" sideOffset={4}>
        <p className="dshx:px-1 dshx:pb-1.5 dshx:text-[10px] dshx:font-medium dshx:text-muted-foreground">Reasoning effort</p>
        <div className="dshx:flex dshx:items-stretch dshx:gap-0.5">
          {efforts.map((effort, index) => (
            <button
              aria-label={effort.name}
              aria-pressed={index === effortIndex}
              className={cn(
                'dshx:flex dshx:min-w-10 dshx:flex-col dshx:items-center dshx:gap-1 dshx:rounded dshx:px-1 dshx:py-1 dshx:text-[10px] dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                index === effortIndex && 'dshx:bg-info/10 dshx:font-semibold dshx:text-foreground dshx:ring-1 dshx:ring-info/60',
              )}
              data-model-effort-option
              disabled={busy}
              key={effort.id}
              onClick={() => {
                onSelect(index)
                setOpen(false)
                triggerRef.current?.focus()
              }}
              type="button"
            >
              <EffortBars className="dshx:h-4 dshx:w-3.5" glyph={effortGlyph({ index, total })} />
              <span className="dshx:whitespace-nowrap">{effort.name}</span>
            </button>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

export const ModelRow = (props: {
  readonly group: CatalogGroup
  readonly model: CatalogModel
  readonly active: boolean
  readonly busy: boolean
  readonly sessionId: string
  readonly quota: ModelQuota | undefined
  readonly accountAccent: string | undefined
  readonly providerLabel: string | undefined
  readonly current: ModelSelection | null
  readonly onSelect: (selection: ModelSelection) => void
  readonly onInspect: () => void
  readonly onEffort: (selection: ModelSelection) => void
}) => {
  const efforts = props.model.reasoning?.efforts ?? []
  const selectedEffort = props.active ? (props.current?.reasoningEffort ?? props.model.reasoning?.defaultEffort) : props.model.reasoning?.defaultEffort
  const effortIndex = Math.max(
    0,
    efforts.findIndex(effort => effort.id === selectedEffort),
  )
  const name = ModelPickerModel.displayName({ group: props.group, model: props.model })
  const brand = ModelPickerModel.brandFor({ model: props.model })
  const accountLabel = ModelPickerModel.accountTag({ name: props.group.name, provider: props.providerLabel })

  return (
    <div
      className={cn(
        'dshx:group/row dshx:flex dshx:h-7 dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:px-1.5 dshx:transition-colors dshx:hover:bg-accent/60',
        props.active && 'dshx:bg-info/10 dshx:ring-1 dshx:ring-info/60',
      )}
      data-model-picker-row
    >
      <button
        aria-label={`Use ${name}${props.providerLabel === undefined ? '' : ` via ${props.providerLabel}`} (${props.group.name})`}
        aria-pressed={props.active}
        className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:overflow-hidden dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
        data-model-picker-option
        disabled={props.busy}
        onClick={() => props.onSelect(ModelPickerModel.selectionForModel(props.group, props.model, props.current))}
        type="button"
      >
        <BrandMark brand={brand} className="dshx:size-4" name={name} />
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1 dshx:overflow-hidden">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-[11px] dshx:font-medium">{name}</span>
            </TooltipTrigger>
            <TooltipContent side="top">{name}</TooltipContent>
          </Tooltip>
          {props.providerLabel === undefined ? null : (
            <>
              <span aria-hidden="true" className="dshx:shrink-0 dshx:text-[10px] dshx:text-muted-foreground/50">
                ·
              </span>
              <ProviderLabel className="dshx:max-w-[7rem]" label={props.providerLabel} />
            </>
          )}
        </span>
      </button>
      <AccountBadge
        className="dshx:max-w-[9rem] dshx:shrink"
        color={accountColor({ accentColor: props.accountAccent, instanceId: props.group.id })}
        label={accountLabel}
        name={props.group.name}
      />
      <span className="dshx:flex dshx:w-7 dshx:shrink-0 dshx:justify-end">
        {props.quota === undefined ? null : <QuotaText label={props.quota.label} onReserve={props.quota.onReserve} percent={props.quota.percent} />}
      </span>
      <EffortPicker
        busy={props.busy}
        effortIndex={effortIndex}
        efforts={efforts}
        onSelect={index => {
          const effort = efforts[index]
          if (effort === undefined) return
          const target = props.active && props.current !== null ? props.current : ModelPickerModel.selectionForModel(props.group, props.model, props.current)
          props.onEffort(ModelPickerModel.selectionForEffort(target, effort.id))
        }}
      />
      <span
        className="dshx:flex dshx:min-w-6 dshx:shrink-0 dshx:items-center dshx:justify-center"
        onClick={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
      >
        <FastModeToggle busy={props.busy} input={{ sessionId: props.sessionId, model: props.model.id, provider: props.group.id }} modelName={name} />
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
