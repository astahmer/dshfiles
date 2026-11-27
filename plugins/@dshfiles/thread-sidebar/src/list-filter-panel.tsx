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
import { ArchiveIcon, BellOffIcon, CheckIcon, ChevronDownIcon, RotateCcwIcon, SaveIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useState, type ReactNode } from 'react'
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
    /** The presets' own verbs (save as, rename, update, delete, mark read…), a small menu beside the heading. */
    readonly options: ReactNode
  } | undefined
  readonly status?: { readonly selected: readonly ThreadStatusFilter[]; readonly onChange: (filters: readonly ThreadStatusFilter[]) => void } | undefined
  readonly source?: { readonly value: ThreadSourceFilter; readonly onChange: (value: ThreadSourceFilter) => void } | undefined
  readonly group?: {
    readonly value: ThreadGroupBy
    readonly options: readonly ThreadGroupBy[]
    /** Each grouping's shown label ("Manual") and its full name ("Arrange manually"), so the five fit one row. */
    readonly labels: Readonly<Record<ThreadGroupBy, { readonly short: string; readonly name: string }>>
    readonly onChange: (value: ThreadGroupBy) => void
  } | undefined
  /** Each source's shown label ("Main") and its full name ("Main threads"), so the three fit one line. */
  readonly sourceLabels: Readonly<Record<ThreadSourceFilter, { readonly short: string; readonly name: string }>>
  /** Back to All threads with no filter on, the grouping kept; disabled while no filter narrows the list. */
  readonly reset: { readonly disabled: boolean; readonly onReset: () => void }
  /** The list's other places and settings (Board, Thread list settings, Sidebar settings), quiet rows at the foot. */
  readonly actions: readonly ListFilterAction[]
  /** Close the panel: the phone sheet's Done. */
  readonly onDone?: (() => void) | undefined
  /** What the list shows now ("2 threads shown"), announced politely after a change (round 28, item 15). */
  readonly shown?: string | undefined
}

/**
 * A polite live region for the list's count (council round 27, item 15): a filter applies at once to rows a screen
 * reader user is not looking at, so the count is said after a change. Empty on opening, so opening says nothing extra.
 */
const ShownAnnouncer = (props: { readonly shown: string | undefined }): JSX.Element => {
  const [opening] = useState(props.shown)
  const [changed, setChanged] = useState(false)
  if (!changed && props.shown !== opening) setChanged(true)
  return (
    <p role="status" aria-live="polite" className="dshx:sr-only" data-thread-filter-shown="">
      {changed || props.shown !== opening ? props.shown : ''}
    </p>
  )
}

/**
 * A chip (council round 27, item 6): the quiet trigger fill and the secondary ink at rest (no hairline: sixteen edged
 * chips read as a form); selected, the kit segment thumb (paper, #302C28 in dark) under the 3:1 field edge, its label
 * the ink at 550, so the choices in force read at a glance on the popover and on the phone sheet alike.
 */
const CHIP =
  'dshx:h-7 dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-transparent dshx:bg-trigger-fill dshx:px-2.5 dshx:text-xs dshx:font-normal dshx:text-muted-foreground dshx:shadow-none dshx:hover:text-foreground dshx:data-[state=on]:border-field-border dshx:data-[state=on]:bg-(--dshx-segment-thumb) dshx:data-[state=on]:font-selected dshx:data-[state=on]:text-foreground dshx:pointer-coarse:h-9 dshx:pointer-coarse:px-3 dshx:pointer-coarse:text-sm'

/** What a status chip's seat draws at rest: the glyph the list draws for that state (council round 27, item 9). */
type ChipMark = WorkStatus | 'unread' | 'muted' | 'archived'
const STATUS_CHIP_MARK = {
  working: 'working',
  'not-running': 'idle',
  attention: 'needs-you',
  unread: 'unread',
  'approval-needed': 'needs-you',
  'input-needed': 'needs-you',
  'turn-finished': 'ready',
  'needs-resume': 'failed',
  interrupted: 'failed',
  inactive: 'idle',
  muted: 'muted',
  settled: 'done',
  archived: 'archived',
} as const satisfies Record<ThreadStatusFilter, ChipMark>

