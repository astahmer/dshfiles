import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { CheckIcon, FolderIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'

import { ItemGlyphs } from './item-glyphs.js'

/** Command values: real project paths are absolute, so neither sentinel can collide with one. */
const NO_PROJECT = '__backlog_no_project__'
const ALL_PROJECTS = '__backlog_all_projects__'

const triggerClass =
  'dshx:inline-flex dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:outline-none dshx:transition-colors dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'

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
  const [uncontrolled, setUncontrolled] = useState(false)
  const open = props.open ?? uncontrolled
  const setOpen = (next: boolean): void => {
    setUncontrolled(next)
    props.onOpenChange?.(next)
  }
  const pick = (project: string): void => {
    props.onPick(project)
    setOpen(false)
  }
  const selected = props.value === ALL_PROJECTS ? null : props.value
  // The item may sit in a project the candidate list no longer offers; keep it selectable so the check mark is truthful.
  const projects = selected === null || selected === NO_PROJECT || props.projects.includes(selected) ? props.projects : [selected, ...props.projects]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={props.label} className={cn(triggerClass, props.triggerClassName)}>
        {props.trigger}
      </PopoverTrigger>
      <PopoverContent align={props.align ?? 'start'} side={props.side ?? 'bottom'} className="dshx-root dshx:w-64 dshx:p-0">
        <Command>
          <CommandInput aria-label="Search projects" placeholder="Search projects…" autoFocus />
          <CommandList>
            <CommandEmpty>No project matches.</CommandEmpty>
            <CommandGroup heading="Project">
              {props.allLabel === undefined ? null : (
                <>
                  <CommandItem
                    value={ALL_PROJECTS}
                    keywords={['all projects', 'every project']}
                    onSelect={() => pick(ALL_PROJECTS)}
                    className="dshx:gap-2 dshx:text-[13px]"
                  >
                    <FolderIcon aria-hidden />
                    <span>{props.allLabel}</span>
                    {props.value === ALL_PROJECTS ? <CheckIcon aria-hidden className="dshx:ml-auto dshx:size-3.5" /> : null}
                  </CommandItem>
                  <CommandSeparator />
                </>
              )}
              <CommandItem
                value={NO_PROJECT}
                keywords={['no project', 'none', 'unassigned']}
                onSelect={() => pick(NO_PROJECT)}
                className="dshx:gap-2 dshx:text-[13px]"
              >
                <FolderIcon aria-hidden className="dshx:text-muted-foreground/50" />
                <span className="dshx:text-muted-foreground">No project</span>
                {selected === NO_PROJECT ? <CheckIcon aria-hidden className="dshx:ml-auto dshx:size-3.5" /> : null}
              </CommandItem>
              {projects.map(project => (
                <CommandItem key={project} value={project} onSelect={() => pick(project)} className="dshx:gap-2 dshx:text-[13px]">
                  <ItemGlyphs.ProjectDot project={project} />
                  <span className="dshx:min-w-0 dshx:truncate">{ItemGlyphs.projectName(project)}</span>
                  <span className="dshx:ml-auto dshx:max-w-32 dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{project}</span>
                  {selected === project ? <CheckIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" /> : null}
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
