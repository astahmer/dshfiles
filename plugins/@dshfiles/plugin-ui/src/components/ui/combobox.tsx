'use client'

import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

import { cn } from '../../lib/utils.js'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command.js'
import { Popover, PopoverContent, PopoverTrigger } from './popover.js'

/** One row of a combobox: the value it selects, what it shows, and what a search may also match. */
export interface ComboboxOption {
  readonly value: string
  readonly label: string
  /** A muted right-aligned second text, such as a path or a hint; the trigger keeps only the label. */
  readonly description?: string
  /** Extra search terms the row should match, such as a project's handle or a model's provider. */
  readonly keywords?: readonly string[]
  /** Rows sharing a group render under one heading, in first-seen order. */
  readonly group?: string
  readonly disabled?: boolean | undefined
}

const triggerClass =
  'dshx:flex dshx:h-8 dshx:w-full dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-2 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-left dshx:text-sm dshx:text-foreground dshx:outline-none dshx:transition-[color,box-shadow] dshx:focus-visible:border-ring dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50'

const groupOf = (options: readonly ComboboxOption[]): readonly { readonly name: string | undefined; readonly options: readonly ComboboxOption[] }[] =>
  options.reduce<{ readonly name: string | undefined; readonly options: ComboboxOption[] }[]>((groups, option) => {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.name === option.group) {
      last.options.push(option)
      return groups
    }
    groups.push({ name: option.group, options: [option] })
    return groups
  }, [])

/**
 * A searchable single-select: the trigger shows the current label, the popover filters rows as you type. Search appears
 * above `searchAbove` rows, so a short fixed list stays a plain menu; a custom `trigger` renders a chip instead of the
 * field box.
 */
export const Combobox = (props: {
  /** Accessible name of the trigger. */
  readonly label: string
  readonly value: string
  readonly options: readonly ComboboxOption[]
  readonly onValueChange: (value: string) => void
  readonly placeholder?: string | undefined
  readonly searchLabel?: string | undefined
  readonly searchPlaceholder?: string | undefined
  readonly emptyLabel?: string | undefined
  readonly searchAbove?: number | undefined
  readonly disabled?: boolean | undefined
  /** Replaces the trigger's label text; the chevron and combobox semantics stay. */
  readonly trigger?: React.ReactNode | undefined
  /** Replaces the whole trigger body, including the chevron, for a chip-style picker. */
  readonly triggerContent?: React.ReactNode | undefined
  readonly triggerClassName?: string | undefined
  readonly contentClassName?: string | undefined
  /** Sizes the popover to the trigger, for a field inside a dialog or a grid; chips keep the default width. */
  readonly matchTriggerWidth?: boolean | undefined
  readonly align?: 'start' | 'center' | 'end' | undefined
  readonly side?: 'top' | 'bottom' | undefined
  readonly renderOption?: ((option: ComboboxOption) => React.ReactNode) | undefined
  readonly open?: boolean | undefined
  readonly onOpenChange?: ((open: boolean) => void) | undefined
}): JSX.Element => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = props.open ?? uncontrolledOpen
  const setOpen = (next: boolean): void => {
    setUncontrolledOpen(next)
    props.onOpenChange?.(next)
  }
  const selected = props.options.find(option => option.value === props.value)
  const searchable = props.options.length > (props.searchAbove ?? 7)
  const pick = (option: ComboboxOption): void => {
    if (option.disabled === true) return
    props.onValueChange(option.value)
    setOpen(false)
  }
  const triggerBody = props.triggerContent ?? props.trigger ?? (
    <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', selected === undefined && 'dshx:text-muted-foreground')}>
      {selected?.label ?? props.placeholder ?? 'Select…'}
    </span>
  )
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={props.label}
        className={cn(triggerClass, props.triggerClassName)}
        disabled={props.disabled}
        role="combobox"
        type="button"
      >
        {triggerBody}
        {props.triggerContent === undefined ? <ChevronDownIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:opacity-50" /> : null}
      </PopoverTrigger>
      <PopoverContent
        align={props.align ?? 'start'}
        side={props.side ?? 'bottom'}
        className={cn(
          'dshx-root dshx:p-0',
          props.matchTriggerWidth === true ? 'dshx:w-(--radix-popover-trigger-width) dshx:min-w-56' : 'dshx:w-64',
          props.contentClassName,
        )}
      >
        <Command label={props.searchLabel ?? `${props.label} search`}>
          {searchable ? (
            <CommandInput aria-label={props.searchLabel ?? `${props.label} search`} autoFocus placeholder={props.searchPlaceholder ?? 'Search…'} />
          ) : null}
          <CommandList autoFocus={!searchable}>
            <CommandEmpty>{props.emptyLabel ?? 'No match.'}</CommandEmpty>
            {groupOf(props.options).map(group => (
              <CommandGroup heading={group.name} key={group.name ?? ''}>
                {group.options.map(option => (
                  <CommandItem
                    className="dshx:gap-2 dshx:text-[13px]"
                    disabled={option.disabled === true}
                    key={option.value}
                    keywords={[option.label, ...(option.description === undefined ? [] : [option.description]), ...(option.keywords ?? [])]}
                    onSelect={() => pick(option)}
                    value={option.value}
                  >
                    {props.renderOption?.(option) ?? (
                      <>
                        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{option.label}</span>
                        {option.description === undefined ? null : (
                          <span className="dshx:max-w-32 dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{option.description}</span>
                        )}
                      </>
                    )}
                    {selected === option ? <CheckIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
