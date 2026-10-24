import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { CheckIcon, FolderIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'

import { ItemGlyphs } from './item-glyphs.js'
import { BacklogProjectPaths } from './project-paths.js'

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
      <span className="dshx:ml-auto dshx:max-w-32 dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">
        {ItemGlyphs.displayProjectPath(option.value)}
      </span>
    </>
  )
}

/** Searchable single-project picker used by capture and item details. */
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
      trigger={props.trigger}
      value={props.value}
    />
  )
}

export const ProjectFilterPicker = (props: {
  readonly label: string
  readonly selection: readonly (string | null)[]
  readonly projects: readonly string[]
  readonly onPick: (selection: readonly (string | null)[]) => void
  readonly trigger: ReactNode
  readonly triggerClassName?: string
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const projects = [...new Set([...props.selection.flatMap(project => (project === null ? [] : [project])), ...props.projects])]
  const toggle = (project: string | null): void => {
    props.onPick(BacklogProjectPaths.toggleSelection(props.selection, project))
  }
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={props.label}
        className={cn(triggerClass, props.triggerClassName)}
        role="combobox"
        type="button"
      >
        {props.trigger}
      </PopoverTrigger>
      <PopoverContent align="end" className="dshx-root dshx:w-80 dshx:p-0">
        <Command label={`${props.label} search`}>
          <CommandInput aria-label="Search projects" autoFocus placeholder="Search projects…" />
          <CommandList>
            <CommandEmpty>No project matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => props.onPick([])} value={ALL_PROJECTS}>
                <FolderIcon aria-hidden />
                <span className="dshx:min-w-0 dshx:flex-1">All projects</span>
                {props.selection.length === 0 ? <CheckIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" /> : null}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Project">
              <CommandItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => toggle(null)} value={NO_PROJECT}>
                <FolderIcon aria-hidden className="dshx:text-muted-foreground/50" />
                <span className="dshx:min-w-0 dshx:flex-1 dshx:text-muted-foreground">No project</span>
                {props.selection.includes(null) ? <CheckIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" /> : null}
              </CommandItem>
              {projects.map(project => (
                <CommandItem
                  className="dshx:gap-2 dshx:text-[13px]"
                  key={project}
                  keywords={[project, ItemGlyphs.displayProjectPath(project), ItemGlyphs.projectName(project)]}
                  onSelect={() => toggle(project)}
                  value={project}
                >
                  <ItemGlyphs.ProjectDot project={project} />
                  <span className="dshx:min-w-0 dshx:truncate">{ItemGlyphs.projectName(project)}</span>
                  <span className="dshx:ml-auto dshx:max-w-40 dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">
                    {ItemGlyphs.displayProjectPath(project)}
                  </span>
                  {props.selection.includes(project) ? <CheckIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export class BacklogProjects {
  /** Neither sentinel can collide with a real candidate, because every project path is absolute. */
  static readonly none = NO_PROJECT
  static readonly all = ALL_PROJECTS
}
