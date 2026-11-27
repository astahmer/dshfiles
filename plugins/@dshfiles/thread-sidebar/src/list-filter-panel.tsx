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
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArchiveIcon, BellOffIcon, BookmarkPlusIcon, CheckIcon, CircleCheckIcon, ChevronDownIcon, RotateCcwIcon, SaveIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { plural } from '@dshfiles/dshx/client'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
  /** How many rows the preset shows; null when its count is turned off. A zero draws nothing. */
  readonly count: number | null
}

/**
 * The preset row's accessible name, built from what it draws: "Done, 3 threads". Preset rows draw no status mark
 * (council round 29, item 7): every preset held a thread that needs you, so the diamond said nothing; the list header
 * shows the marks.
 */
const presetName = (t: ThreadSidebarTranslate, preset: ListFilterPreset): string =>
  preset.count === null || preset.count === 0 ? preset.label : `${preset.label}, ${plural(t, 'threadSidebarPresetThreads', preset.count)}`

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
    /** The built-in preset (All threads), which edits never overwrite: its row offers Save as new preset… instead. */
    readonly builtInId?: string | undefined
    readonly onSaveAs?: (() => void) | undefined
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
 * chips read as a form); selected, the segments' own look (council round 28, item 14): the segment thumb under the
 * segment edge, no shadow (as the thumb), its label the ink at 550, with the check in its seat.
 */
const CHIP =
  'dshx:h-7 dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-transparent dshx:bg-trigger-fill dshx:px-2.5 dshx:text-xs dshx:font-normal dshx:text-muted-foreground dshx:shadow-none dshx:hover:text-foreground dshx:data-[state=on]:border-(--dshx-segment-edge) dshx:data-[state=on]:bg-(--dshx-segment-thumb) dshx:data-[state=on]:font-selected dshx:data-[state=on]:text-foreground dshx:pointer-coarse:h-9 dshx:pointer-coarse:px-3 dshx:pointer-coarse:text-sm'

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
    case 'done':
      // The row menu's Done mark, never the bare check, which means "on" in this seat (council round 28, item 4).
      return <CircleCheckIcon className="dshx:size-3 dshx:text-muted-foreground" strokeWidth={1.5} data-chip-mark="done" />
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

/**
 * An edited preset row's button: a 24px icon with the kit tooltip on a mouse; on a coarse pointer a 13px word in a 44pt
 * seat (council round 29, item 8: "Save", "Discard"), the full name kept as its accessible name.
 */
