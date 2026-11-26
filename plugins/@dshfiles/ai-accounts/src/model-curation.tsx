import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { PageSection } from '@dshfiles/plugin-ui/components/page'
import { Empty, EmptyDescription } from '@dshfiles/plugin-ui/components/ui/empty'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { ActionHint } from './panel-primitives.js'
import { ModelMark } from '@dshfiles/plugin-ui/components/model-mark'
import { OverflowGlyph } from '@dshfiles/plugin-ui/components/ui/overflow-glyph'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, InfoIcon, PlusIcon, SearchIcon, StarIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
import type { AccountDraft, AccountsCatalog } from './api.js'
import { ModelCurationModel } from './model-curation-model.js'
import { AccountModelSettingsModel } from './account-model-settings.js'
import { KIND_LABEL } from './account-labels.js'

type CatalogModel = AccountsCatalog['models'][number]
export type CurationPatch = Partial<
  Pick<
    AccountDraft,
    'additionalModelIds' | 'hiddenModelIds' | 'favoriteModelIds' | 'modelOrder' | 'reasoningDefaults' | 'inheritModelSettings' | 'defaultReasoningEffort'
  >
>
const PROVIDER_DEFAULT = '__provider-default__'

/**
 * An inherited effort at rest (council round 11, D2): 13 px secondary text with a 12 px chevron beside it (the cell hugs
 * its value), no fill and no edge, so a column of "Auto" reads as values, not four settings. Hover, focus and open bring back the kit trigger: its fill, the
 * ink and the edges `triggerLook` keeps for those states.
 */
const INHERITED_EFFORT =
  'dshx:min-w-0 dshx:text-xs dshx:border-transparent dshx:bg-transparent dshx:text-muted-foreground dshx:[&>svg]:size-3 dshx:hover:bg-trigger-fill dshx:hover:text-foreground dshx:focus-visible:bg-trigger-fill dshx:focus-visible:text-foreground dshx:aria-expanded:bg-trigger-fill dshx:aria-expanded:text-foreground'

