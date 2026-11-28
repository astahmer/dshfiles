import { useEffect, useState, type ReactNode } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArrowLeftIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { AccountRows } from './account-rows.js'
import { ModelPickerModel, type InspectedRoute, type ModelQuota } from './model-picker-model.js'
import { EffortControl } from './effort-control.js'
import { BrandMark, ProviderLabel } from './picker-atoms.js'

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
  // Truthful (C1): the thread's own model shows the effort it chose, or the provider default when it chose none; a draft
  // shows what Use would commit.
  const selectedEffort = draft ? (stagedEffort === null ? model?.reasoning?.defaultEffort : stagedEffort.value) : props.current?.reasoningEffort

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
    <section
      aria-label="Model details"
      className="dshx:flex dshx:min-h-0 dshx:w-full dshx:min-w-0 dshx:flex-1 dshx:flex-col"
      data-model-details-draft={draft || undefined}
    >
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
        {model === undefined ? null : (
          <AccountRows
            accents={props.accountAccents}
            accounts={accounts}
            onChoose={accountId => {
              const account = accounts.find(candidate => candidate.id === accountId)
              if (account !== undefined) changeAccount(account)
            }}
            quotas={props.quotas}
            selected={group?.id}
          />
        )}

        {props.error === null ? null : (
          <div
            className="dshx:mt-2 dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:rounded-md dshx:border dshx:border-destructive/30 dshx:bg-destructive/10 dshx:px-2 dshx:py-1.5"
            role="alert"
          >
            <p className="dshx:min-w-0 dshx:text-2xs dshx:text-destructive">{props.error}</p>
            <Button className="dshx:pointer-coarse:h-11" onClick={props.onRetry} size="xs" variant="outline">
              Retry
            </Button>
          </div>
        )}

        {model === undefined || props.inspected === null ? null : <EffortControl efforts={efforts} onChange={changeEffort} selected={selectedEffort} />}

        {group !== undefined && model !== undefined && props.fast !== undefined
          ? props.fast({ provider: group.id, model: model.id, draft: draft ? { value: stagedFast, onChange: setStagedFast } : null })
          : null}

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