const ChipMarkGlyph = (props: { readonly mark: ChipMark }): JSX.Element => {
  switch (props.mark) {
    case 'unread':
      return <span className="dshx:size-1.5 dshx:rounded-full dshx:bg-foreground" data-chip-mark="unread" />
    case 'muted':
      return <BellOffIcon className="dshx:size-3" data-chip-mark="muted" />
    case 'archived':
      return <ArchiveIcon className="dshx:size-3" strokeWidth={1.5} data-chip-mark="archived" />
    default:
      // The list's glyph at the count-chip size; a filter is not a live state, so the working ring holds still.
      return <StatusGlyph status={props.mark} size="small" decorative data-chip-mark={props.mark} className="dshx:[&_[data-glyph-spinner]]:animate-none" />
  }
}

/**
 * A status chip's leading 12px seat: its status glyph at rest, a check while it is on, so the multi-select reads as
 * checkboxes, not radios (council round 27, items 6 and 9). The seat never changes width, so toggling moves nothing.
 */
const ChipSeat = (props: { readonly on: boolean; readonly filter: ThreadStatusFilter }): JSX.Element => (
  <span className="dshx:inline-flex dshx:size-3 dshx:shrink-0 dshx:items-center dshx:justify-center" aria-hidden="true" data-chip-seat="">
    {props.on ? <CheckIcon className="dshx:size-3" strokeWidth={2.5} data-chip-check="" /> : <ChipMarkGlyph mark={STATUS_CHIP_MARK[props.filter]} />}
  </span>
)

const SECTION = 'dshx:grid dshx:gap-1.5 dshx:px-3 dshx:py-2.5'
/**
 * A quiet verb row (council round 27, item 16): its 16px glyph on the panel's one glyph column, 12px in (a 6px bleed,
 * 6px padding), its label 8px after it at 36px, where the preset names start.
 */
const QUIET_ROW =
  'dshx:-mx-1.5 dshx:justify-start dshx:justify-self-stretch dshx:gap-2 dshx:px-1.5 dshx:has-[>svg]:px-1.5 dshx:font-normal dshx:text-muted-foreground dshx:[&_svg]:size-4 dshx:pointer-coarse:h-11'
const HEADING = 'dshx:text-xs dshx:font-medium dshx:text-muted-foreground'
/** One status group's chips: a wrapping row. */
const STATUS_ROW = 'dshx:flex dshx:w-full dshx:flex-wrap dshx:gap-1 dshx:pointer-coarse:gap-2'

const isStatusFilter = (value: string): value is ThreadStatusFilter => value !== 'all' && THREAD_STATUS_FILTER_OPTIONS.some(option => option === value)
const isSourceFilter = (value: string): value is ThreadSourceFilter => THREAD_SOURCE_FILTER_OPTIONS.some(option => option === value)

/** The status chips' next selection, kept in menu order (the order the list's summary and presets already use). */
export const nextStatusFilters = (next: readonly string[]): readonly ThreadStatusFilter[] =>
  THREAD_STATUS_FILTER_OPTIONS.filter((option): option is ThreadStatusFilter => isStatusFilter(option) && next.includes(option))

/**
 * Where focus lands when the panel opens (council round 27, item 14): the preset in force (checked, or current while
 * edited), else the first status chip, else the first control; never the presets' ⋯ menu.
 */
export const filterPanelInitialFocus = (root: ParentNode): HTMLElement | null => {
  const panel = root.querySelector('[data-thread-list-filter-panel]') ?? root
  const target =
    panel.querySelector('[data-thread-presets] [role="radio"][aria-checked="true"]') ??
    panel.querySelector('[data-thread-presets] [role="radio"][aria-current="true"]') ??
    panel.querySelector('[data-thread-status-filters] button') ??
    panel.querySelector('button:not([disabled])')
  return target instanceof HTMLElement ? target : null
}

