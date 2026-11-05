import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { CalendarIcon, CheckIcon, FolderIcon, RepeatIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'

import { BacklogItems, type BacklogAttention, type BacklogKind, type BacklogPriority, type BacklogStatus } from './item.js'
import { WorkGlyphs } from './work-glyphs.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogProjects, ProjectPicker } from './project-picker.js'
import { DueDates } from './due-date.js'
import { Recurrence } from './recurrence.js'

const triggerClass =
  'dshx:inline-flex dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:outline-none dshx:transition-colors dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'

/** A Linear-style property picker: the trigger is the current value, the menu lists every value with its glyph. */
const Picker = <Value extends string>(props: {
  readonly label: string
  readonly value: Value
  readonly values: readonly Value[]
  readonly render: (value: Value) => ReactNode
  readonly onPick: (value: Value) => void
  readonly trigger: ReactNode
  readonly triggerClassName?: string
  /** The key that picks a value while the menu is open; the position from 1 by default. */
  readonly shortcutOf?: (value: Value, index: number) => string
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const shortcutOf = props.shortcutOf ?? ((_value: Value, index: number) => String(index + 1))
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger aria-label={props.label} className={cn(triggerClass, props.triggerClassName)} onClick={event => event.stopPropagation()}>
        {props.trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="dshx-root dshx:min-w-44"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          const picked = props.values.find((value, index) => shortcutOf(value, index) === event.key)
          if (picked === undefined) return
          event.preventDefault()
          props.onPick(picked)
          setOpen(false)
        }}
      >
        <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">{props.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {props.values.map((value, index) => (
          <DropdownMenuItem key={value} onSelect={() => props.onPick(value)} className="dshx:gap-2 dshx:text-[13px]">
            {props.render(value)}
            {value === props.value ? <CheckIcon aria-hidden className="dshx:ml-auto dshx:size-3.5" /> : null}
            {value === props.value ? null : <DropdownMenuShortcut>{shortcutOf(value, index)}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const StatusPicker = (props: {
  readonly itemLabel: string
  readonly status: BacklogStatus
  readonly onPick: (status: BacklogStatus) => void
  readonly withLabel?: boolean
}): JSX.Element => (
  <Picker
    label={`Status of ${props.itemLabel}`}
    value={props.status}
    values={BacklogItems.statuses}
    onPick={props.onPick}
    triggerClassName={props.withLabel === true ? 'dshx:h-7 dshx:px-2 dshx:text-[13px]' : 'dshx:size-6 dshx:justify-center'}
    trigger={
      <>
        <ItemGlyphs.StatusIcon status={props.status} />
        {props.withLabel === true ? <span>{ItemGlyphs.statusLabels[props.status]}</span> : null}
      </>
    }
    render={status => (
      <>
        <ItemGlyphs.StatusIcon status={status} />
        {ItemGlyphs.statusLabels[status]}
      </>
    )}
  />
)

const KindPicker = (props: { readonly itemLabel: string; readonly kind: BacklogKind; readonly onPick: (kind: BacklogKind) => void }): JSX.Element => (
  <Picker
    label={`Kind of ${props.itemLabel}`}
    value={props.kind}
    values={BacklogItems.kinds}
    onPick={props.onPick}
    triggerClassName="dshx:h-7 dshx:px-2 dshx:text-[13px]"
    trigger={
      <>
        <ItemGlyphs.KindIcon kind={props.kind} />
        <span>{ItemGlyphs.kindLabels[props.kind]}</span>
      </>
    }
    render={kind => (
      <>
        <ItemGlyphs.KindIcon kind={kind} />
        {ItemGlyphs.kindLabels[kind]}
      </>
    )}
  />
)

const ProjectPickerField = (props: {
  readonly itemLabel: string
  readonly project: string | null
  readonly projects: readonly string[]
  readonly onPick: (project: string | null) => void
}): JSX.Element => (
  <ProjectPicker
    label={`Project of ${props.itemLabel}`}
    value={props.project ?? BacklogProjects.none}
    projects={props.projects}
    onPick={value => props.onPick(value === BacklogProjects.none ? null : value)}
    triggerClassName="dshx:h-7 dshx:px-1.5 dshx:text-[13px]"
    trigger={
      props.project === null ? (
        <>
          <FolderIcon aria-hidden className="dshx:size-3.5 dshx:text-muted-foreground/60" />
          <span className="dshx:text-muted-foreground">Project</span>
        </>
      ) : (
        <>
          <ItemGlyphs.ProjectDot project={props.project} />
          <span className="dshx:max-w-48 dshx:truncate">{ItemGlyphs.projectName(props.project)}</span>
        </>
      )
    }
  />
)

const AttentionPicker = (props: {
  readonly itemLabel: string
  readonly attention: BacklogAttention
  readonly onPick: (attention: BacklogAttention) => void
}): JSX.Element => (
  <Picker
    label={`Attention of ${props.itemLabel}`}
    value={props.attention}
    values={BacklogItems.attentions}
    onPick={props.onPick}
    triggerClassName="dshx:h-7 dshx:px-1.5 dshx:text-[13px]"
    trigger={
      props.attention === 'none' ? <span className="dshx:text-muted-foreground">Attention</span> : <ItemGlyphs.AttentionBadge attention={props.attention} />
    }
    render={attention =>
      attention === 'none' ? <span className="dshx:text-muted-foreground">No attention</span> : <ItemGlyphs.AttentionBadge attention={attention} />
    }
  />
)

/** Linear's keys: 0 clears, 1 urgent to 4 low. */
const priorityShortcut = (priority: BacklogPriority): string => String(BacklogItems.priorities.indexOf(priority))

const PriorityPicker = (props: {
  readonly itemLabel: string
  readonly priority: BacklogPriority
  readonly onPick: (priority: BacklogPriority) => void
  readonly withLabel?: boolean
}): JSX.Element => (
  <Picker
    label={`Priority of ${props.itemLabel}`}
    value={props.priority}
    values={BacklogItems.priorities}
    onPick={props.onPick}
    shortcutOf={priorityShortcut}
    triggerClassName={props.withLabel === true ? 'dshx:h-7 dshx:px-2 dshx:text-[13px]' : 'dshx:size-6 dshx:justify-center'}
    trigger={
      <>
        <WorkGlyphs.PriorityIcon priority={props.priority} />
        {props.withLabel === true ? (
          <span className={props.priority === 'none' ? 'dshx:text-muted-foreground' : undefined}>{WorkGlyphs.priorityLabels[props.priority]}</span>
        ) : null}
      </>
    }
    render={priority => (
      <>
        <WorkGlyphs.PriorityIcon priority={priority} />
        {WorkGlyphs.priorityLabels[priority]}
      </>
    )}
  />
)

/** The quick due dates a menu offers, from today on the reader's calendar. */
const dueShortcuts = (today: string) =>
  [
    { label: 'Today', due: today },
    { label: 'Tomorrow', due: DueDates.addDays(today, 1) },
    { label: 'In a week', due: DueDates.addDays(today, 7) },
    { label: 'In a month', due: DueDates.addMonths(today, 1) },
  ] as const

/** A date-only due date: quick picks, any calendar date, or none. */
const DuePicker = (props: {
  readonly itemLabel: string
  readonly due: string | null
  readonly overdue: boolean
  readonly onPick: (due: string | null) => void
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const today = DueDates.dateOf(Date.now())
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={`Due date of ${props.itemLabel}`}
        className={cn(triggerClass, 'dshx:h-7 dshx:px-1.5 dshx:text-xs', props.overdue ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}
        onClick={event => event.stopPropagation()}
      >
        <CalendarIcon aria-hidden className="dshx:size-3.5" />
        {props.due === null ? 'Due date' : DueDates.label({ due: props.due, today })}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="dshx-root dshx:min-w-52" onClick={event => event.stopPropagation()}>
        <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">Due date</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {dueShortcuts(today).map(shortcut => (
          <DropdownMenuItem key={shortcut.label} onSelect={() => props.onPick(shortcut.due)} className="dshx:gap-2 dshx:text-[13px]">
            {shortcut.label}
            <span className="dshx:ml-auto dshx:text-[11px] dshx:text-muted-foreground">{shortcut.due}</span>
          </DropdownMenuItem>
        ))}
        <div className="dshx:px-2 dshx:py-1.5" onKeyDown={event => event.stopPropagation()}>
          <input
            type="date"
            aria-label="Pick a due date"
            value={props.due ?? ''}
            className="dshx:h-8 dshx:w-full dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-xs"
            onChange={event => {
              const value = event.currentTarget.value
              if (value === '') return
              props.onPick(value)
              setOpen(false)
            }}
          />
        </div>
        {props.due === null ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => props.onPick(null)} className="dshx:text-[13px]">
              Clear due date
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const recurrencePresets = ['daily', 'weekly', 'monthly'] as const

/** How an item repeats: finishing it creates the next occurrence on the Host. */
const RecurrencePicker = (props: { readonly itemLabel: string; readonly recurrence: string | null; readonly onPick: (recurrence: string | null) => void }): JSX.Element => {
  const [open, setOpen] = useState(false)
  const [cron, setCron] = useState(props.recurrence?.startsWith('cron:') === true ? props.recurrence.slice(5) : '')
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={`Repeat ${props.itemLabel}`}
        className={cn(triggerClass, 'dshx:h-7 dshx:px-1.5 dshx:text-xs dshx:text-muted-foreground', props.recurrence === null ? '' : 'dshx:text-foreground')}
        onClick={event => event.stopPropagation()}
      >
        <RepeatIcon aria-hidden className="dshx:size-3.5" />
        {props.recurrence === null ? 'Repeat' : Recurrence.label(props.recurrence)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="dshx-root dshx:min-w-56" onClick={event => event.stopPropagation()}>
        <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">Repeat when done</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recurrencePresets.map(preset => (
          <DropdownMenuItem key={preset} onSelect={() => props.onPick(preset)} className="dshx:gap-2 dshx:text-[13px]">
            {Recurrence.label(preset)}
            {props.recurrence === preset ? <CheckIcon aria-hidden className="dshx:ml-auto dshx:size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
        <form
          className="dshx:px-2 dshx:py-1.5"
          onKeyDown={event => event.stopPropagation()}
          onSubmit={event => {
            event.preventDefault()
            if (cron.trim() === '') return
            props.onPick(`cron:${cron.trim()}`)
            setOpen(false)
          }}
        >
          <input
            aria-label="Cron rule"
            placeholder="cron: 0 9 * * 1"
            value={cron}
            onChange={event => setCron(event.currentTarget.value)}
            className="dshx:h-8 dshx:w-full dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:font-mono! dshx:text-xs"
          />
        </form>
        {props.recurrence === null ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => props.onPick(null)} className="dshx:text-[13px]">
              Stop repeating
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export class ItemPickers {
  static readonly Recurrence = RecurrencePicker
  static readonly Due = DuePicker
  static readonly dueShortcuts = dueShortcuts
  static readonly Priority = PriorityPicker
  static readonly priorityShortcut = priorityShortcut
  static readonly Status = StatusPicker
  static readonly Kind = KindPicker
  static readonly Attention = AttentionPicker
  static readonly Project = ProjectPickerField
}