const RowIconButton = (
  props: { readonly label: string; readonly text: string; readonly onClick: () => void; readonly children: ReactNode } & Record<`data-${string}`, string>,
): JSX.Element => {
  const { label, text, onClick, children, ...data } = props
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={onClick}
          className="dshx:size-6 dshx:text-muted-foreground dshx:hover:text-foreground dshx:pointer-coarse:h-11 dshx:pointer-coarse:w-auto dshx:pointer-coarse:px-2 dshx:pointer-coarse:text-sm dshx:pointer-coarse:font-medium dshx:pointer-coarse:text-foreground dshx:[&_svg]:size-3.5"
          {...data}
        >
          <span className="dshx:inline-flex dshx:pointer-coarse:hidden" data-row-button-icon="">
            {children}
          </span>
          <span className="dshx:hidden dshx:pointer-coarse:inline" data-row-button-text="">
            {text}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Where an edited row's Save and Discard end: the row's 6px padding, the 20px count column and an 8px gap. */
const ACTIONS_END = 34
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
  const panelRef = useRef<HTMLDivElement | null>(null)
  const actionsRef = useRef<HTMLDivElement | null>(null)
  // The edited row's Save and Discard: their width, so the label gives way to exactly them (their text on a phone).
  const [actionsBox, setActionsBox] = useState({ width: 0, top: 0, height: 0 })
  const actionsWidth = actionsBox.width
  const editingId = presets?.edited === true ? presets.activeId : undefined
  const presetsRef = useRef<HTMLElement | null>(null)
  // Save and Discard live outside the radiogroup (council round 29, item 13), laid over the edited row: its top and
  // height, measured against the presets section, and their own width, which the row's label gives way to.
  useLayoutEffect(() => {
    const actions = actionsRef.current
    const section = presetsRef.current
    const row = section?.querySelector('[data-preset-active]')
    if (actions === null || section === null || row === null || row === undefined) return
    const rowBox = row.getBoundingClientRect()
    setActionsBox({ width: actions.offsetWidth, top: rowBox.top - section.getBoundingClientRect().top, height: rowBox.height })
  }, [editingId, presets?.items.length])
  /** The last change, named for the live region. */
  const [change, setChange] = useState<string | undefined>(undefined)
  /** Save and Discard vanish as they act: focus moves to the preset row first, never to the page (round 28, item 18). */
  const focusPresetThen =
    (action: () => void): (() => void) =>
    () => {
      panelRef.current?.querySelector<HTMLElement>('[data-thread-presets] [data-preset-active]')?.focus()
      action()
    }
  return (
    // The panel is its own scroller (council round 28, item 7), so the sticky header stays pinned to it while the
    // popover (and, on a phone, the sheet with its grabber) holds still around it.
    <div
      ref={panelRef}
      className="dshx:grid dshx:min-h-0 dshx:min-w-0 dshx:divide-y dshx:divide-border dshx:overflow-y-auto dshx:overscroll-contain"
      data-thread-list-filter-panel=""
    >
      {/* The change and the count it leaves (council round 29, item 13): "Unread on, 5 threads shown" is heard even when the
          count does not move. */}
      <ShownAnnouncer shown={change === undefined || props.shown === undefined ? props.shown : `${change}, ${props.shown}`} />
      {/* Sticky, so Reset and Done stay in reach while the sheet scrolls (round 28, item 10). A desktop reads "Filters …
          Reset"; a phone reads "Reset · Filters · Done", the sheet's own close. One word for the button and the title.
          The panel scrolls, not the sheet, so the grabber's 20px stays above the header. */}
      <div
        className="dshx:sticky dshx:top-0 dshx:z-10 dshx:flex dshx:items-center dshx:gap-2 dshx:bg-popover dshx:py-1.5 dshx:pr-0.5 dshx:pl-3 dshx:phone:grid dshx:phone:grid-cols-[1fr_auto_1fr] dshx:phone:px-0.5"
        data-thread-filter-header=""
      >
        <h2 className="dshx:min-w-0 dshx:flex-1 dshx:text-sm dshx:font-medium dshx:phone:text-base dshx:phone:font-semibold">{t('threadSidebarFilters')}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Reset covers the presets, status and source, not Group by under its own hairline (round 28, items 8 and 11).
          aria-label={t('threadSidebarFilterResetLabel')}
          aria-describedby={`${ids}-reset-scope`}
          disabled={props.reset.disabled}
          onClick={() => {
            setChange(t('threadSidebarFilterChangeReset'))
            props.reset.onReset()
          }}
          data-thread-filter-reset=""
          className="dshx:phone:order-first dshx:phone:justify-self-start"
        >
          {t('threadSidebarFilterReset')}
        </Button>
        <span id={`${ids}-reset-scope`} className="dshx:sr-only">
          {t('threadSidebarFilterResetScope')}
        </span>
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
        <section ref={presetsRef} className={cn(SECTION, 'dshx:relative dshx:pb-2')} aria-labelledby={`${ids}-presets`} data-thread-presets="">
          {/* A 44px row on a coarse pointer, so the ⋯'s 44px hit area stays in it (round 28, item 12). */}
          <div className="dshx:-my-1 dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:pointer-coarse:my-0 dshx:pointer-coarse:h-11">
            <h3 id={`${ids}-presets`} className={HEADING}>
              {t('threadSidebarPresets')}
            </h3>
            {presets.options}
          </div>
          <ToggleGroup
            type="single"
            orientation="vertical"
            aria-label={t('threadSidebarPresets')}
            // An edited preset keeps its identity (council round 28, item 5): it stays checked, marked edited.
            value={presets.activeId}
            // Pressing the checked row again would clear the group: it is a no-op (Discard, in the row, drops edits).
            onValueChange={value => {
              if (value === '' || value === presets.activeId) return
              setChange(presets.items.find(item => item.id === value)?.label)
              presets.onApply(value)
            }}
            // Rows that stand apart: with spacing the kit keeps each row's own rounded corners (round 28, item 13).
            spacing={0.5}
            className="dshx:-mx-1.5 dshx:grid dshx:w-auto dshx:gap-0.5"
          >
            {presets.items.map(preset => {
              const active = preset.id === presets.activeId
              const editing = active && presets.edited
              return (
                <div key={preset.id} data-preset-row="">
                <ToggleGroupItem
                  value={preset.id}
                  // An edited preset is announced, not only drawn (round 28, item 3): its name says so, and it stays the
                  // current one although nothing is checked.
                  aria-label={active && presets.edited ? `${presetName(t, preset)}, ${t('threadSidebarPresetEditedShort')}` : presetName(t, preset)}
                  aria-current={active ? 'true' : undefined}
                  data-preset-active={active ? '' : undefined}
                  className="dshx:h-8 dshx:w-full dshx:justify-start dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:text-sm dshx:font-normal dshx:text-foreground dshx:hover:bg-accent dshx:hover:text-foreground dshx:data-[state=on]:font-medium dshx:pointer-coarse:h-11"
                  // While edited, the label gives way to Save and Discard, which sit before the count column.
                  style={editing && actionsWidth > 0 ? { paddingRight: `${String(actionsWidth + ACTIONS_END + 8)}px` } : undefined}
                >
                  {/* The check says which preset the list shows; "· edited" says it changed (no dot: council round 29, item 1). */}
                  <span className="dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center" aria-hidden="true" data-preset-seat="">
                    {active ? <CheckIcon className="dshx:size-4" /> : null}
                  </span>
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left" data-preset-label="">
                    {preset.label}
                    {active && presets.edited ? (
                      <span className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground" data-preset-edited-tag="">
                        {` · ${t('threadSidebarPresetEditedShort')}`}
                      </span>
                    ) : null}
                  </span>
                  {/* One fixed end column on every row, edited or not (council round 29, item 6): a 20px right-aligned
                      count in the secondary ink, empty at zero (DESIGN.md › Layout › Counts). */}
                  <span className="dshx:w-5 dshx:shrink-0 dshx:text-right dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground" data-preset-count="">
                    {preset.count === null || preset.count === 0 ? '' : preset.count}
                  </span>
                </ToggleGroupItem>
                </div>
              )
            })}
          </ToggleGroup>
          {(() => {
            const preset = presets.items.find(item => item.id === presets.activeId)
            if (!presets.edited || preset === undefined) return null
            return (
              // After the row's "edited" tag, before its count column: the row ends 6px inside the section, then its 6px
              // padding, the 20px column and an 8px gap (40px). Over the edited row, but outside the radiogroup, so it
              // holds only radios (council round 29, item 13).
              <div
                ref={actionsRef}
                className="dshx:absolute dshx:right-10 dshx:flex dshx:items-center dshx:gap-0.5 dshx:pointer-coarse:gap-0"
                style={{ top: `${String(actionsBox.top)}px`, height: `${String(actionsBox.height)}px` }}
                data-preset-actions=""
              >
                    {preset.id === presets.builtInId ? (
                      // The built-in All threads is never overwritten (council round 28, item 13): its edits become a new preset.
                      <RowIconButton label={t('threadSidebarPresetSaveAsNew')} text={t('threadSidebarPresetSaveAsNewShort')} onClick={() => presets.onSaveAs?.()} data-preset-save-as="">
                        <BookmarkPlusIcon />
                      </RowIconButton>
                    ) : (
                      <RowIconButton
                        label={t('threadSidebarPresetSaveChanges', { name: preset.label })}
                        text={t('threadSidebarPresetSaveShort')}
                        onClick={focusPresetThen(presets.onSaveChanges)}
                        data-preset-save-changes=""
                      >
                        <SaveIcon />
                      </RowIconButton>
                    )}
                    <RowIconButton label={t('threadSidebarPresetDiscardChanges')} text={t('threadSidebarPresetDiscardShort')} onClick={focusPresetThen(presets.onDiscard)} data-preset-discard-changes="">
                      <RotateCcwIcon />
                    </RowIconButton>
              </div>
            )
          })()}
        </section>
      )}
      {props.status === undefined && props.source === undefined ? null : (
        <div className="dshx:grid dshx:gap-3 dshx:px-3 dshx:pt-2.5 dshx:pb-3">
          {props.status === undefined ? null : <StatusChips t={t} headingId={`${ids}-status`} {...props.status} onNote={setChange} />}
          {props.source === undefined ? null : (
            <section className="dshx:grid dshx:gap-1.5" aria-labelledby={`${ids}-source`}>
              <h3 id={`${ids}-source`} className={HEADING}>
                {t('threadSidebarFilterSource')}
              </h3>
              <Segmented
                labelledBy={`${ids}-source`}
                value={props.source.value}
                options={THREAD_SOURCE_FILTER_OPTIONS.map(option => ({ value: option, ...props.sourceLabels[option] }))}
                onChange={(value, name) => {
                  if (!isSourceFilter(value)) return
                  setChange(name)
                  props.source?.onChange(value)
                }}
              />
            </section>
          )}
        </div>
      )}
      {props.group === undefined ? null : (
        // Group by, under its own hairline: how the list is drawn, which Reset above does not cover (its description
        // says so). One heading (council round 28, item 11).
        <section className="dshx:grid dshx:gap-1.5 dshx:px-3 dshx:pt-2.5 dshx:pb-3" aria-labelledby={`${ids}-group`} data-thread-filter-display="">
          <h3 id={`${ids}-group`} className={HEADING}>
            {t('threadSidebarGroupBy')}
          </h3>
          <Segmented
            labelledBy={`${ids}-group`}
            value={props.group.value}
            options={props.group.options.map(option => ({ value: option, ...(props.group?.labels[option] ?? { short: option, name: option }) }))}
            onChange={(value, name) => {
              const option = props.group?.options.find(candidate => candidate === value)
              if (option === undefined) return
              setChange(t('threadSidebarFilterChangeGroup', { name }))
              props.group?.onChange(option)
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
              // Places, not filters: the secondary ink, the ink on hover (council round 28, item 16).
              className="dshx:justify-start dshx:gap-2 dshx:px-1.5 dshx:has-[>svg]:px-1.5 dshx:font-normal dshx:text-muted-foreground dshx:hover:text-foreground dshx:[&_svg]:size-4 dshx:pointer-coarse:h-11"
              onClick={action.onSelect}
            >
              <span className="dshx:inline-flex dshx:size-4 dshx:items-center dshx:justify-center" aria-hidden="true">
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
  /** The chosen value and its full name, which the panel's live region says. */
  readonly onChange: (value: string, name: string) => void
  readonly 'data-thread-group-by'?: string
}): JSX.Element => (
  <ToggleGroup
    type="single"
    aria-labelledby={props.labelledBy}
    value={props.value}
    // Picking the chosen segment again would clear the group: a segmented control always holds one value.
    onValueChange={value => {
      const option = props.options.find(candidate => candidate.value === value)
      if (option !== undefined) props.onChange(value, option.name)
    }}
    spacing={1}
    data-segmented=""
    data-thread-group-by={props['data-thread-group-by']}
    // The kit segment track (#1A1715 in dark, below the popover fill: council round 28, item 14).
    className="dshx:h-(--dshx-control-h) dshx:w-full dshx:gap-0 dshx:rounded-lg dshx:bg-segment-track dshx:p-[3px]"
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
 * Status: the activity chips; then More statuses, a disclosure directly under them (council round 28, item 3) that
 * opens why a thread waits and where it is stored, each on its own labelled line. It reads Fewer statuses while open,
 * and while one of the statuses it reveals is on it stays open: `aria-disabled` with a description of how to fold it.
 * The leading row and the revealed rows are two roving groups, so the first revealed chip is the next Tab stop.
 */
const StatusChips = (props: {
  readonly t: ThreadSidebarTranslate
  readonly headingId: string
  readonly selected: readonly ThreadStatusFilter[]
  readonly onChange: (filters: readonly ThreadStatusFilter[]) => void
  /** Name the change for the panel's live region: "Unread on". */
  readonly onNote: (change: string) => void
}): JSX.Element => {
  const [opened, setOpened] = useState(false)
  const moreId = useId()
  const forced = props.selected.some(filter => !isLeadingStatus(filter))
  // Latched open once forced (council round 29, item 3): turning the last revealed status off never folds the region
  // under the pointer or drops the focus that sits in it.
  if (forced && !opened) setOpened(true)
  const expanded = opened || forced
  const leading = props.selected.filter(isLeadingStatus)
  const revealed = props.selected.filter(filter => !isLeadingStatus(filter))
  /** Apply a group's next value, naming the chip it turned on or off. */
  const toggle = (next: readonly ThreadStatusFilter[], others: readonly ThreadStatusFilter[]): void => {
    const combined = nextStatusFilters([...next, ...others])
    const on = combined.find(filter => !props.selected.includes(filter))
    const off = props.selected.find(filter => !combined.includes(filter))
    const flipped = on ?? off
    if (flipped !== undefined)
      props.onNote(props.t(on === undefined ? 'threadSidebarFilterChangeOff' : 'threadSidebarFilterChangeOn', { name: props.t(threadStatusFilterLabelKeys[flipped]) }))
    props.onChange(combined)
  }
  const chip = (filter: ThreadStatusFilter): JSX.Element => (
    <ToggleGroupItem key={filter} value={filter} className={CHIP}>
      <ChipSeat on={props.selected.includes(filter)} filter={filter} />
      {/* The label keeps its 550 width at rest, so selecting a chip never moves its neighbours (round 29, item 9). */}
      <span data-slot="segment-label" data-label={props.t(threadStatusFilterLabelKeys[filter])} className="dshx:segment-label">
        {props.t(threadStatusFilterLabelKeys[filter])}
      </span>
    </ToggleGroupItem>
  )
  return (
    <section className="dshx:grid dshx:gap-1.5" aria-labelledby={props.headingId}>
      {/* No status on means any (no Any chip); a ghost Clear stands in the heading while one is on. */}
      {/* A 44px row on a coarse pointer, so Clear's 44px hit area never reaches the chips (round 28, item 12). */}
      <div className="dshx:flex dshx:h-6 dshx:items-center dshx:justify-between dshx:gap-2 dshx:pointer-coarse:h-11" data-thread-status-heading="">
        <h3 id={props.headingId} className={HEADING}>
          {props.t('threadSidebarFilterStatus')}
        </h3>
        {props.selected.length === 0 ? null : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="dshx:-mr-2 dshx:font-normal dshx:text-muted-foreground"
            onClick={event => {
              // Clear vanishes as it acts: focus moves to the first chip, never to the page (council round 28, item 18).
              event.currentTarget.closest('section')?.querySelector<HTMLElement>('[data-thread-status-filters] [data-slot="toggle-group-item"]')?.focus()
              props.onNote(props.t('threadSidebarFilterChangeCleared'))
              props.onChange([])
            }}
          >
            {props.t('threadSidebarFilterClear')}
          </Button>
        )}
      </div>
      <div className="dshx:grid dshx:w-full dshx:gap-1.5 dshx:pointer-coarse:gap-2" role="group" aria-labelledby={props.headingId} data-thread-status-filters="">
        <ToggleGroup
          type="multiple"
          // One labelled group per status group (round 28, item 4), so a screen reader hears which "Done" a chip is.
          aria-label={props.t(threadStatusFilterGroupLabelKeys[LEADING_STATUS_GROUP.id])}
          role="group"
          value={leading}
          onValueChange={next => toggle(nextStatusFilters(next), revealed)}
          spacing={1}
          className={STATUS_ROW}
          data-thread-status-group=""
        >
          {LEADING_STATUS_GROUP.filters.map(chip)}
        </ToggleGroup>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={moreId}
          // A status in force never hides: while one of these is on, the disclosure stays open and says how to fold it.
          aria-disabled={forced ? true : undefined}
          aria-describedby={forced ? `${moreId}-hint` : undefined}
          className={cn(QUIET_ROW, 'dshx:justify-self-start dshx:aria-disabled:opacity-60')}
          onClick={() => (forced ? undefined : setOpened(current => !current))}
          data-thread-status-more=""
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn('dshx:transition-transform dshx:duration-(--dshx-duration-hover)', expanded && 'dshx:rotate-180')}
          />
          {props.t(expanded ? 'threadSidebarFilterFewerStatuses' : 'threadSidebarFilterMoreStatuses')}
        </Button>
        {forced ? (
          // Why it will not fold, on screen beside it (council round 29, item 3), and its description for a screen reader.
          <span id={`${moreId}-hint`} className="dshx:text-xs dshx:text-muted-foreground" data-thread-status-fold-hint="">
            {props.t('threadSidebarFilterFoldHint')}
          </span>
        ) : null}
        </div>
        {/* The disclosure's region stays mounted (its aria-controls target); it holds the other groups while open. */}
        <ToggleGroup
          type="multiple"
          id={moreId}
          // Not a toolbar (Radix's default): it only holds the labelled status groups (council round 29, item 13).
          role="none"
          value={revealed}
          onValueChange={next => toggle(nextStatusFilters(next), leading)}
          spacing={1}
          className="dshx:grid dshx:gap-1.5 dshx:empty:hidden dshx:pointer-coarse:gap-2"
          data-thread-status-more-region=""
        >
          {expanded
            ? THREAD_STATUS_FILTER_GROUPS.slice(1).map(group => (
                <div key={group.id} role="group" aria-labelledby={`${moreId}-${group.id}`} className={STATUS_ROW} data-thread-status-group="">
                  {/* The group's label starts its own line: its full width breaks the row. 11px tertiary, 8px above (round 29). */}
                  <span id={`${moreId}-${group.id}`} className="dshx:w-full dshx:pt-2 dshx:text-2xs dshx:text-(--dsw-alias-label-tertiary)">
                    {props.t(threadStatusFilterGroupLabelKeys[group.id])}
                  </span>
                  {group.filters.map(chip)}
                </div>
              ))
            : null}
        </ToggleGroup>
      </div>
    </section>
  )
}
