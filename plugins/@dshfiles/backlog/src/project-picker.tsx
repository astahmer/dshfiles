import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { FolderIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'

import { ItemGlyphs } from './item-glyphs.js'

/** Command values: real project paths are absolute, so neither sentinel can collide with one. */
const NO_PROJECT = '__backlog_no_project__'
const ALL_PROJECTS = '__backlog_all_projects__'

const triggerClass =
  'dshx:inline-flex dshx:h-auto dshx:w-auto dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border-0 dshx:bg-transparent dshx:px-1 dshx:outline-none dshx:transition-colors dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'

const renderProjectOption = (option: ComboboxOption): ReactNode => {
  if (option.value === NO_PROJECT) {
    return (
      <>
        <FolderIcon aria-hidden className="dshx:text-muted-foreground/50" />
        <span className="dshx:text-muted-foreground">No project</span>
      </>
    )
  }
  if (option.value === ALL_PROJECTS) {
    return (
      <>
        <FolderIcon aria-hidden />
        <span>{option.label}</span>
      </>
    )
  }
  return (
    <>
      <ItemGlyphs.ProjectDot project={option.value} />
      <span className="dshx:min-w-0 dshx:truncate">{ItemGlyphs.projectName(option.value)}</span>
      <span className="dshx:ml-auto dshx:max-w-32 dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{option.value}</span>
    </>
  )
}

/** A searchable project single-select: the one shadcn combobox shared by the header, the capture box and item details. */
export const ProjectPicker = (props: {
  readonly label: string
  readonly value: string
  readonly projects: readonly string[]
  readonly onPick: (project: string) => void
  readonly trigger: ReactNode
  readonly triggerClassName?: string
  readonly side?: 'top' | 'bottom'
  readonly align?: 'start' | 'center' | 'end'
  readonly allLabel?: string
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
}): JSX.Element => {
  const selected = props.value === ALL_PROJECTS ? null : props.value
  // The item may sit in a project the candidate list no longer offers; keep it selectable so the check mark is truthful.
  const projects = selected === null || selected === NO_PROJECT || props.projects.includes(selected) ? props.projects : [selected, ...props.projects]
  const options: readonly ComboboxOption[] = [
    ...(props.allLabel === undefined ? [] : [{ value: ALL_PROJECTS, label: props.allLabel, keywords: ['all projects', 'every project'] }]),
    { value: NO_PROJECT, label: 'No project', keywords: ['none', 'unassigned'], group: 'Project' },
    ...projects.map(project => ({
      value: project,
      label: ItemGlyphs.projectName(project),
      keywords: [project, ItemGlyphs.projectName(project)],
      group: 'Project',
    })),
  ]
  return (
    <Combobox
      align={props.align}
      contentClassName="dshx:w-64"
      emptyLabel="No project matches."
      label={props.label}
      onOpenChange={props.onOpenChange}
      onValueChange={props.onPick}
      open={props.open}
      options={options}
      renderOption={renderProjectOption}
      searchAbove={0}
      searchLabel="Search projects"
      searchPlaceholder="Search projects…"
      side={props.side}
      triggerClassName={cn(triggerClass, props.triggerClassName)}
      triggerContent={props.trigger}
      value={props.value}
    />
  )
}

export class BacklogProjects {
  /** Neither sentinel can collide with a real candidate, because every project path is absolute. */
  static readonly none = NO_PROJECT
  static readonly all = ALL_PROJECTS
}
