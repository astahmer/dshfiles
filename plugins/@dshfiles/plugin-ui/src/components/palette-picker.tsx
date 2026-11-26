import * as React from 'react'
import { cn } from '../lib/utils.js'
import { DEFAULT_IDENTITY_NAMES, IDENTITY_SLOT_COUNT, IdentityPalette, PALETTE_NAMES_ATTRIBUTE, wrapIdentitySlot } from '../theme/identity-palette.js'
import { projectToneIndex } from './ui/project-mark.js'

export { DEFAULT_IDENTITY_NAMES, IDENTITY_SLOT_COUNT }

/** The theme-aware class that sets `color:` to a slot's tone (the `project-tone-balanced-<n>` classes in styles.css). */
export const identityToneClass = (slot: number): string => `project-tone-balanced-${wrapIdentitySlot(slot)}`

/** A slot's tone as a CSS colour, for a solid swatch or a `color-mix` wash. */
export const identityToneColor = (slot: number): string => `var(--dshx-project-balanced-${wrapIdentitySlot(slot)})`

/** The slot a thing gets when nobody picked one: the shared name hash, the same one `ProjectMark` uses. */
export const identityToneIndex = projectToneIndex

/** A slot's name for people: the first letter raised (`azure` → `Azure`). */
export const identitySlotName = (slot: number, names: readonly string[] = DEFAULT_IDENTITY_NAMES): string => {
  const name = names[wrapIdentitySlot(slot)] ?? `Colour ${wrapIdentitySlot(slot) + 1}`
  return name.charAt(0).toLocaleUpperCase() + name.slice(1)
}

const namesSnapshot = (): string => {
  const dark = document.body?.hasAttribute('data-ds-dark-theme') === true
  return `${dark ? 'dark' : 'light'}|${document.documentElement.getAttribute(PALETTE_NAMES_ATTRIBUTE) ?? ''}`
}

const subscribeNames = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [PALETTE_NAMES_ATTRIBUTE],
  })
  if (document.body !== null)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme'],
    })
  return () => observer.disconnect()
}

/**
 * The six slot names of the active theme in the current scheme: the theme's `paletteNames`, "Colour 1"… for a theme
 * without names, or the default theme's (azure, olive, copper, violet, magenta, teal). Follows theme and scheme changes.
 */
export function useIdentityPaletteNames(): readonly string[] {
  const snapshot = React.useSyncExternalStore(subscribeNames, namesSnapshot, () => '')
  return React.useMemo(() => {
    const split = snapshot.indexOf('|')
    const dark = snapshot.slice(0, split) === 'dark'
    return IdentityPalette.namesFor(IdentityPalette.parseNames(snapshot.slice(split + 1)), dark)
  }, [snapshot])
}

export interface PalettePickerProps {
  /** The chosen slot (0–5); `undefined` while nothing is chosen. */
  readonly value: number | undefined
  readonly onChange: (slot: number) => void
  /** The group's accessible name ("Project colour"); render a visible label beside it yourself. */
  readonly label: string
  /** The slot in effect while nothing is chosen (usually `identityToneIndex(name)`); marked "Default". */
  readonly defaultSlot?: number | undefined
  /** `sm`: 16px swatches in a 24px seat; `md` (default): 20px in 28px. Both seats are 44px on a coarse pointer. */
  readonly size?: 'sm' | 'md' | undefined
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

/** The slot a key moves to from `slot`, or undefined for any other key. */
const slotAfterKey = (key: string, slot: number): number | undefined => {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return wrapIdentitySlot(slot + 1)
    case 'ArrowLeft':
    case 'ArrowUp':
      return wrapIdentitySlot(slot - 1)
    case 'Home':
      return 0
    case 'End':
      return IDENTITY_SLOT_COUNT - 1
    default:
      return undefined
  }
}

/**
 * Six round swatches of the active theme's identity palette as one radio group (owner decision of 2026-11-26): a
 * choice stores the slot, so the colour follows the theme. The chosen swatch has a solid ink ring; with nothing chosen
 * the default slot has a dashed one and "Default" in its name. Arrow keys move and choose, Home and End jump to the ends.
 */
export function PalettePicker({ value, onChange, label, defaultSlot, size = 'md', disabled, className }: PalettePickerProps): React.JSX.Element {
  const names = useIdentityPaletteNames()
  const chosen = value === undefined ? undefined : wrapIdentitySlot(value)
  const fallback = defaultSlot === undefined ? undefined : wrapIdentitySlot(defaultSlot)
  const current = chosen ?? fallback
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([])
  const choose = (slot: number) => {
    buttons.current[slot]?.focus()
    onChange(slot)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, slot: number) => {
    const target = slotAfterKey(event.key, slot)
    if (target === undefined) return
    event.preventDefault()
    choose(target)
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled === true ? true : undefined}
      data-slot="palette-picker"
      data-size={size}
      className={cn('dshx:inline-flex dshx:items-center dshx:gap-0.5', className)}
    >
      {Array.from({ length: IDENTITY_SLOT_COUNT }, (_, slot) => {
        const selected = chosen === slot
        const isDefault = chosen === undefined && fallback === slot
        const name = identitySlotName(slot, names)
        const accessibleName = isDefault ? `${name}, Default` : name
        return (
          <button
            key={slot}
            ref={element => {
              buttons.current[slot] = element
            }}
            type="button"
            role="radio"
            aria-checked={selected || isDefault}
            aria-label={accessibleName}
            data-slot="palette-swatch"
            data-palette-slot={slot}
            data-state={selected ? 'checked' : isDefault ? 'default' : 'unchecked'}
            tabIndex={slot === (current ?? 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => choose(slot)}
            onKeyDown={event => onKeyDown(event, slot)}
            className={cn(
              'dshx:group dshx:inline-flex dshx:shrink-0 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:rounded-full dshx:outline-none dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50',
              size === 'sm' ? 'dshx:size-6' : 'dshx:size-7',
              'dshx:pointer-coarse:size-11',
            )}
          >
            <span
              aria-hidden
              data-slot="palette-swatch-ring"
              className={cn(
                'dshx:flex dshx:items-center dshx:justify-center dshx:rounded-full dshx:border-2 dshx:transition-[border-color,box-shadow] dshx:duration-(--dshx-duration-hover)',
                'dshx:group-focus-visible:ring-[3px] dshx:group-focus-visible:ring-ring/50',
                size === 'sm' ? 'dshx:size-6' : 'dshx:size-7',
                selected
                  ? 'dshx:border-foreground'
                  : isDefault
                    ? 'dshx:border-dashed dshx:border-foreground'
                    : 'dshx:border-transparent dshx:group-enabled:group-hover:border-border',
              )}
            >
              <span
                data-slot="palette-swatch-tone"
                className={cn('dshx:block dshx:rounded-full', size === 'sm' ? 'dshx:size-4' : 'dshx:size-5')}
                style={{ backgroundColor: identityToneColor(slot) }}
              />
            </span>
          </button>
        )
      })}
    </div>
  )
}
