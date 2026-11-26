/**
 * The identity palette (DESIGN.md › Colour roles 5, owner decision of 2026-11-26): six colour slots a user picks for
 * a project, a Backlog tag or a configured agent. A choice stores the slot (0–5), never a colour, so a theme change
 * recolours every chosen thing. The default theme's slots are the `--dshx-project-balanced-<n>` values in styles.css; a
 * theme writes its own over them while it is active (`ThemeDefinitionModel.css`).
 *
 * The active theme's slot names reach the page as `PALETTE_NAMES_ATTRIBUTE` on `<html>` (each plugin bundles its own
 * copy of the kit, so a module-level store would not be shared): JSON `{ "light"?: string[6], "dark"?: string[6] }`.
 * A scheme left out uses the default theme's slots and names.
 */
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

export const IDENTITY_SLOT_COUNT = 6

/** The default theme's slot names, index for index with `--dshx-project-balanced-0..5`. */
export const DEFAULT_IDENTITY_NAMES = ['azure', 'olive', 'copper', 'violet', 'magenta', 'teal'] as const

/** `--dshx-project-cool-<n>` is `--dshx-project-balanced-<COOL_ORDER[n]>` (the permutation styles.css declares). */
export const COOL_ORDER = [0, 5, 3, 4, 1, 2] as const

export const PALETTE_NAMES_ATTRIBUTE = 'data-dshx-palette-names'

/** A slot index wrapped into 0–5, so any stored or hashed number names a slot. */
export const wrapIdentitySlot = (slot: number): number => {
  const whole = Number.isFinite(slot) ? Math.trunc(slot) : 0
  return ((whole % IDENTITY_SLOT_COUNT) + IDENTITY_SLOT_COUNT) % IDENTITY_SLOT_COUNT
}

/** Slot names per scheme, as `PALETTE_NAMES_ATTRIBUTE` carries them. */
export interface IdentityNames {
  readonly light?: readonly string[]
  readonly dark?: readonly string[]
}

/** "Colour 1" … "Colour 6": the names of a theme's slots when the theme gives none. */
export const GENERIC_IDENTITY_NAMES: readonly string[] = Array.from({ length: IDENTITY_SLOT_COUNT }, (_, slot) => `Colour ${slot + 1}`)

const isNameList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length === IDENTITY_SLOT_COUNT && value.every(name => typeof name === 'string' && name.trim() !== '')

/** The attribute's JSON: each scheme's list is checked for six names by `isNameList`. */
const decodeAttribute = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ light: Schema.optional(Schema.Unknown), dark: Schema.optional(Schema.Unknown) })),
)

/** The attribute's value parsed; anything malformed reads as "no theme names" (the default names apply). */
function parseNames(raw: string | null | undefined): IdentityNames {
  if (raw === null || raw === undefined || raw === '') return {}
  const decoded = decodeAttribute(raw)
  if (Option.isNone(decoded)) return {}
  const { light, dark } = decoded.value
  let names: IdentityNames = {}
  if (isNameList(light)) names = { ...names, light }
  if (isNameList(dark)) names = { ...names, dark }
  return names
}

/** The attribute's value for some names, or `''` (remove the attribute) when neither scheme has any. */
function serializeNames(names: IdentityNames): string {
  if (names.light === undefined && names.dark === undefined) return ''
  return JSON.stringify(names)
}

/** The six names in effect for a scheme: the theme's, else the default theme's. */
function namesFor(names: IdentityNames, dark: boolean): readonly string[] {
  return (dark ? names.dark : names.light) ?? DEFAULT_IDENTITY_NAMES
}

/** Identity slots: wrapping, names and their page attribute. */
export class IdentityPalette {
  static readonly parseNames = parseNames
  static readonly serializeNames = serializeNames
  static readonly namesFor = namesFor
}
