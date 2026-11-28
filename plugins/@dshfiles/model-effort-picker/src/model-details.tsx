import { useEffect, useState, type ReactNode } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Slider } from '@dshfiles/plugin-ui/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArrowLeftIcon, RotateCcwIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { accountColor } from './account-color.js'
import { ModelPickerModel, type InspectedRoute, type ModelQuota } from './model-picker-model.js'
import { BrandMark, InfoHint, ProviderLabel, QuotaPercent } from './picker-atoms.js'

type CatalogGroup = ModelDirectoryState['groups'][number]

export type { InspectedRoute }

/** What the details pane hands its Fast mode slot: the route, and on a draft the staged value to show and change. */
export interface FastSlotInput {
  readonly provider: string
  readonly model: string
  readonly draft: { readonly value: boolean | undefined; readonly onChange: (enabled: boolean) => void } | null
}

export const ModelDetails = (props: {
  readonly inspected: InspectedRoute | null
  readonly groups: readonly CatalogGroup[]
  readonly current: ModelSelection | null
  readonly busy: boolean
  readonly error: string | null
  readonly accountAccents: ReadonlyMap<string, string>
  readonly providerLabels: ReadonlyMap<string, string>
  /** What is left on each account (b:16yr): the list shows one row per model, so the account is chosen here. */
  readonly quotas: ReadonlyMap<string, ModelQuota>
  readonly onBack: () => void
  readonly onClose: () => void
  readonly onRetry: () => void
  readonly onInspect: (route: InspectedRoute) => void
  /** Applies a change to the thread's own model in place. */
  readonly onSelect: (selection: ModelSelection) => void
  /** Commits a draft: the staged account and effort, then the staged Fast mode when one was chosen. */
  readonly onUse: (selection: ModelSelection, fast: boolean | undefined) => void
  /** The Fast mode control for the inspected route; hooks live with the caller so this pane renders without a Host. */
  readonly fast?: ((input: FastSlotInput) => ReactNode) | undefined
  /** The thread's fallback chain; shown only on the thread's own model (a draft has no chain of its own). */
  readonly fallbacks?: ReactNode
}) => {
  const group = props.inspected === null ? undefined : props.groups.find(candidate => candidate.id === props.inspected?.provider)
  const model = group?.models.find(candidate => candidate.id === props.inspected?.model)
  const draft = ModelPickerModel.isDraft({ inspected: props.inspected, current: props.current })
  const efforts = model?.reasoning?.efforts ?? []
  // A draft stages its effort and Fast mode here; nothing reaches the thread until Use.
  const [stagedEffort, setStagedEffort] = useState<{ readonly value: string | undefined } | null>(null)
  const [stagedFast, setStagedFast] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    setStagedEffort(null)
    setStagedFast(undefined)
  }, [model?.id])
  const selectedEffort = draft
    ? stagedEffort === null
      ? model?.reasoning?.defaultEffort
      : stagedEffort.value
    : (props.current?.reasoningEffort ?? model?.reasoning?.defaultEffort)
  const effortIndex = Math.max(
    0,
    efforts.findIndex(effort => effort.id === selectedEffort),
  )
  const [sliderIndex, setSliderIndex] = useState(effortIndex)

  useEffect(() => {
    setSliderIndex(effortIndex)
  }, [effortIndex, group?.id, model?.id])

  const name = group === undefined || model === undefined ? undefined : ModelPickerModel.displayName({ group, model })
  const providerLabel = group === undefined ? undefined : props.providerLabels.get(group.id)
  const accounts = model === undefined ? [] : props.groups.filter(candidate => candidate.models.some(entry => entry.id === model.id))

  /** Effort: staged on a draft, applied in place on the thread's model, never a model switch. */
  const changeEffort = (reasoningEffort: string | undefined): void => {
    if (props.inspected === null) return
    const change = ModelPickerModel.detailsChange({ inspected: props.inspected, current: props.current, change: { reasoningEffort } })
    if (change.kind === 'stage') setStagedEffort({ value: reasoningEffort })
    else if (!props.busy) props.onSelect(change.selection)
  }

  const changeAccount = (account: CatalogGroup): void => {
    if (props.inspected === null || model === undefined) return
    props.onInspect({ model: model.id, provider: account.id })
    const change = ModelPickerModel.detailsChange({ inspected: props.inspected, current: props.current, change: { provider: account.id } })
    if (change.kind === 'apply') props.onSelect(change.selection)
  }

  const use = (): void => {
    if (props.inspected === null || model === undefined) return
    props.onUse(ModelPickerModel.draftSelection({ inspected: props.inspected, model, stagedEffort }), stagedFast)
  }

  return (
    <section aria-label="Model details" className="dshx:flex dshx:min-h-0 dshx:w-full dshx:min-w-0 dshx:flex-1 dshx:flex-col" data-model-details-draft={draft || undefined}>
      <header className="dshx:flex dshx:min-w-0 dshx:shrink-0 dshx:items-start dshx:gap-1.5 dshx:@max-pane-compact:min-h-12 dshx:@max-pane-compact:items-center">
        <button
          aria-label={draft ? 'Back to the model in use' : 'Back to models'}
          className={cn(
            'dshx:hidden dshx:size-6 dshx:pointer-coarse:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:@max-pane-compact:flex',
            draft && 'dshx:flex',
          )}
          data-model-details-back
          onClick={props.onBack}
          type="button"
        >
          <ArrowLeftIcon aria-hidden="true" className="dshx:size-4" />
        </button>
        {name === undefined || group === undefined || model === undefined ? (
          <p className="dshx:flex-1 dshx:text-sm dshx:font-medium dshx:text-muted-foreground">Pick a model</p>
        ) : (
          <>
            <BrandMark brand={ModelPickerModel.brandFor({ model })} className="dshx:size-[18px]" name={name} />
            <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
              <span className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-1 dshx:overflow-hidden">
                <h2 className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold dshx:leading-none" data-model-picker-current>
                  {name}
                </h2>
                {providerLabel === undefined ? null : <ProviderLabel className="dshx:max-w-[6.5rem]" label={providerLabel} />}
              </span>
              {draft ? (
                <span className="dshx:text-2xs dshx:text-muted-foreground" data-model-details-draft-caption>
                  Inspecting · not in use
                </span>
              ) : null}
            </span>
          </>
        )}
        {group !== undefined && model !== undefined && props.fast !== undefined
          ? props.fast({ provider: group.id, model: model.id, draft: draft ? { value: stagedFast, onChange: setStagedFast } : null })
          : null}
        <button
          aria-label="Close model picker"
          className="dshx:flex dshx:size-5 dshx:pointer-coarse:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
          onClick={props.onClose}
          type="button"
        >
          <XIcon aria-hidden="true" className="dshx:size-4" />
        </button>
      </header>

      <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto dshx:[overflow-x:clip]" data-model-details-body>
        <div className="dshx:mt-2 dshx:flex dshx:items-start dshx:gap-2">
          <p className="dshx:shrink-0 dshx:pt-1 dshx:text-2xs dshx:font-medium dshx:text-muted-foreground">Account</p>
          <div aria-label="Available accounts" className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:gap-1" data-model-account-chips>
            {accounts.map(account => {
              const quota = props.quotas.get(account.id)
              return (
                <Tooltip key={account.id}>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={account.name}
                      aria-pressed={group?.id === account.id}
                      className={cn(
                        'dshx:flex dshx:h-6 dshx:max-w-[10rem] dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:px-2 dshx:text-2xs dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                        group?.id === account.id && 'dshx:border-info/60 dshx:bg-info/10 dshx:text-foreground',
                      )}
                      disabled={props.busy && !draft}
                      onClick={() => changeAccount(account)}
                      type="button"
                    >
                      <i
                        aria-hidden="true"
                        className="dshx:size-1.5 dshx:shrink-0 dshx:rounded-full"
                        style={{ backgroundColor: props.accountAccents.get(account.id) ?? accountColor({ instanceId: account.id }) }}
                      />
                      <span className="dshx:min-w-0 dshx:truncate">{account.name}</span>
                      {quota === undefined ? null : <QuotaPercent onReserve={quota.onReserve} percent={quota.percent} />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {account.name}
                    {quota === undefined ? '' : ` · ${quota.label}: ${String(Math.round(quota.percent))}% left`}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>

        {props.error === null ? null : (
          <div
            className="dshx:mt-2 dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:rounded-md dshx:border dshx:border-destructive/30 dshx:bg-destructive/10 dshx:px-2 dshx:py-1.5"
            role="alert"
          >
            <p className="dshx:min-w-0 dshx:text-2xs dshx:text-destructive">{props.error}</p>
            <Button onClick={props.onRetry} size="xs" variant="outline">
              Retry
            </Button>
          </div>
        )}

        {model === undefined || props.inspected === null ? null : (
          <section aria-label="Reasoning effort" className="dshx:mt-2.5 dshx:flex dshx:flex-col dshx:gap-1">
            <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
              <span className="dshx:flex dshx:items-center dshx:gap-1">
                <p className="dshx:text-2xs dshx:font-medium">Reasoning effort</p>
                <InfoHint description="Higher effort lets the model think for longer before it answers." />
              </span>
              <button
                aria-pressed={selectedEffort === undefined}
                className={cn(
                  'dshx:flex dshx:items-center dshx:gap-1 dshx:rounded dshx:px-1 dshx:py-0.5 dshx:text-2xs dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                  selectedEffort === undefined && 'dshx:text-foreground',
                )}
                onClick={() => changeEffort(undefined)}
                type="button"
              >
                <RotateCcwIcon aria-hidden="true" className="dshx:size-3" />
                Default
              </button>
            </div>
            {efforts.length === 0 ? (
              <p className="dshx:text-2xs dshx:text-muted-foreground">This model has no reasoning levels.</p>
            ) : (
              <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
                <div className="dshx:relative dshx:py-0.5">
                  <Slider
                    aria-label="Reasoning effort"
                    className="dshx:[&_[data-slot=slider-range]]:bg-info dshx:[&_[data-slot=slider-thumb]]:z-[2] dshx:[&_[data-slot=slider-thumb]]:size-4 dshx:[&_[data-slot=slider-thumb]]:border-2 dshx:[&_[data-slot=slider-thumb]]:border-info dshx:[&_[data-slot=slider-thumb]]:bg-white dshx:[&_[data-slot=slider-track]]:h-1 dshx:[&_[data-slot=slider-track]]:bg-muted-foreground/25"
                    data-model-effort-slider
                    max={efforts.length - 1}
                    min={0}
                    onValueChange={(values: number[]) => setSliderIndex(values[0] ?? 0)}
                    onValueCommit={(values: number[]) => {
                      const effort = efforts[values[0] ?? 0]
                      if (effort !== undefined) changeEffort(effort.id)
                    }}
                    step={1}
                    value={[Math.min(sliderIndex, efforts.length - 1)]}
                  />
                  {efforts.length > 1 && (
                    <div aria-hidden="true" className="dshx:pointer-events-none dshx:absolute dshx:inset-x-0 dshx:top-[6px] dshx:h-1">
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
                <div className="dshx:relative dshx:h-3.5" data-model-effort-options>
                  {efforts.map((effort, index) => (
                    <button
                      aria-pressed={index === effortIndex}
                      className={cn(
                        'dshx:absolute dshx:top-0 dshx:min-w-0 dshx:whitespace-nowrap dshx:rounded-sm dshx:px-0.5 dshx:text-2xs dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                        index === 0 ? 'dshx:translate-x-0' : index === efforts.length - 1 ? 'dshx:-translate-x-full' : 'dshx:-translate-x-1/2',
                        index === effortIndex && 'dshx:font-semibold dshx:text-foreground',
                      )}
                      data-model-effort-option
                      key={effort.id}
                      onClick={() => changeEffort(effort.id)}
                      style={{ left: `calc(8px + (100% - 16px) * ${index} / ${Math.max(1, efforts.length - 1)})` }}
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

        {draft ? null : props.fallbacks}
      </div>

      {draft && name !== undefined ? (
        <footer className="dshx:mt-2 dshx:flex dshx:shrink-0 dshx:justify-end" data-model-details-use>
          <Button className="dshx:h-8 dshx:pointer-coarse:h-11" disabled={props.busy} onClick={use} type="button">
            Use {name}
          </Button>
        </footer>
      ) : null}
    </section>
  )
}
