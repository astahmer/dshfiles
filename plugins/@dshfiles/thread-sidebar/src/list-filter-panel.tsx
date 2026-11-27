/**
 * The thread list's Filter panel (round nine, owner annotation: "the menu feels a bit clunky"). It replaces a menu of
 * five submenus (Preset options, Group, Status, Source and, on a phone, Project) with one level: every choice shows its
 * value where it sits, so the current filter reads at a glance, and a change applies at once while the list stays in
 * view beside the panel. On a phone the kit turns the popover into the bottom sheet (plugin-ui styles, "Sheets, not
 * popovers"). The list (client.tsx) owns every value and write; this file only draws them.
 */
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { StatusGlyph, type WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { BookmarkPlusIcon, CheckIcon, ChevronDownIcon, RotateCcwIcon, SaveIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Fragment, useId, useState, type ReactNode } from 'react'
import type { ThreadAttentionLabel } from './attention-presentation.js'
import { threadStatusFilterGroupLabelKeys, threadStatusFilterLabelKeys, type ThreadSidebarTranslate } from './thread-view-manager.js'
import {
  THREAD_SOURCE_FILTER_OPTIONS,
  THREAD_STATUS_FILTER_GROUPS,
  THREAD_STATUS_FILTER_OPTIONS,
  type ThreadGroupBy,
  type ThreadSourceFilter,
  type ThreadStatusFilter,
} from './thread-view.js'

export interface ListFilterPreset {
  readonly id: string
  readonly label: string
  /** The former view tab's name: "Done (1), Turn finished". */
  readonly accessibleName: string
  readonly count: number | null
  /** The list's own glyph for what the preset counts (`presetMark`); none at a count of 0. */
  readonly mark: WorkStatus | undefined
}

/** Which status a preset's attention label stands for: the glyph its rows already draw for it. */
const ATTENTION_MARK = {
  threadSidebarApprovalNeeded: 'needs-you',
  threadSidebarInputNeeded: 'needs-you',
  threadSidebarTurnFinished: 'ready',
  threadSidebarNeedsResume: 'failed',
  threadSidebarInterrupted: 'failed',
} as const satisfies Record<ThreadAttentionLabel, WorkStatus>

/**
 * A preset's mark (council round 27, item 1): the list's glyph for the state its number counts (the indigo diamond for Needs
 * you, the green dot for Ready, the red cross for Failed, the ink ring for Working), never a generic dot, and nothing
 * while its count is 0.
 */
export const presetMark = (input: {
  readonly attentionLabel: ThreadAttentionLabel | undefined
  readonly count: number | null
  readonly countsWorking: boolean
}): WorkStatus | undefined => {
  if (input.count === 0) return undefined
  // The mark names what the number beside it counts: a view that lists working threads counts them, so it draws the
  // Working ring even when one of them also waits on the user.
  if (input.countsWorking && input.count !== null) return 'working'
  return input.attentionLabel === undefined ? undefined : ATTENTION_MARK[input.attentionLabel]
}

export interface ListFilterAction {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly disabled?: boolean | undefined
  readonly onSelect: () => void
}

export interface ListFilterPanelProps {
  readonly t: ThreadSidebarTranslate
  /** The phone scope: the project picker leads the sheet. */
  readonly project?: ReactNode | undefined
  readonly presets?: {
    readonly items: readonly ListFilterPreset[]
    readonly activeId: string
    readonly edited: boolean
    readonly onApply: (id: string) => void
    readonly onSaveChanges: () => void
    readonly onDiscard: () => void
    readonly onSaveAs: () => void
    /** The active preset's own verbs (rename, update, delete, mark read…), a small menu beside the heading. */
    readonly options: ReactNode
  } | undefined
  readonly status?: { readonly selected: readonly ThreadStatusFilter[]; readonly onChange: (filters: readonly ThreadStatusFilter[]) => void } | undefined
  readonly source?: { readonly value: ThreadSourceFilter; readonly onChange: (value: ThreadSourceFilter) => void } | undefined
  readonly group?: {
    readonly value: ThreadGroupBy
    readonly options: readonly ThreadGroupBy[]
    readonly labels: Readonly<Record<ThreadGroupBy, string>>
    readonly onChange: (value: ThreadGroupBy) => void
  } | undefined
  /** Each source's shown label ("Main") and its full name ("Main threads"), so the three fit one line. */
  readonly sourceLabels: Readonly<Record<ThreadSourceFilter, { readonly short: string; readonly name: string }>>
  /** Back to All threads with no filter on; disabled while nothing narrows the list. */
  readonly reset: { readonly disabled: boolean; readonly onReset: () => void }
  /** The list's other places and settings (Board, Thread list settings, Sidebar settings), quiet rows at the foot. */
  readonly actions: readonly ListFilterAction[]
}

/**
 * A chip: the quiet trigger fill at rest (no hairline: sixteen edged chips read as a form), the selected wash, the 3:1
 * field edge and the ink at 500 when on, so the choices in force read at a glance.
 */
const CHIP =
  'dshx:h-7 dshx:rounded-md dshx:border dshx:border-transparent dshx:bg-trigger-fill dshx:px-2.5 dshx:text-xs dshx:font-normal dshx:text-muted-foreground dshx:shadow-none dshx:hover:border-field-border dshx:hover:bg-trigger-fill dshx:hover:text-foreground dshx:data-[state=on]:border-field-border dshx:data-[state=on]:bg-selected-wash dshx:data-[state=on]:font-medium dshx:data-[state=on]:text-foreground dshx:pointer-coarse:h-9 dshx:pointer-coarse:px-3 dshx:pointer-coarse:text-sm'

const SECTION = 'dshx:grid dshx:gap-1.5 dshx:px-3 dshx:py-2.5'
/** A quiet verb row in a section, its glyph on the preset rows' check column. */
const QUIET_ROW = 'dshx:-mx-1.5 dshx:justify-start dshx:justify-self-stretch dshx:px-1.5 dshx:font-normal dshx:text-muted-foreground dshx:pointer-coarse:h-11'
const HEADING = 'dshx:text-xs dshx:font-medium dshx:text-muted-foreground'
const ALL_STATUSES = 'all'

const isStatusFilter = (value: string): value is ThreadStatusFilter =>
  value !== ALL_STATUSES && THREAD_STATUS_FILTER_OPTIONS.some(option => option === value)
const isSourceFilter = (value: string): value is ThreadSourceFilter => THREAD_SOURCE_FILTER_OPTIONS.some(option => option === value)

/**
 * The status chips' next selection: "Any" (no filter) clears the others, and any status chip clears "Any". Kept in
 * menu order, the order the list's summary and presets already use.
 */
export const nextStatusFilters = (previous: readonly ThreadStatusFilter[], next: readonly string[]): readonly ThreadStatusFilter[] => {
  if (next.includes(ALL_STATUSES) && previous.length > 0) return []
  return THREAD_STATUS_FILTER_OPTIONS.filter((option): option is ThreadStatusFilter => isStatusFilter(option) && next.includes(option))
}

export const ListFilterPanel = (props: ListFilterPanelProps): JSX.Element => {
  const t = props.t
  const ids = useId()
  const presets = props.presets
  return (
    <div className="dshx:grid dshx:min-w-0 dshx:divide-y dshx:divide-border" data-thread-list-filter-panel="">
      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:py-1.5 dshx:pr-1.5 dshx:pl-3">
        <h2 className="dshx:text-sm dshx:font-medium">{t('threadSidebarFilter')}</h2>
        <Button type="button" variant="ghost" size="sm" disabled={props.reset.disabled} onClick={props.reset.onReset} data-thread-filter-reset="">
          {t('threadSidebarFilterReset')}
        </Button>
      </div>
      {props.project === undefined ? null : (
        <section className={SECTION} aria-labelledby={`${ids}-project`}>
          <h3 id={`${ids}-project`} className={HEADING}>
            {t('threadSidebarGroupProject')}
          </h3>
          {props.project}
        </section>
      )}
      {presets === undefined ? null : (
        <section className={cn(SECTION, 'dshx:pb-2')} aria-labelledby={`${ids}-presets`} data-thread-presets="">
          <div className="dshx:-my-1 dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
            <h3 id={`${ids}-presets`} className={HEADING}>
              {t('threadSidebarPresets')}
            </h3>
            {presets.options}
          </div>
          <ToggleGroup
            type="single"
            orientation="vertical"
            aria-label={t('threadSidebarPresets')}
            // An edited preset is no longer what it saved: nothing is checked, and its row says "edited" instead.
            value={presets.edited ? '' : presets.activeId}
            // Picking the checked row again would clear the group; it re-applies the preset instead (dropping edits).
            onValueChange={value => presets.onApply(value === '' ? presets.activeId : value)}
            className="dshx:-mx-1.5 dshx:grid dshx:w-auto dshx:gap-0.5"
          >
            {presets.items.map(preset => {
              const active = preset.id === presets.activeId
              return (
                <ToggleGroupItem
                  key={preset.id}
                  value={preset.id}
                  // An edited preset is announced, not only drawn (round 28, item 3): its name says so, and it stays the
                  // current one although nothing is checked.
                  aria-label={active && presets.edited ? `${preset.accessibleName}, ${t('threadSidebarPresetEditedShort')}` : preset.accessibleName}
                  aria-current={active ? 'true' : undefined}
                  data-preset-active={active ? '' : undefined}
                  className="dshx:h-8 dshx:w-full dshx:justify-start dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:text-sm dshx:font-normal dshx:text-foreground dshx:hover:bg-accent dshx:hover:text-foreground dshx:data-[state=on]:font-medium dshx:pointer-coarse:h-11"
                >
                  {/* The check says which preset the list shows; an edited one keeps its row marked by "edited". */}
                  <span className="dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center" aria-hidden="true">
                    {active && !presets.edited ? <CheckIcon className="dshx:size-4" /> : null}
                  </span>
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left">{preset.label}</span>
                  {active && presets.edited ? (
                    <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground" data-preset-edited-tag="">
                      {t('threadSidebarPresetEditedShort')}
                    </span>
                  ) : null}
                  {preset.mark === undefined ? null : <StatusGlyph status={preset.mark} decorative data-testid="thread-view-attention-dot" />}
                  {/* A zero draws nothing (DESIGN.md › Layout › Counts). */}
                  {preset.count === null || preset.count === 0 ? null : (
                    <span className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">{preset.count}</span>
                  )}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
          {presets.edited ? (
            // An edited preset offers its two ways out, stacked on the rows' own edge: keep the edits, or drop them.
            <div className="dshx:grid dshx:justify-items-start dshx:gap-0.5 dshx:pt-1">
              <Button type="button" size="sm" variant="secondary" className="dshx:min-w-0 dshx:max-w-full" data-preset-save-changes="" onClick={presets.onSaveChanges}>
                <SaveIcon aria-hidden="true" />
                <span className="dshx:truncate">
                  {t('threadSidebarPresetSaveChanges', { name: presets.items.find(item => item.id === presets.activeId)?.label ?? '' })}
                </span>
              </Button>
              <Button type="button" size="sm" variant="ghost" className={QUIET_ROW} onClick={presets.onDiscard}>
                <RotateCcwIcon aria-hidden="true" />
                {t('threadSidebarPresetDiscardChanges')}
              </Button>
            </div>
          ) : null}
          <Button type="button" size="sm" variant="ghost" className={QUIET_ROW} onClick={presets.onSaveAs}>
            <BookmarkPlusIcon aria-hidden="true" />
            {t('threadSidebarPresetSaveAs')}
          </Button>
        </section>
      )}
      {props.status === undefined && props.source === undefined && props.group === undefined ? null : (
        <div className="dshx:grid dshx:gap-3 dshx:px-3 dshx:pt-2.5 dshx:pb-3">
          {props.status === undefined ? null : <StatusChips t={t} headingId={`${ids}-status`} {...props.status} />}
          {props.source === undefined ? null : (
            <section className="dshx:grid dshx:gap-1.5" aria-labelledby={`${ids}-source`}>
              <h3 id={`${ids}-source`} className={HEADING}>
                {t('threadSidebarFilterSource')}
              </h3>
              <ToggleGroup
                type="single"
                aria-labelledby={`${ids}-source`}
                value={props.source.value}
                onValueChange={value => (isSourceFilter(value) ? props.source?.onChange(value) : undefined)}
                spacing={1}
                className="dshx:w-full dshx:flex-wrap dshx:gap-1 dshx:pointer-coarse:gap-2"
              >
                {THREAD_SOURCE_FILTER_OPTIONS.map(option => (
                  <ToggleGroupItem key={option} value={option} aria-label={props.sourceLabels[option].name} className={CHIP}>
                    {props.sourceLabels[option].short}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </section>
          )}
          {props.group === undefined ? null : (
            <section className="dshx:grid dshx:gap-1.5" aria-labelledby={`${ids}-group`}>
              <h3 id={`${ids}-group`} className={HEADING}>
                {t('threadSidebarGroupBy')}
              </h3>
              <ToggleGroup
                type="single"
                aria-labelledby={`${ids}-group`}
                value={props.group.value}
                onValueChange={value => {
                  const option = props.group?.options.find(candidate => candidate === value)
                  if (option !== undefined) props.group?.onChange(option)
                }}
                spacing={1}
                className="dshx:w-full dshx:flex-wrap dshx:gap-1 dshx:pointer-coarse:gap-2"
                data-thread-group-by=""
              >
                {props.group.options.map(option => (
                  <ToggleGroupItem key={option} value={option} className={CHIP}>
                    {props.group?.labels[option]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </section>
          )}
        </div>
      )}
      {props.actions.length === 0 ? null : (
        <div className="dshx:grid dshx:gap-0.5 dshx:p-1.5">
          {props.actions.map(action => (
            <Button
              key={action.id}
              type="button"
              variant="ghost"
              size="sm"
              disabled={action.disabled === true}
              data-section={action.id}
              className="dshx:justify-start dshx:px-1.5 dshx:font-normal dshx:pointer-coarse:h-11"
              onClick={action.onSelect}
            >
              <span className="dshx:inline-flex dshx:size-4 dshx:items-center dshx:justify-center dshx:text-muted-foreground" aria-hidden="true">
                {action.icon}
              </span>
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The statuses a list is usually narrowed by; why a thread waits and where it is stored open under More. */
const LEADING_STATUS_GROUP = THREAD_STATUS_FILTER_GROUPS[0]
const isLeadingStatus = (filter: ThreadStatusFilter): boolean => LEADING_STATUS_GROUP.filters.some(candidate => candidate === filter)

/**
 * Status: "Any" and the activity chips; More statuses (a disclosure, round 28 item 2) opens why a thread waits and
 * where it is stored, each on its own line. It stays mounted, says whether it is open, folds again, and cannot fold
 * while one of the statuses it holds is on.
 */
const StatusChips = (props: {
  readonly t: ThreadSidebarTranslate
  readonly headingId: string
  readonly selected: readonly ThreadStatusFilter[]
  readonly onChange: (filters: readonly ThreadStatusFilter[]) => void
}): JSX.Element => {
  const [opened, setOpened] = useState(false)
  const moreId = useId()
  const forced = props.selected.some(filter => !isLeadingStatus(filter))
  const expanded = opened || forced
  return (
    <section className="dshx:grid dshx:gap-1.5" aria-labelledby={props.headingId}>
      <h3 id={props.headingId} className={HEADING}>
        {props.t('threadSidebarFilterStatus')}
      </h3>
      <ToggleGroup
        type="multiple"
        aria-labelledby={props.headingId}
        value={props.selected.length === 0 ? [ALL_STATUSES] : [...props.selected]}
        onValueChange={next => props.onChange(nextStatusFilters(props.selected, next))}
        spacing={1}
        className="dshx:w-full dshx:flex-wrap dshx:gap-1 dshx:pointer-coarse:gap-2"
        data-thread-status-filters=""
      >
        <ToggleGroupItem value={ALL_STATUSES} className={CHIP}>
          {props.t('threadSidebarFilterNone')}
        </ToggleGroupItem>
        {LEADING_STATUS_GROUP.filters.map(filter => (
          <ToggleGroupItem key={filter} value={filter} className={CHIP}>
            {props.t(threadStatusFilterLabelKeys[filter])}
          </ToggleGroupItem>
        ))}
        {/* The disclosure's region stays mounted (its aria-controls target); it holds the other groups while open. */}
        <div id={moreId} className="dshx:contents" data-thread-status-more-region="">
          {expanded
            ? THREAD_STATUS_FILTER_GROUPS.slice(1).map(group => (
                <Fragment key={group.id}>
                  {/* A later group starts its own line under a small label: the line break is the label's full width. */}
                  <span className="dshx:w-full dshx:pt-1 dshx:text-xs dshx:text-muted-foreground" aria-hidden="true">
                    {props.t(threadStatusFilterGroupLabelKeys[group.id])}
                  </span>
                  {group.filters.map(filter => (
                    <ToggleGroupItem key={filter} value={filter} className={CHIP}>
                      {props.t(threadStatusFilterLabelKeys[filter])}
                    </ToggleGroupItem>
                  ))}
                </Fragment>
              ))
            : null}
        </div>
      </ToggleGroup>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={moreId}
        // A status in force never hides: while one of these is on, More stays open and cannot fold.
        disabled={forced}
        className="dshx:-mx-1.5 dshx:justify-start dshx:justify-self-start dshx:px-1.5 dshx:font-normal dshx:text-muted-foreground dshx:pointer-coarse:h-11"
        onClick={() => setOpened(current => !current)}
        data-thread-status-more=""
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('dshx:transition-transform dshx:duration-(--dshx-duration-hover)', expanded && 'dshx:rotate-180')}
        />
        {props.t('threadSidebarFilterMoreStatuses')}
      </Button>
    </section>
  )
}
