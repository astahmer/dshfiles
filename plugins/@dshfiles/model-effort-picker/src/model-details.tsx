import { useEffect, useState, type ReactNode } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArrowLeftIcon, CheckIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { AccountAccent } from './account-color.js'
import { AccountRows } from './account-rows.js'
import { ModelPickerModel, type InspectedRoute, type ModelQuota } from './model-picker-model.js'
import { EffortControl } from './effort-control.js'
import { BrandMark } from './picker-atoms.js'

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
  readonly accountAccents: ReadonlyMap<string, AccountAccent>
  readonly providerLabels: ReadonlyMap<string, string>
  /** What is left on each account (b:16yr): the list shows one row per model, so the account is chosen here. */
  readonly quotas: ReadonlyMap<string, ModelQuota>
  readonly onBack: () => void
  /** Unused since round 3 R17: the picker draws one Close for the whole surface, last in the Tab order. */
  readonly onClose?: () => void
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
      <header
        className="dshx:flex dshx:min-w-0 dshx:shrink-0 dshx:items-start dshx:gap-1.5 dshx:pr-7 dshx:pointer-coarse:pr-12 dshx:@max-pane-compact:min-h-12"
        data-model-details-header
      >
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
            <BrandMark brand={ModelPickerModel.brandFor({ model })} className="dshx:size-[18px] dshx:pointer-coarse:mt-[13px]" name={name} />
            {/* N1: the model on its own line (15 px (text-heading) / 600, up to two lines), the service and account below it. */}
            {/* Round 3 R13: on touch the title first line centres on the 44 pt Back and Close boxes beside it. */}
            <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5 dshx:pointer-coarse:pt-[13.5px]">
              <h2 className="dshx:line-clamp-2 dshx:text-heading dshx:leading-tight dshx:font-semibold dshx:break-words" data-model-picker-current>
                {name}
              </h2>
              <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground" data-model-details-route>
                {/* Round 3 R18: the account name already names its service ("Command Code 1"). */}
                {group.name}
              </span>
              {/* Round 3 R11: the header says whether the thread uses this model. */}
              {draft ? (
                <span className="dshx:text-2xs dshx:text-muted-foreground" data-model-details-draft-caption>
                  Inspecting · not in use
                </span>
              ) : (
                <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-2xs dshx:font-medium dshx:text-foreground" data-model-details-in-use>
                  <CheckIcon aria-hidden="true" className="dshx:size-3" />
                  In use
                </span>
              )}
            </span>
          </>
        )}
      </header>

      <div
        className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto dshx:[overflow-x:clip] dshx:[mask-image:linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-8px),transparent)]"
        data-model-details-body
      >
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
        <footer className="dshx:mt-2 dshx:flex dshx:min-w-0 dshx:shrink-0 dshx:justify-end" data-model-details-use>
          {/* Round 3 R1: the button never leaves the sheet. It truncates a long name (the full name is its accessible
              name) and spans the sheet at 44 pt on touch. */}
          <Button
            aria-label={`Use ${name}`}
            className="dshx:h-8 dshx:min-w-0 dshx:max-w-full dshx:pointer-coarse:h-11 dshx:pointer-coarse:w-full"
            disabled={props.busy}
            onClick={use}
            type="button"
          >
            <span className="dshx:min-w-0 dshx:truncate">Use {name}</span>
          </Button>
        </footer>
      ) : null}
    </section>
  )
}