export const ListFilterPanel = (props: ListFilterPanelProps): JSX.Element => {
  const t = props.t
  const ids = useId()
  const presets = props.presets
  return (
    <div className="dshx:grid dshx:min-w-0 dshx:divide-y dshx:divide-border" data-thread-list-filter-panel="">
      <ShownAnnouncer shown={props.shown} />
      {/* Sticky, so Reset and Done stay in reach while the sheet scrolls (round 28, item 10). A desktop reads "Filters …
          Reset"; a phone reads "Reset · Filters · Done", the sheet's own close. One word for the button and the title.
          The phone sheet keeps 20px of its own top padding for the grabber; the header sticks over it (-20px), so no row
          scrolls by above the header. */}
      <div
        className="dshx:sticky dshx:top-0 dshx:z-10 dshx:flex dshx:phone:-top-5 dshx:items-center dshx:gap-2 dshx:bg-popover dshx:py-1.5 dshx:pr-0.5 dshx:pl-3 dshx:phone:grid dshx:phone:grid-cols-[1fr_auto_1fr] dshx:phone:px-0.5"
        data-thread-filter-header=""
      >
        <h2 className="dshx:min-w-0 dshx:flex-1 dshx:text-sm dshx:font-medium dshx:phone:text-base dshx:phone:font-semibold">{t('threadSidebarFilters')}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Reset covers the filters, not the Display section under its own hairline (round 28, item 8).
          aria-label={t('threadSidebarFilterResetLabel')}
          disabled={props.reset.disabled}
          onClick={props.reset.onReset}
          data-thread-filter-reset=""
          className="dshx:phone:order-first dshx:phone:justify-self-start"
        >
          {t('threadSidebarFilterReset')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="dshx:hidden dshx:font-semibold dshx:text-foreground dshx:phone:inline-flex dshx:phone:justify-self-end"
          onClick={props.onDone}
          data-thread-filter-done=""
        >
          {t('threadSidebarDone')}
        </Button>
      </div>
      {props.project === undefined ? null : (
        // The phone sheet's project, one inline row: "Project · All projects ›" (round 28, item 10).
        <div className="dshx:px-3 dshx:py-0.5">{props.project}</div>
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
            // Rows that stand apart: with spacing the kit keeps each row's own rounded corners (round 28, item 13).
            spacing={0.5}
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
            <div className="dshx:grid dshx:gap-0.5 dshx:pt-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                // The way to keep the edits reads in ink at 500, on the glyph column like its neighbours (round 28, item 16).
                className={cn(QUIET_ROW, 'dshx:min-w-0 dshx:font-medium dshx:text-foreground')}
                data-preset-save-changes=""
                onClick={presets.onSaveChanges}
              >
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
        </section>
      )}
      {props.status === undefined && props.source === undefined ? null : (
        <div className="dshx:grid dshx:gap-3 dshx:px-3 dshx:pt-2.5 dshx:pb-3">
          {props.status === undefined ? null : <StatusChips t={t} headingId={`${ids}-status`} {...props.status} />}
          {props.source === undefined ? null : (
            <section className="dshx:grid dshx:gap-1.5" aria-labelledby={`${ids}-source`}>
              <h3 id={`${ids}-source`} className={HEADING}>
                {t('threadSidebarFilterSource')}
              </h3>
              <Segmented
                labelledBy={`${ids}-source`}
                value={props.source.value}
                options={THREAD_SOURCE_FILTER_OPTIONS.map(option => ({ value: option, ...props.sourceLabels[option] }))}
                onChange={value => (isSourceFilter(value) ? props.source?.onChange(value) : undefined)}
              />
            </section>
          )}
        </div>
      )}
      {props.group === undefined ? null : (
        // Display, under its own hairline: how the list is drawn, which Reset above does not cover.
        <section className="dshx:grid dshx:gap-1.5 dshx:px-3 dshx:pt-2.5 dshx:pb-3" aria-labelledby={`${ids}-display`} data-thread-filter-display="">
          <h3 id={`${ids}-display`} className={HEADING}>
            {t('threadSidebarFilterDisplay')}
          </h3>
          <span id={`${ids}-group`} className="dshx:text-xs dshx:text-foreground">
            {t('threadSidebarGroupBy')}
          </span>
          <Segmented
            labelledBy={`${ids}-group`}
            value={props.group.value}
            options={props.group.options.map(option => ({ value: option, ...(props.group?.labels[option] ?? { short: option, name: option }) }))}
            onChange={value => {
              const option = props.group?.options.find(candidate => candidate === value)
              if (option !== undefined) props.group?.onChange(option)
            }}
            data-thread-group-by=""
          />
        </section>
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
              // The footer's 6px plus the row's 6px: the same glyph column and label x as every quiet row (round 28, item 16).
              className="dshx:justify-start dshx:gap-2 dshx:px-1.5 dshx:has-[>svg]:px-1.5 dshx:font-normal dshx:[&_svg]:size-4 dshx:pointer-coarse:h-11"
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

/**
 * A segmented control (council round 27, item 8), drawn as the kit's segmented Tabs root: the raised track at the one
 * control height, each segment inset 3px, the chosen one the segment thumb with its label at 550 (its width reserved, so
 * choosing never moves a neighbour). A ToggleGroup underneath, so it is one radiogroup with arrow-key movement.
 */
const Segmented = (props: {
  readonly labelledBy: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly short: string; readonly name: string }[]
  readonly onChange: (value: string) => void
  readonly 'data-thread-group-by'?: string
}): JSX.Element => (
  <ToggleGroup
    type="single"
    aria-labelledby={props.labelledBy}
    value={props.value}
    // Picking the chosen segment again would clear the group: a segmented control always holds one value.
    onValueChange={value => (value === '' ? undefined : props.onChange(value))}
    spacing={1}
    data-segmented=""
    data-thread-group-by={props['data-thread-group-by']}
    // The raised track; in dark the popover is that same step, so the track takes the trigger fill to stay one step off it.
    className="dshx:h-(--dshx-control-h) dshx:w-full dshx:gap-0 dshx:rounded-lg dshx:bg-muted dshx:p-[3px] dshx:dark:bg-trigger-fill"
  >
    {props.options.map(option => (
      <ToggleGroupItem
        key={option.value}
        value={option.value}
        aria-label={option.name === option.short ? undefined : option.name}
        className="dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:rounded-md dshx:border dshx:border-transparent dshx:px-1.5 dshx:text-xs dshx:font-medium dshx:text-muted-foreground dshx:hover:bg-transparent dshx:hover:text-foreground dshx:data-[state=on]:border-(--dshx-segment-edge) dshx:data-[state=on]:bg-(--dshx-segment-thumb) dshx:data-[state=on]:font-selected dshx:data-[state=on]:text-foreground dshx:pointer-coarse:text-sm"
      >
        <span data-slot="segment-label" data-label={option.short} className="dshx:segment-label">
          {option.short}
        </span>
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
)

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
      {/* No status on means any (no Any chip); a ghost Clear stands in the heading while one is on. */}
      <div className="dshx:flex dshx:h-6 dshx:items-center dshx:justify-between dshx:gap-2" data-thread-status-heading="">
        <h3 id={props.headingId} className={HEADING}>
          {props.t('threadSidebarFilterStatus')}
        </h3>
        {props.selected.length === 0 ? null : (
          <Button type="button" variant="ghost" size="xs" className="dshx:-mr-2 dshx:font-normal dshx:text-muted-foreground" onClick={() => props.onChange([])}>
            {props.t('threadSidebarFilterClear')}
          </Button>
        )}
      </div>
      <ToggleGroup
        type="multiple"
        aria-labelledby={props.headingId}
        value={[...props.selected]}
        onValueChange={next => props.onChange(nextStatusFilters(next))}
        spacing={1}
        // One labelled group per status group (round 28, item 4), so a screen reader hears which "Done" a chip is.
        className="dshx:grid dshx:w-full dshx:gap-1.5 dshx:pointer-coarse:gap-2"
        data-thread-status-filters=""
      >
        <div role="group" aria-label={props.t(threadStatusFilterGroupLabelKeys[LEADING_STATUS_GROUP.id])} className={STATUS_ROW} data-thread-status-group="">
          {LEADING_STATUS_GROUP.filters.map(filter => (
            <ToggleGroupItem key={filter} value={filter} className={CHIP}>
              <ChipSeat on={props.selected.includes(filter)} filter={filter} />
              {props.t(threadStatusFilterLabelKeys[filter])}
            </ToggleGroupItem>
          ))}
        </div>
        {/* The disclosure's region stays mounted (its aria-controls target); it holds the other groups while open. */}
        <div id={moreId} className="dshx:grid dshx:gap-1.5 dshx:empty:hidden dshx:pointer-coarse:gap-2" data-thread-status-more-region="">
          {expanded
            ? THREAD_STATUS_FILTER_GROUPS.slice(1).map(group => (
                <div key={group.id} role="group" aria-labelledby={`${moreId}-${group.id}`} className={STATUS_ROW} data-thread-status-group="">
                  {/* The group's label starts its own line: its full width breaks the row. */}
                  <span id={`${moreId}-${group.id}`} className="dshx:w-full dshx:pt-1 dshx:text-xs dshx:text-muted-foreground">
                    {props.t(threadStatusFilterGroupLabelKeys[group.id])}
                  </span>
                  {group.filters.map(filter => (
                    <ToggleGroupItem key={filter} value={filter} className={CHIP}>
                      <ChipSeat on={props.selected.includes(filter)} filter={filter} />
                      {props.t(threadStatusFilterLabelKeys[filter])}
                    </ToggleGroupItem>
                  ))}
                </div>
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
        className={cn(QUIET_ROW, 'dshx:justify-self-start')}
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
