import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@dshfiles/plugin-ui/components/ui/popover'
import { CheckIcon, ChevronDown } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'

interface BaseOption {
  /** `''` is the default: no override, the Host picks the project's main branch. */
  readonly value: string
  readonly label: string
}

/** The rows: the default first, then the repository's other bookmarks, then a typed override no bookmark matches. */
const optionsOf = (props: { readonly base: string | undefined; readonly value: string; readonly bookmarks: readonly string[] }): readonly BaseOption[] => {
  const others = props.bookmarks.filter(bookmark => bookmark !== props.base)
  return [
    { value: '', label: props.base ?? 'default' },
    ...others.map(bookmark => ({ value: bookmark, label: bookmark })),
    ...(props.value === '' || props.value === props.base || others.includes(props.value) ? [] : [{ value: props.value, label: props.value }]),
  ]
}

/**
 * Review's "Compare against" field (council round 8, D3): a branch/bookmark combobox, 176 px, with a chevron. Empty, it
 * shows the base the Host used in ink with a muted "default" tag; a typed or chosen bookmark replaces both, and the
 * list's first row returns to the default. Type any revision, or pick a bookmark from the list (Alt+↓ or the chevron).
 */
export const BaseCombobox = (props: {
  readonly id: string
  /** The base the last review used when no override is set; `undefined` before the first read. */
  readonly base: string | undefined
  readonly value: string
  readonly onValueChange: (value: string) => void
  /** The repository's bookmarks, when the project is known. */
  readonly bookmarks?: readonly string[] | undefined
}): ReactNode => {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const options = optionsOf({ base: props.base, value: props.value, bookmarks: props.bookmarks ?? [] })
  const chosen = props.value === props.base ? '' : props.value
  const choose = (value: string): void => {
    props.onValueChange(value)
    setOpen(false)
  }
  const show = (): void => {
    setActive(Math.max(0, options.findIndex(option => option.value === chosen)))
    setOpen(true)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return show()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(index => (index + step + options.length) % options.length)
      return
    }
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[active]
      if (option !== undefined) choose(option.value)
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="dshx:relative dshx:w-44 dshx:max-w-full" data-review-base-field>
          <Input
            id={props.id}
            role="combobox"
            aria-autocomplete="none"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open ? `${listId}-${String(active)}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder={props.base ?? 'default'}
            value={props.value}
            onChange={event => props.onValueChange(event.target.value)}
            onKeyDown={onKeyDown}
            className={cn('dshx:w-full dshx:pr-8 dshx:tabular-nums', props.base !== undefined && 'dshx:placeholder:text-foreground', props.value === '' && 'dshx:pr-20')}
          />
          {props.value === '' ? (
            <span
              aria-hidden
              data-review-base-default
              className="dshx:pointer-events-none dshx:absolute dshx:top-1/2 dshx:right-8 dshx:-translate-y-1/2 dshx:text-xs dshx:text-muted-foreground"
            >
              default
            </span>
          ) : null}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Show bases"
            onClick={() => (open ? setOpen(false) : show())}
            className="dshx:absolute dshx:inset-y-0 dshx:right-0 dshx:flex dshx:w-8 dshx:items-center dshx:justify-center dshx:rounded-r-lg dshx:text-muted-foreground dshx:pointer-coarse:w-11"
          >
            <ChevronDown aria-hidden className="dshx:size-4" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        role="listbox"
        id={listId}
        aria-label="Bases"
        onOpenAutoFocus={event => event.preventDefault()}
        className="dshx-root dshx:max-h-64 dshx:w-56 dshx:p-1"
      >
        {options.map((option, index) => (
          <div
            key={option.value === '' ? ':default' : option.value}
            id={`${listId}-${String(index)}`}
            role="option"
            aria-selected={option.value === chosen}
            data-active={index === active || undefined}
            onMouseDown={event => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(option.value)}
            className="dshx:flex dshx:min-h-8 dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-sm dshx:data-active:bg-accent dshx:pointer-coarse:min-h-11"
          >
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{option.label}</span>
            {option.value === '' ? <span className="dshx:text-xs dshx:text-muted-foreground">default</span> : null}
            <CheckIcon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0', option.value === chosen ? 'dshx:opacity-100' : 'dshx:opacity-0')} />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