/** Provider inheritance suspends saved overrides; editing a row explicitly resumes account customization. */
export const ModelCuration = (props: {
  readonly account: AccountDraft
  readonly catalog: readonly CatalogModel[]
  readonly onChange: (patch: CurationPatch) => void
}): JSX.Element => {
  const { account } = props
  const [view, setView] = useState({ instanceId: account.instanceId, search: '', expanded: false, adding: false, modelId: '' })
  const current = view.instanceId === account.instanceId ? view : { instanceId: account.instanceId, search: '', expanded: false, adding: false, modelId: '' }
  const updateView = (patch: Partial<typeof view>): void => setView({ ...current, ...patch })
  const inherited = AccountModelSettingsModel.inheritsModelSettings(account)
  const effective = AccountModelSettingsModel.effectiveModelSettings(account)
  const catalog = ModelCurationModel.catalogForCuration({
    catalog: props.catalog,
    additionalModelIds: account.additionalModelIds,
    hiddenModelIds: account.hiddenModelIds,
  })
  const activeCatalog = inherited ? catalog.filter(model => !(model.accountAdditional ?? account.additionalModelIds.includes(model.id))) : catalog
  const ordered = ModelCurationModel.curationRows(activeCatalog, effective.modelOrder, current.search)
  const shown = current.expanded ? ordered : ordered.slice(0, 5)
  const hidden = new Set(effective.hiddenModelIds)
  const favorites = new Set(effective.favoriteModelIds)
  const customModelId = ModelCurationModel.parseAdditionalModelId(current.modelId, account)
  const duplicate = catalog.some(model => model.id === customModelId)
  const customize = (patch: CurationPatch): void => props.onChange({ ...patch, inheritModelSettings: false })
  const isCustom = (model: CatalogModel): boolean => model.accountAdditional ?? account.additionalModelIds.includes(model.id)
  const isOverridden = (model: CatalogModel): boolean => {
    const localEffort = effective.reasoningDefaults[model.id]
    return (
      !inherited &&
      (model.efforts.some(effort => effort.id === localEffort) ||
        model.efforts.some(effort => effort.id === effective.defaultReasoningEffort) ||
        hidden.has(model.id) ||
        favorites.has(model.id) ||
        effective.modelOrder.includes(model.id) ||
        isCustom(model))
    )
  }
  // When every row inherits, one caption above the table says so instead of an Inherited label on each row, and the
  // Source column goes (council round 10, D2).
  const allInherit = shown.every(model => !isOverridden(model))
  // Inherited rows read "Auto"; the column header says once where Auto comes from (council round 17, D1).
  const autoSources = new Set(
    shown
      .filter(model => model.efforts.length > 0 && !model.efforts.some(effort => effort.id === effective.reasoningDefaults[model.id]))
      .map(model => (model.efforts.some(effort => effort.id === effective.defaultReasoningEffort) ? 'account' : 'provider')),
  )
  const autoNote = autoSources.size > 1 ? 'Auto: account or provider' : autoSources.has('account') ? 'Auto: account default' : 'Auto: provider default'
  const addModel = (): void => {
    if (customModelId === null || duplicate) return
    customize({ additionalModelIds: [...new Set([...account.additionalModelIds, customModelId])] })
    updateView({ modelId: '' })
  }
  const membership = (ids: readonly string[], id: string, included: boolean): string[] =>
    included ? [...new Set([...ids, id])] : ids.filter(candidate => candidate !== id)
  const move = (id: string, delta: number): void => {
    const next = ModelCurationModel.curationRows(activeCatalog, effective.modelOrder, '').map(model => model.id)
    const index = next.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    customize({ modelOrder: next })
  }
  const toggleFavorite = (modelId: string): void => {
    // Inherited rows display native values, not paused local membership. Resume the clicked value without losing unrelated local favorites.
    const savedFavorites = account.favoriteModelIds.filter(id => id !== modelId)
    if (favorites.has(modelId)) savedFavorites.push(modelId)
    customize(
      ModelCurationModel.toggleFavoriteModel({
        modelId,
        orderedModelIds: ModelCurationModel.curationRows(catalog, account.modelOrder, '').map(model => model.id),
        favoriteModelIds: savedFavorites,
        hiddenModelIds: account.hiddenModelIds,
      }),
    )
  }
  const setEffort = (model: CatalogModel, value: string): void => {
    if (value !== PROVIDER_DEFAULT && !model.efforts.some(effort => effort.id === value)) return
    const next = { ...account.reasoningDefaults }
    if (value === PROVIDER_DEFAULT) delete next[model.id]
    else next[model.id] = value
    customize({ reasoningDefaults: next })
  }
  return (
    <PageSection
      // The Models tab names this section; its heading stays for assistive tech only (council round 4, D2).
      className="dshx-root dshx:@container dshx:gap-3 dshx:[&>div:first-child]:sr-only"
      description={`Choose which models from ${KIND_LABEL[account.kind]} are available for this account.`}
      heading="Models"
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3 dshx:@max-pane-narrow:flex-wrap">
        <Combobox
          label="Model settings mode"
          value={inherited ? 'inherit' : 'customize'}
          options={[
            { value: 'inherit', label: 'Inherit from provider defaults' },
            { value: 'customize', label: 'Customize for this account' },
          ]}
          onValueChange={value => props.onChange({ inheritModelSettings: value === 'inherit' })}
          triggerClassName="dshx:w-56 dshx:@max-pane-narrow:w-full"
        />
        <div className="dshx:relative dshx:w-48 dshx:min-w-0 dshx:@max-pane-narrow:w-full">
          <SearchIcon
            aria-hidden
            className="dshx:pointer-events-none dshx:absolute dshx:top-1/2 dshx:left-2.5 dshx:size-4 dshx:-translate-y-1/2 dshx:text-muted-foreground"
          />
          <Input
            aria-label="Search models"
            type="search"
            placeholder="Search models…"
            value={current.search}
            onChange={event => updateView({ search: event.target.value, expanded: false })}
            className="dshx:pl-8"
          />
        </div>
      </div>
      {/* The header's account switch overrides every row's "Show model": say so where the rows are (council round 9, D3). */}
      {account.enabled ? null : (
        <p className="dshx:text-xs dshx:text-muted-foreground" data-account-hidden-note>
          This account is hidden, so none of its models show in the model picker. Turn on Show this account to use them.
        </p>
      )}
      {/* Rows separate by hairlines; the detail pane is the only frame. */}
      <div className="dshx:overflow-x-auto dshx:border-y">
        <table className="dshx:w-full dshx:min-w-[600px] dshx:border-collapse dshx:text-sm">
          <thead className="dshx:border-b dshx:text-left dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
            <tr className="dshx:align-top">
              {/* Starts on the names: the cell's 8 px, the 24 px star, the 16 px mark and two 8 px gaps (council round 10, D2). */}
              <th className="dshx:py-2 dshx:pr-3 dshx:pl-16 dshx:font-normal">Model</th>
              {/* One line, starting on the values: the cell's 12 px, the trigger's 1 px edge and 8 px inset; Auto's source is
                  the ⓘ's tooltip (council round 18, D1). */}
              <th className="dshx:w-48 dshx:py-2 dshx:pr-3 dshx:pl-[21px] dshx:font-normal dshx:whitespace-nowrap">
                <span className="dshx:inline-flex dshx:items-center dshx:gap-1">
                  Reasoning effort
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="dshx:inline-flex dshx:rounded-sm dshx:text-muted-foreground dshx:hover:text-foreground">
                        <InfoIcon aria-hidden className="dshx:size-3" />
                        <span data-effort-auto-note className="dshx:sr-only">
                          {autoNote}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{autoNote}</TooltipContent>
                  </Tooltip>
                </span>
              </th>
              <th className="dshx:w-28 dshx:px-3 dshx:py-2 dshx:text-center dshx:font-normal">Show model</th>
              {allInherit ? null : <th className="dshx:w-28 dshx:px-3 dshx:py-2 dshx:font-normal">Source</th>}
              <th className="dshx:w-10">
                <span className="dshx:sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(model => {
              const favorite = favorites.has(model.id)
              const localEffort = effective.reasoningDefaults[model.id]
              const validEffort = model.efforts.some(effort => effort.id === localEffort) ? localEffort : undefined
              const custom = isCustom(model)
              const overridden = isOverridden(model)
              const fullOrder = ModelCurationModel.curationRows(activeCatalog, effective.modelOrder, '')
              const index = fullOrder.findIndex(candidate => candidate.id === model.id)
              const accountEffort = model.efforts.find(effort => effort.id === effective.defaultReasoningEffort)
              const nativeEffort = model.efforts.find(effort => effort.id === model.defaultEffort)
              // Each row says where its effort comes from, so no caption above the table repeats it (council round 12, D3).
              const defaultSource = accountEffort === undefined ? 'Provider' : 'Account'
              const defaultValue = accountEffort?.name ?? nativeEffort?.name ?? 'Auto'
              const defaultLabel = `${defaultSource} default · ${defaultValue}`
              // An inherited cell reads "Auto" with its chevron; the menu and the name keep the full provenance (council round 17, D1).
              const autoLabel = defaultValue === 'Auto' ? `Auto (${defaultSource} default)` : `Auto (${defaultLabel})`
              const inheritedEffort = validEffort === undefined && model.efforts.length > 0
              return (
                <tr key={model.id} className="dshx:border-b dshx:last:border-b-0 dshx:hover:bg-muted/20">
                  <td className="dshx:px-2 dshx:py-2">
                    <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                      <Button
                        aria-label={favorite ? `Unstar ${model.name}` : `Star ${model.name}`}
                        aria-pressed={favorite}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                        className={cn(favorite ? 'dshx:text-warning' : 'dshx:text-muted-foreground')}
                        onClick={() => toggleFavorite(model.id)}
                      >
                        <StarIcon className={cn(favorite && 'dshx:fill-current')} />
                      </Button>
                      <ModelMark modelId={model.id} />
                      <ActionHint label={model.id}>
                        {/* A span at 500: the Host's unlayered strong weight would outrank the utility (council round 10, D2). */}
                        <span tabIndex={0} className="dshx:min-w-0 dshx:truncate dshx:font-medium">
                          {model.name}
                        </span>
                      </ActionHint>
                      {custom ? (
                        <span className="dshx:rounded-full dshx:bg-muted dshx:px-2 dshx:py-0.5 dshx:text-xs dshx:text-muted-foreground">Custom</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="dshx:px-3 dshx:py-1.5">
                    <Combobox
                      label={`Default reasoning effort for ${model.name}${inheritedEffort ? `, ${autoLabel}` : ''}`}
                      searchLabel={`Default reasoning effort for ${model.name} search`}
                      trigger={
                        inheritedEffort ? (
                          <span data-effort-value className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm">
                            Auto
                          </span>
                        ) : undefined
                      }
                      value={validEffort ?? PROVIDER_DEFAULT}
                      disabled={model.efforts.length === 0}
                      options={[
                        { value: PROVIDER_DEFAULT, label: model.efforts.length === 0 ? 'Not supported' : autoLabel },
                        ...model.efforts.map(effort => ({ value: effort.id, label: effort.name })),
                      ]}
                      onValueChange={value => setEffort(model, value)}
                      // The table's one field look, the same as the mode and search fields above it (council round 5, D2),
                      // sized to its value so the width goes to model names (council round 7, D2). An inherited value is
                      // quiet text with a small chevron; the chip shows on hover, focus and open, and on an overridden row
                      // (council round 11, D2).
                      triggerClassName={cn(
                        'dshx:w-fit dshx:min-w-24 dshx:max-w-full dshx:px-2 dshx:disabled:[&>svg]:hidden',
                        validEffort === undefined && INHERITED_EFFORT,
                      )}
                    />
                  </td>
                  <td className="dshx:px-3 dshx:py-2">
                    {/* Centred under its header (council round 18, D1). */}
                    <div className="dshx:flex dshx:justify-center">
                      <Checkbox
                        size="sm"
                        aria-label={`Show ${model.name} in the picker`}
                        checked={!hidden.has(model.id)}
                        onCheckedChange={checked => customize({ hiddenModelIds: membership(account.hiddenModelIds, model.id, checked !== true) })}
                      />
                    </div>
                  </td>
                  {allInherit ? null : (
                    <td className="dshx:px-3 dshx:py-2">
                      <span
                        className={cn(
                          'dshx:text-xs',
                          overridden ? 'dshx:rounded-full dshx:bg-accent dshx:px-2 dshx:py-1 dshx:text-accent-foreground' : 'dshx:text-muted-foreground',
                        )}
                      >
                        {overridden ? 'Overridden' : 'Inherited'}
                      </span>
                    </td>
                  )}
                  <td className="dshx:pr-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-label={`Actions for ${model.name}`} size="icon-xs" type="button" variant="ghost">
                          <OverflowGlyph />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={index === 0} onSelect={() => move(model.id, -1)}>
                          <ChevronUpIcon />
                          Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={index === fullOrder.length - 1} onSelect={() => move(model.id, 1)}>
                          <ChevronDownIcon />
                          Move down
                        </DropdownMenuItem>
                        {custom ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                const patch = ModelCurationModel.removeAdditionalModel({ account, modelId: model.id })
                                if (patch !== null) customize(patch)
                              }}
                            >
                              <Trash2Icon />
                              Remove additional model
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {ordered.length > 5 ? (
          <Button
            className="dshx:w-full dshx:justify-start dshx:rounded-none dshx:border-t dshx:px-4 dshx:text-xs"
            type="button"
            variant="ghost"
            onClick={() => updateView({ expanded: !current.expanded })}
          >
            {current.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            {current.expanded ? 'Show fewer models' : `Show ${ordered.length - 5} more models`}
          </Button>
        ) : null}
        {ordered.length === 0 ? (
          <Empty className="dshx:p-4">
            <EmptyDescription>
              {catalog.length === 0 ? 'No models returned yet. Sign in, then refresh the provider catalog.' : 'No models match this search.'}
            </EmptyDescription>
          </Empty>
        ) : null}
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <Button variant="ghost" size="sm" type="button" aria-expanded={current.adding} onClick={() => updateView({ adding: !current.adding })}>
          <PlusIcon />
          Add custom model
        </Button>
        <div className="dshx:flex dshx:items-center dshx:gap-3">
          <span className="dshx:text-xs dshx:text-muted-foreground">
            {activeCatalog.filter(model => !hidden.has(model.id)).length} shown · {activeCatalog.length} available
          </span>
          {/* The bulk verb sits in a menu at the table's end, in ink, not a bare button (council round 18, D1). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost" type="button" disabled={activeCatalog.length === 0}>
                Model actions
                <ChevronDownIcon aria-hidden className="dshx:opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  const allHidden = activeCatalog.every(model => hidden.has(model.id))
                  customize({
                    hiddenModelIds: allHidden
                      ? account.hiddenModelIds.filter(id => !activeCatalog.some(model => model.id === id))
                      : [...new Set([...account.hiddenModelIds, ...activeCatalog.map(model => model.id)])],
                  })
                }}
              >
                {activeCatalog.length > 0 && activeCatalog.every(model => hidden.has(model.id)) ? 'Enable all' : 'Disable all'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {current.adding ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <div className="dshx:flex dshx:gap-2">
            <Input
              aria-label="Additional model ID"
              maxLength={120}
              className="dshx:min-w-0 dshx:flex-1 dshx:font-mono! dshx:text-xs"
              value={current.modelId}
              placeholder={account.kind === 'opencode-go' ? 'opencode-go/step-5-preview' : 'provider/model-id'}
              onChange={event => updateView({ modelId: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addModel()
                }
              }}
            />
            <Button size="sm" type="button" variant="outline" disabled={customModelId === null || duplicate} onClick={addModel}>
              Add model
            </Button>
          </div>
          <p className="dshx:text-xs dshx:text-muted-foreground">Add an ID the provider catalog does not return. The account/provider prefix is optional.</p>
        </div>
      ) : null}
    </PageSection>
  )
}
