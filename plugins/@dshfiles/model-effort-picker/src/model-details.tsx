import { useEffect, useState } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Slider } from '@dshfiles/plugin-ui/components/ui/slider'
import { ArrowLeftIcon, RotateCcwIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { accountColor } from './account-color.js'
import { FallbacksSection } from './fallbacks-section.js'
import { FastModeSection } from './fast-mode-section.js'
import { ModelPickerModel } from './model-picker-model.js'
import { AccountBadge, BrandMark, InfoHint } from './picker-atoms.js'

type CatalogGroup = ModelDirectoryState['groups'][number]

export type InspectedRoute = { readonly provider: string; readonly model: string }

export const ModelDetails = (props: {
  readonly inspected: InspectedRoute | null
  readonly groups: readonly CatalogGroup[]
  readonly current: ModelSelection | null
  readonly sessionId: string
  readonly busy: boolean
  readonly error: string | null
  readonly accountAccents: ReadonlyMap<string, string>
  readonly accountBadges: ReadonlyMap<string, string>
  readonly onBack: () => void
  readonly onClose: () => void
  readonly onRetry: () => void
  readonly onInspect: (route: InspectedRoute) => void
  readonly onSelect: (selection: ModelSelection) => void
  readonly onFastModeChange: (enabled: boolean) => void
}) => {
  const group = props.inspected === null ? undefined : props.groups.find(candidate => candidate.id === props.inspected?.provider)
  const model = group?.models.find(candidate => candidate.id === props.inspected?.model)
  const efforts = model?.reasoning?.efforts ?? []
  const sameRoute = props.inspected !== null && props.current?.provider === props.inspected.provider && props.current.model === props.inspected.model
  const selectedEffort = sameRoute ? (props.current?.reasoningEffort ?? model?.reasoning?.defaultEffort) : model?.reasoning?.defaultEffort
  const effortIndex = Math.max(
    0,
    efforts.findIndex(effort => effort.id === selectedEffort),
  )
  const [sliderIndex, setSliderIndex] = useState(effortIndex)

  useEffect(() => {
    setSliderIndex(effortIndex)
  }, [effortIndex, group?.id, model?.id])

  const selection: ModelSelection | null =
    group === undefined || model === undefined
      ? null
      : {
          provider: group.id,
          model: model.id,
          ...(props.current?.provider === group.id && props.current.model === model.id && props.current.reasoningEffort !== undefined
            ? { reasoningEffort: props.current.reasoningEffort }
            : {}),
        }
  const name = group === undefined || model === undefined ? undefined : ModelPickerModel.displayName({ group, model })
  const accent = group === undefined ? undefined : (props.accountAccents.get(group.id) ?? accountColor({ instanceId: group.id }))
  const accounts = model === undefined ? [] : props.groups.filter(candidate => candidate.models.some(entry => entry.id === model.id))

  return (
    <section aria-label="Model details" className="dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col">
      <header className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
        <button
          aria-label="Back to models"
          className="dshx:hidden dshx:size-6 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:@max-pane-compact:flex"
          onClick={props.onBack}
          type="button"
        >
          <ArrowLeftIcon aria-hidden="true" className="dshx:size-4" />
        </button>
        {name === undefined || group === undefined || model === undefined ? (
          <p className="dshx:flex-1 dshx:text-sm dshx:font-medium dshx:text-muted-foreground">Pick a model</p>
        ) : (
          <>
            <BrandMark brand={ModelPickerModel.brandFor({ model })} className="dshx:size-5" name={name} />
            <h2 className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-[14px] dshx:font-semibold dshx:leading-none" data-model-picker-current>
              {name}
            </h2>
            {accent === undefined ? null : (
              <AccountBadge
                className="dshx:max-w-[4.5rem] dshx:h-[18px] dshx:text-[9.5px]"
                color={accent}
                name={props.accountBadges.get(group.id) || group.name}
              />
            )}
          </>
        )}
        {group !== undefined && model !== undefined && (
          <FastModeSection
            disabled={props.busy}
            key={`${props.sessionId}:${group.id}:${model.id}`}
            model={model.id}
            onEnabledChange={props.onFastModeChange}
            provider={group.id}
            sessionId={props.sessionId}
          />
        )}
        <button
          aria-label="Close model picker"
          className="dshx:flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
          onClick={props.onClose}
          type="button"
        >
          <XIcon aria-hidden="true" className="dshx:size-4" />
        </button>
      </header>

      <div className="dshx:my-2.5 dshx:border-b dshx:border-border" />

      <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
        <p className="dshx:text-[11px] dshx:font-medium dshx:text-muted-foreground">Account</p>
        <div aria-label="Available accounts" className="dshx:flex dshx:flex-wrap dshx:gap-1.5" data-model-account-chips>
          {accounts.map(account => (
            <button
              aria-pressed={group?.id === account.id}
              className={cn(
                'dshx:flex dshx:h-6 dshx:max-w-[9rem] dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:px-2 dshx:text-[11px] dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                group?.id === account.id && 'dshx:border-info/60 dshx:bg-info/10 dshx:text-foreground',
              )}
              disabled={props.busy}
              key={account.id}
              onClick={() => {
                const target = account.models.find(entry => entry.id === model?.id)
                if (target === undefined || model === undefined) return
                props.onInspect({ model: model.id, provider: account.id })
                props.onSelect(ModelPickerModel.selectionForModel(account, target, props.current))
              }}
              type="button"
            >
              <i
                aria-hidden="true"
                className="dshx:size-1.5 dshx:shrink-0 dshx:rounded-full"
                style={{ backgroundColor: props.accountAccents.get(account.id) ?? accountColor({ instanceId: account.id }) }}
              />
              <span className="dshx:min-w-0 dshx:truncate">{account.name}</span>
            </button>
          ))}
        </div>
      </div>

      {props.error === null ? null : (
        <div
          className="dshx:mt-2 dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:rounded-md dshx:border dshx:border-destructive/30 dshx:bg-destructive/10 dshx:px-2 dshx:py-1.5"
          role="alert"
        >
          <p className="dshx:min-w-0 dshx:text-[11px] dshx:text-destructive">{props.error}</p>
          <Button onClick={props.onRetry} size="xs" variant="outline">
            Retry
          </Button>
        </div>
      )}

      {selection === null ? null : (
        <section aria-label="Reasoning effort" className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1.5">
          <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
            <span className="dshx:flex dshx:items-center dshx:gap-1">
              <p className="dshx:text-xs dshx:font-medium">Reasoning effort</p>
              <InfoHint description="Higher effort lets the model think for longer before it answers." />
            </span>
            {
              <button
                aria-pressed={selection.reasoningEffort === undefined}
                className={cn(
                  'dshx:flex dshx:items-center dshx:gap-1 dshx:rounded dshx:px-1 dshx:py-0.5 dshx:text-[10px] dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                  selection.reasoningEffort === undefined && 'dshx:text-foreground',
                )}
                disabled={props.busy}
                onClick={() => props.onSelect(ModelPickerModel.selectionForEffort(selection, undefined))}
                type="button"
              >
                <RotateCcwIcon aria-hidden="true" className="dshx:size-3" />
                Default
              </button>
            }
          </div>
          {efforts.length === 0 ? (
            <p className="dshx:text-[11px] dshx:text-muted-foreground">This model has no reasoning levels.</p>
          ) : (
            <div className="dshx:flex dshx:flex-col dshx:gap-1">
              <div className="dshx:relative dshx:py-1">
                <Slider
                  aria-label="Reasoning effort"
                  className="dshx:[&_[data-slot=slider-range]]:bg-info dshx:[&_[data-slot=slider-thumb]]:z-[2] dshx:[&_[data-slot=slider-thumb]]:size-4 dshx:[&_[data-slot=slider-thumb]]:border-2 dshx:[&_[data-slot=slider-thumb]]:border-info dshx:[&_[data-slot=slider-thumb]]:bg-white dshx:[&_[data-slot=slider-track]]:h-1 dshx:[&_[data-slot=slider-track]]:bg-muted-foreground/25"
                  data-model-effort-slider
                  disabled={props.busy}
                  max={efforts.length - 1}
                  min={0}
                  onValueChange={(values: number[]) => setSliderIndex(values[0] ?? 0)}
                  onValueCommit={(values: number[]) => {
                    const effort = efforts[values[0] ?? 0]
                    if (effort !== undefined) props.onSelect(ModelPickerModel.selectionForEffort(selection, effort.id))
                  }}
                  step={1}
                  value={[Math.min(sliderIndex, efforts.length - 1)]}
                />
                {efforts.length > 1 && (
                  <div aria-hidden="true" className="dshx:pointer-events-none dshx:absolute dshx:inset-x-0 dshx:top-[10px] dshx:h-1">
                    {efforts.map((effort, index) => (
                      <span
                        className="dshx:absolute dshx:h-1.5 dshx:w-px dshx:-translate-x-1/2 dshx:rounded-full dshx:bg-foreground/25"
                        key={effort.id}
                        style={{ left: `calc(8px + (100% - 16px) * ${index} / ${efforts.length - 1})` }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="dshx:flex dshx:justify-between dshx:gap-1" data-model-effort-options>
                {efforts.map((effort, index) => (
                  <button
                    aria-pressed={index === effortIndex}
                    className={cn(
                      'dshx:min-w-0 dshx:truncate dshx:rounded-sm dshx:px-0.5 dshx:text-[10px] dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                      index === effortIndex && 'dshx:font-semibold dshx:text-foreground',
                    )}
                    data-model-effort-option
                    disabled={props.busy}
                    key={effort.id}
                    onClick={() => props.onSelect(ModelPickerModel.selectionForEffort(selection, effort.id))}
                    type="button"
                  >
                    {effort.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <FallbacksSection accountAccents={props.accountAccents} busy={props.busy} current={props.current} groups={props.groups} sessionId={props.sessionId} />
    </section>
  )
}
