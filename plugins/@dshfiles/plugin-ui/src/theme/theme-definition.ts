/**
 * Theme definitions: a theme as data (exact colours per scheme, optional syntax colours and an animated backdrop), so a
 * new theme is a settings value an agent can write, applied live, instead of code and a Host restart. Built-in themes
 * (Dracula) use the same format.
 *
 * A definition never replaces the generator: the generated blocks still retune every Host ramp from the theme's own hue
 * (read from its background and accent), then the definition pins the eleven steps, the accent and status colours and
 * the Shiki tokens it gives. A scheme the definition leaves out keeps the generated palette.
 */
import type * as Schema from 'effect/Schema'
import { IdentityDerivation } from './identity-derivation.ts'
import { COOL_ORDER, IDENTITY_SLOT_COUNT } from './identity-palette.ts'
import { PaletteMath, type PaletteInput, type Scheme } from './palette.ts'
import { ReadabilityModel, type Rgb, type VeilInput } from './readability.ts'
import { SCENE_IDS, SceneCatalog, type SceneGlass } from './scene-catalog.ts'

/** The eleven neutral steps, in palette order (see `Palette.neutral`). */
export const NEUTRAL_ROLES = ['bg', 'panel', 'raised', 'selected', 'line', 'border', 'borderStrong', 'strong', 'faint', 'muted', 'text'] as const
export const ACCENT_ROLES = ['accent', 'onAccent', 'success', 'warning', 'danger', 'info'] as const
export const SYNTAX_ROLES = ['comment', 'punctuation', 'constant', 'keyword', 'parameter', 'function', 'string'] as const

export type NeutralRole = (typeof NEUTRAL_ROLES)[number]
export type AccentRole = (typeof ACCENT_ROLES)[number]
export type SyntaxRole = (typeof SYNTAX_ROLES)[number]
export type ColourRole = NeutralRole | AccentRole

/** What each role colours, for the agent tool description and the docs. */
export const ROLE_GUIDE = {
  bg: 'app and conversation background',
  panel: 'sidebar, cards and code blocks',
  raised: 'hover, bubbles and the composer',
  selected: 'selected rows and active items',
  line: 'hairline dividers',
  border: 'control borders',
  borderStrong: 'strong borders',
  strong: 'idle glyphs and scrollbars',
  faint: 'tertiary text and placeholders (3:1 on bg, panel and raised)',
  muted: 'secondary text (4.5:1)',
  text: 'primary text (4.5:1)',
  accent: 'links, focus, selection and the primary accent (4.5:1)',
  onAccent: 'text on a solid accent fill',
  success: 'success text and icons',
  warning: 'warning text and icons',
  danger: 'error and danger text',
  info: 'informational text',
  comment: 'code comments',
  punctuation: 'code punctuation and plain identifiers',
  constant: 'numbers and constants',
  keyword: 'keywords',
  parameter: 'parameters and variables',
  function: 'functions and methods',
  string: 'strings',
} as const satisfies Readonly<Record<ColourRole | SyntaxRole, string>>

const SYNTAX_ROLE_SET: ReadonlySet<string> = new Set(SYNTAX_ROLES)

/**
 * An animated backdrop painted behind the main workbench (the conversation and its tabs; sidebars, dialogs, bubbles and
 * the composer stay opaque). Each layer is a block of CSS declarations for one full-size layer (stacked in order, the
 * first at the back); DSH adds its position, size and stacking. Keyframes name the animations the layers use.
 * Self-contained: no `url()`, `@import` or braces in a layer, so a theme never loads anything from the network.
 */
export interface Backdrop {
  /** A built-in animated scene (`SCENES` in scene-catalog.ts), painted first, at the back. */
  readonly scene?: string
  readonly layers?: readonly string[]
  readonly keyframes?: string
  /** A frosted layer over the scene and layers, under the conversation column: blur, tint and opacity. */
  readonly glass?: SceneGlass
}

/** Six values, one per identity slot (0–5). */
export type IdentityTuple = readonly [string, string, string, string, string, string]

/**
 * What the identity palette is, for the agent tool description and the docs (owner decision of 2026-11-26): the six
 * colours a user picks for a project, a Backlog tag or an agent. A choice stores the slot, so a theme recolours it.
 */
export const PALETTE_GUIDE = {
  palette:
    'six #rrggbb identity colours (slots 0–5) users pick for projects, Backlog tags and agents; each must read as text (4.5:1) on bg, panel and raised and should stay clear of the success, warning and danger hues. Left out, six are derived from the theme’s syntax and accent colours.',
  paletteNames: 'six short names for the palette slots, in the same order (the swatch names a screen reader and the picker show); needs palette.',
} as const

export interface SchemeTheme {
  readonly colours: Readonly<Record<ColourRole, string>>
  readonly syntax?: Readonly<Partial<Record<SyntaxRole, string>>>
  readonly backdrop?: Backdrop
  /** The identity palette (`PALETTE_GUIDE.palette`); derived from the theme's own colours when left out. */
  readonly palette?: IdentityTuple
  /** A name per palette slot (`PALETTE_GUIDE.paletteNames`). */
  readonly paletteNames?: IdentityTuple
}

export interface ThemeDefinition {
  /** Lowercase letters, digits and hyphens; a built-in preset or gallery id is refused. */
  readonly id: string
  readonly label: string
  readonly description?: string
  /** At least one scheme. */
  readonly dark?: SchemeTheme
  readonly light?: SchemeTheme
}

export const MAX_BACKDROP_LAYERS = 3
/** Pseudo-elements that can hold a backdrop item (scene, layers, glass). */
const MAX_BACKDROP_ITEMS = 4
const MAX_LAYER_LENGTH = 8_000
const MAX_KEYFRAMES_LENGTH = 4_000
const MAX_PALETTE_NAME_LENGTH = 24
const HEX = /^#[0-9a-f]{6}$/iu
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/u
const FORBIDDEN = /url\s*\(|@import|expression\s*\(|javascript:|<\/?style/iu

/** A JSON object from settings or a tool call, before its fields are checked. */
interface UntrustedObject {
  readonly [key: string]: Schema.Json | undefined
}
const isRecord = (value: unknown): value is UntrustedObject => typeof value === 'object' && value !== null && !Array.isArray(value)

function checkKeyframes(text: string, errors: string[], where: string): void {
  if (text.length > MAX_KEYFRAMES_LENGTH) errors.push(`${where}: keyframes longer than ${MAX_KEYFRAMES_LENGTH} characters`)
  if (FORBIDDEN.test(text)) errors.push(`${where}: keyframes must not load anything (no url(), @import)`)
  let depth = 0
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (depth === 0 && char !== undefined && !/\s/u.test(char)) {
      const head = /^@keyframes\s+[A-Za-z_][\w-]*\s*\{/u.exec(text.slice(index))
      if (head === null) {
        errors.push(`${where}: keyframes may only hold @keyframes blocks`)
        return
      }
      index += head[0].length
      depth = 1
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth < 0) break
    index += 1
  }
  if (depth !== 0) errors.push(`${where}: keyframes have unbalanced braces`)
}

/** A palette entry: a #rrggbb colour, lower-cased, or undefined. */
function parseHexEntry(entry: unknown): string | undefined {
  return typeof entry === 'string' && HEX.test(entry) ? entry.toLowerCase() : undefined
}

/** A palette slot name: 1 to `MAX_PALETTE_NAME_LENGTH` characters once trimmed, or undefined. */
function parseNameEntry(entry: unknown): string | undefined {
  const name = typeof entry === 'string' ? entry.trim() : ''
  return name === '' || name.length > MAX_PALETTE_NAME_LENGTH ? undefined : name
}

/** Six entries, or undefined when the list is not six of them (its error is recorded). */
function parseSix(
  value: unknown,
  where: string,
  errors: string[],
  parseEntry: typeof parseHexEntry,
  what: { readonly list: string; readonly entry: string },
): IdentityTuple | undefined {
  if (!Array.isArray(value) || value.length !== IDENTITY_SLOT_COUNT) {
    errors.push(`${where}: exactly ${IDENTITY_SLOT_COUNT} ${what.list}, one per slot`)
    return undefined
  }
  const entries: string[] = []
  value.forEach((entry, index) => {
    const parsed = parseEntry(entry)
    if (parsed === undefined) errors.push(`${where}[${index}]: ${what.entry} is required`)
    else entries.push(parsed)
  })
  const [a, b, c, d, e, f] = entries
  return a === undefined || b === undefined || c === undefined || d === undefined || e === undefined || f === undefined ? undefined : [a, b, c, d, e, f]
}

/** The identity palette and its names, checked; names need a palette (a derived one has no order to name). */
function checkPalette(value: UntrustedObject, where: string, errors: string[]): Pick<SchemeTheme, 'palette' | 'paletteNames'> {
  const palette =
    value.palette === undefined
      ? undefined
      : parseSix(value.palette, `${where}.palette`, errors, parseHexEntry, { list: '#rrggbb colours', entry: 'a #rrggbb colour' })
  const paletteNames =
    value.paletteNames === undefined
      ? undefined
      : parseSix(value.paletteNames, `${where}.paletteNames`, errors, parseNameEntry, {
          list: 'names',
          entry: `a name of 1 to ${MAX_PALETTE_NAME_LENGTH} characters`,
        })
  if (value.paletteNames !== undefined && value.palette === undefined) errors.push(`${where}.paletteNames: give palette too (names follow its order)`)
  let out: Pick<SchemeTheme, 'palette' | 'paletteNames'> = {}
  if (palette !== undefined) out = { ...out, palette }
  if (paletteNames !== undefined) out = { ...out, paletteNames }
  return out
}

function checkScheme(value: unknown, where: string, errors: string[]): SchemeTheme | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || !isRecord(value.colours)) {
    errors.push(`${where}: needs a colours object`)
    return undefined
  }
  const colours = new Map<ColourRole, string>()
  for (const role of [...NEUTRAL_ROLES, ...ACCENT_ROLES]) {
    const hex = value.colours[role]
    if (typeof hex === 'string' && HEX.test(hex)) colours.set(role, hex.toLowerCase())
    else errors.push(`${where}.colours.${role}: a #rrggbb colour is required (${ROLE_GUIDE[role]})`)
  }
  const syntax: Record<string, string> = {}
  if (value.syntax !== undefined) {
    if (!isRecord(value.syntax)) errors.push(`${where}.syntax: must be an object`)
    else
      for (const [role, hex] of Object.entries(value.syntax)) {
        if (!SYNTAX_ROLE_SET.has(role)) errors.push(`${where}.syntax.${role}: unknown role (${SYNTAX_ROLES.join(', ')})`)
        else if (typeof hex !== 'string' || !HEX.test(hex)) errors.push(`${where}.syntax.${role}: a #rrggbb colour is required`)
        else syntax[role] = hex.toLowerCase()
      }
  }
  let backdrop: Backdrop | undefined
  if (value.backdrop !== undefined) {
    const raw = value.backdrop
    const rawLayers: readonly unknown[] = isRecord(raw) && Array.isArray(raw.layers) ? raw.layers : []
    const scene = isRecord(raw) && typeof raw.scene === 'string' ? raw.scene : undefined
    const glass = isRecord(raw) ? checkGlass(raw.glass, `${where}.backdrop.glass`, errors) : undefined
    const items = rawLayers.length + (scene === undefined ? 0 : 1) + (glass === undefined ? 0 : 1)
    if (!isRecord(raw) || (isRecord(raw) && raw.layers !== undefined && !Array.isArray(raw.layers)))
      errors.push(`${where}.backdrop: must be an object with a scene, layers or both`)
    else if (raw.scene !== undefined && (scene === undefined || !SCENE_IDS.includes(scene)))
      errors.push(`${where}.backdrop.scene: one of ${SCENE_IDS.join(', ')}`)
    else if (scene === undefined && rawLayers.length === 0) errors.push(`${where}.backdrop: needs a scene or 1 to ${MAX_BACKDROP_LAYERS} layers`)
    else if (rawLayers.length > MAX_BACKDROP_LAYERS || items > MAX_BACKDROP_ITEMS)
      errors.push(`${where}.backdrop: at most ${MAX_BACKDROP_LAYERS} layers, and ${MAX_BACKDROP_ITEMS} items with the scene and the glass`)
    else {
      const layers: string[] = []
      rawLayers.forEach((layer, index) => {
        if (typeof layer !== 'string' || layer.trim() === '') errors.push(`${where}.backdrop.layers[${index}]: CSS declarations are required`)
        else if (layer.length > MAX_LAYER_LENGTH) errors.push(`${where}.backdrop.layers[${index}]: longer than ${MAX_LAYER_LENGTH} characters`)
        else if (/[{}]/u.test(layer) || FORBIDDEN.test(layer))
          errors.push(`${where}.backdrop.layers[${index}]: declarations only, without braces, url() or @import`)
        else layers.push(layer.trim())
      })
      if (raw.keyframes !== undefined && typeof raw.keyframes !== 'string') errors.push(`${where}.backdrop.keyframes: must be a string`)
      else if (typeof raw.keyframes === 'string') checkKeyframes(raw.keyframes, errors, `${where}.backdrop`)
      let parsed: Backdrop = {}
      if (scene !== undefined) parsed = { ...parsed, scene }
      if (layers.length > 0) parsed = { ...parsed, layers }
      if (typeof raw.keyframes === 'string' && raw.keyframes.trim() !== '') parsed = { ...parsed, keyframes: raw.keyframes.trim() }
      if (glass !== undefined) parsed = { ...parsed, glass }
      backdrop = parsed
    }
  }
  const identity = checkPalette(value, where, errors)
  const full = completeColours(colours)
  if (full === undefined) return undefined
  let scheme: SchemeTheme = { colours: full }
  if (Object.keys(syntax).length > 0) scheme = { ...scheme, syntax }
  if (backdrop !== undefined) scheme = { ...scheme, backdrop }
  if (identity.palette !== undefined) scheme = { ...scheme, palette: identity.palette }
  if (identity.paletteNames !== undefined) scheme = { ...scheme, paletteNames: identity.paletteNames }
  return scheme
}

function checkGlass(value: unknown, where: string, errors: string[]): SceneGlass | undefined {
  if (value === undefined) return undefined
  const inRange = (raw: unknown, min: number, max: number): raw is number => typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max
  if (!isRecord(value) || !inRange(value.opacity, 0, 1) || typeof value.tint !== 'string' || !HEX.test(value.tint)) {
    errors.push(`${where}: a #rrggbb tint and opacity 0–1`)
    return undefined
  }
  return { tint: value.tint.toLowerCase(), opacity: value.opacity }
}

/** Every colour role, or undefined when one is missing (its error is already recorded). */
function completeColours(colours: ReadonlyMap<ColourRole, string>): SchemeTheme['colours'] | undefined {
  const get = (role: ColourRole): string => colours.get(role) ?? ''
  if ([...NEUTRAL_ROLES, ...ACCENT_ROLES].some(role => get(role) === '')) return undefined
  return {
    bg: get('bg'),
    panel: get('panel'),
    raised: get('raised'),
    selected: get('selected'),
    line: get('line'),
    border: get('border'),
    borderStrong: get('borderStrong'),
    strong: get('strong'),
    faint: get('faint'),
    muted: get('muted'),
    text: get('text'),
    accent: get('accent'),
    onAccent: get('onAccent'),
    success: get('success'),
    warning: get('warning'),
    danger: get('danger'),
    info: get('info'),
  }
}

/** The result of parsing untrusted theme data. */
export interface ParsedDefinition {
  readonly definition?: ThemeDefinition
  readonly errors: readonly string[]
}

/** A definition parsed from untrusted data (settings, an agent tool): the definition, or every problem found. */
function parseDefinition(value: unknown, reservedIds: readonly string[] = []): ParsedDefinition {
  const errors: string[] = []
  if (!isRecord(value)) return { errors: ['a theme must be an object'] }
  const id = typeof value.id === 'string' ? value.id : ''
  if (!ID.test(id)) errors.push('id: lowercase letters, digits and hyphens, at most 48 characters')
  else if (reservedIds.includes(id)) errors.push(`id: "${id}" is a built-in theme; pick another id`)
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  if (label === '' || label.length > 60) errors.push('label: 1 to 60 characters')
  if (value.description !== undefined && typeof value.description !== 'string') errors.push('description: must be a string')
  const dark = checkScheme(value.dark, 'dark', errors)
  const light = checkScheme(value.light, 'light', errors)
  if (value.dark === undefined && value.light === undefined) errors.push('give at least one scheme: dark, light or both')
  if (errors.length > 0) return { errors }
  const description = typeof value.description === 'string' ? value.description.trim().slice(0, 200) : ''
  let definition: ThemeDefinition = { id, label }
  if (description !== '') definition = { ...definition, description }
  if (dark !== undefined) definition = { ...definition, dark }
  if (light !== undefined) definition = { ...definition, light }
  return { errors, definition }
}

/**
 * The text pairs below WCAG AA in a definition, as plain sentences; empty when every pair passes. A theme with
 * warnings still applies (an official palette may sit just under AA); the agent shows them so the user can decide.
 */
function contrastWarnings(definition: ThemeDefinition): string[] {
  const warnings: string[] = []
  for (const scheme of ['dark', 'light'] as const) {
    const theme = definition[scheme]
    if (theme === undefined) continue
    const c = theme.colours
    const ratio = (a: string, b: string) => PaletteMath.contrastRatio(PaletteMath.hexToOklch(a), PaletteMath.hexToOklch(b))
    const check = (role: string, colour: string, min: number) => {
      for (const surface of ['bg', 'panel', 'raised'] as const) {
        const value = ratio(colour, c[surface])
        if (value < min) warnings.push(`${scheme}: ${role} on ${surface} is ${value.toFixed(2)}:1 (needs ${min}:1)`)
      }
    }
    check('text', c.text, 4.5)
    check('muted', c.muted, 4.5)
    check('faint', c.faint, 3)
    for (const role of ['accent', 'success', 'warning', 'danger', 'info'] as const) check(role, c[role], 4.5)
    const onAccent = ratio(c.onAccent, c.accent)
    if (onAccent < 4.5) warnings.push(`${scheme}: onAccent on accent is ${onAccent.toFixed(2)}:1 (needs 4.5:1)`)
    theme.palette?.forEach((colour, slot) => check(`palette[${slot}]`, colour, 4.5))
    for (const [role, colour] of Object.entries(theme.syntax ?? {})) {
      if (role === 'comment') continue
      const value = ratio(colour, c.panel)
      if (value < 4.5) warnings.push(`${scheme}: syntax ${role} on panel is ${value.toFixed(2)}:1 (needs 4.5:1)`)
    }
  }
  return warnings
}

/** The generator input a definition starts from: the hue and tint of its background, the hue of its accent. */
function baseInput(definition: ThemeDefinition): Omit<PaletteInput, 'scheme'> {
  const theme = definition.dark ?? definition.light
  // parseDefinition guarantees at least one scheme; a hand-built definition without one gets the default hues.
  if (theme === undefined) return { hue: 65, chroma: 0.007, accentHue: 270, contrast: 1 }
  const bg = PaletteMath.hexToOklch(theme.colours.bg)
  const accent = PaletteMath.hexToOklch(theme.colours.accent)
  const round = (value: number, digits: number) => Number(value.toFixed(digits))
  return { hue: round(bg.h, 1), chroma: round(Math.min(0.03, bg.c), 4), accentHue: round(accent.h, 1), contrast: 1 }
}

const rgba = (hex: string, alpha: number): string => {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255} / ${alpha})`
}

function pins(theme: SchemeTheme): string[] {
  const out: string[] = []
  const push = (name: string, value: string) => out.push(`  ${name}: ${value};`)
  NEUTRAL_ROLES.forEach((role, step) => push(`--dshx-tone-${step}`, theme.colours[role]))
  // The nav column is the theme's own panel colour (council round 6 A4 lifts only the generated dark palette).
  push('--dshx-tone-nav', theme.colours.panel)
  // Its Ready dot is its own success colour (council round 6 A6 lightens only the generated light palette's).
  push('--dshx-ready-mark', theme.colours.success)
  push('--dshx-tone-accent', theme.colours.accent)
  push('--dshx-tone-accent-bg', rgba(theme.colours.accent, 0.14))
  push('--dshx-tone-accent-border', rgba(theme.colours.accent, 0.35))
  push('--dshx-tone-accent-on-solid', theme.colours.onAccent)
  for (const role of ['success', 'warning', 'danger', 'info'] as const) {
    push(`--dshx-tone-${role}`, theme.colours[role])
    push(`--dshx-tone-${role}-bg`, rgba(theme.colours[role], 0.12))
    push(`--dshx-tone-${role}-border`, rgba(theme.colours[role], 0.3))
  }
  for (const [role, colour] of Object.entries(theme.syntax ?? {})) {
    push(`--shiki-token-${role}`, colour)
    if (role === 'string') push('--shiki-token-string-expression', colour)
  }
  return out
}

/**
 * The identity slots a scheme writes over styles.css (round eight): `--dshx-project-balanced-<n>` is slot n, and
 * `--dshx-project-cool-<n>` the same six in the cool order, so every `project-tone-*` class, `ProjectMark` and swatch
 * follows the theme.
 */
function identityPins(palette: IdentityTuple): string[] {
  const balanced = palette.map((colour, slot) => `  --dshx-project-balanced-${slot}: ${colour};`)
  const cool = COOL_ORDER.map((slot, n) => `  --dshx-project-cool-${n}: ${palette[slot]};`)
  return [...balanced, ...cool]
}

/** The main workbench: the conversation and its tabs, never the sidebars, dialogs or the composer. */
export const BACKDROP_HOST = '[data-workbench-region="main"] .dshfiles-workbench-theme'

/** A built-in scene as the client has it: the SVG, and a coarse pixel sample of its resting picture once taken. */
export interface SceneSource {
  readonly svg: string
  /** Pixels of the resting picture under the conversation column; absent until the client has sampled it. */
  readonly sample?: readonly Rgb[]
  /** Pixels of the whole resting picture, where chrome outside the column (the turn rail) sits. */
  readonly surround?: readonly Rgb[]
}

/** The sample grid the client draws a scene into, and the columns under the conversation (its middle 60%). */
export const SCENE_SAMPLE = { width: 64, height: 40, columnStart: 13, columnEnd: 51 } as const

/** The column part of a whole-picture sample laid out as `SCENE_SAMPLE` rows. */
export function columnOfSample(pixels: readonly Rgb[]): Rgb[] {
  return pixels.filter((_, index) => {
    const x = index % SCENE_SAMPLE.width
    return x >= SCENE_SAMPLE.columnStart && x < SCENE_SAMPLE.columnEnd
  })
}

/**
 * Attribute the client sets on `<html>` when the browser composites on a GPU. With it the reading veil blurs the moving
 * scene live (`backdrop-filter`); without it (a software rasteriser, where that filter re-blurs every frame on the CPU)
 * the veil shows a pre-blurred still of the scene instead.
 */
export const GPU_ATTRIBUTE = 'data-dshx-gpu'

/**
 * The attribute of the element the client mounts as the first child of `BACKDROP_HOST` to paint a built-in scene; its
 * value is the scene id. The scene is drawn on a canvas in that element by a worker (ui-styles `scene-stage.ts`), never
 * as an animated SVG: Chrome re-styles, re-paints and re-rasterises a whole animated SVG at the display's refresh rate
 * (2.6 CPU cores for Snow Pines on a 120 Hz screen). Hidden unless the active scheme's backdrop paints that scene
 * (`backdropCss`).
 */
export const SCENE_STAGE_ATTRIBUTE = 'data-dshx-scene'

/**
 * Attribute the client sets on `<body>` while the backdrop holds still in this tab: the tab is not focused or not
 * shown, or `sceneFrameRate` is 0. The scene's clock stops, and this pauses a theme's animated layers, so a tab the
 * user is not in paints nothing and the cost of a moving backdrop does not grow with the number of open tabs.
 */
export const BACKDROP_PAUSED_ATTRIBUTE = 'data-dshx-backdrop-paused'

/** Scene sources by id; a scene not loaded yet is left out until it arrives. */
export type SceneSources = ReadonlyMap<string, SceneSource>

/** The user's reading veil: blur of the scene still under the column (px) and the extra tint (percent, 0–100). */
export interface ReadingVeil {
  readonly blur: number
  readonly tint: number
}

export const READING_BOUNDS = { blur: { min: 0, max: 24 }, tint: { min: 0, max: 100 } } as const

/** Used while a scene has no pixel sample (the client could not decode it): a veil that reads over most scenes. */
const UNSAMPLED_VEIL = 0.7

/**
 * How far a theme lifts its greys over its scene: tertiary halfway to secondary, secondary 30% toward primary. A
 * textured scene reads as less contrast than a flat background with the same ratio, so the greys get a little brighter
 * while the veil does the rest. Each theme lifts its own palette, and only inside conversations over its scene: plain
 * themes and every other surface keep their greys.
 */
const GREY_LIFT = { faint: 0.5, muted: 0.3 } as const

const mixHex = (from: string, to: string, amount: number): string => {
  const [a, b] = [ReadabilityModel.hexToRgb(from), ReadabilityModel.hexToRgb(to)]
  const channel = (index: 0 | 1 | 2) => Math.round(a[index] + (b[index] - a[index]) * amount)
  return `#${[channel(0), channel(1), channel(2)].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

/** The greys a theme's text uses over its scene, lifted from its own palette (`GREY_LIFT`). */
export interface BackdropGreys {
  /** Tertiary text and icons ("Worked for 14s", copy and more-actions glyphs). */
  readonly faint: string
  /** Secondary text ("5 other tool calls"). */
  readonly muted: string
}

function backdropGreys(colours: SchemeTheme['colours']): BackdropGreys {
  return { faint: mixHex(colours.faint, colours.muted, GREY_LIFT.faint), muted: mixHex(colours.muted, colours.text, GREY_LIFT.muted) }
}

/**
 * What must read over a backdrop: primary text at 4.5:1, and the lifted secondary and tertiary greys at least as well
 * as the theme's own greys read on its plain background, so a grey over a scene is never fainter than the same grey
 * without one. Chrome outside the column also keeps its strong borders (the turn rail's ticks) at 3:1.
 * `ReadabilityModel.minimumVeil` never asks more of a colour than the theme's own background gives it.
 */
function readabilityTargets(colours: SchemeTheme['colours'], chrome = false): VeilInput['texts'] {
  const rgb = ReadabilityModel.hexToRgb
  const plain = (hex: string) => ReadabilityModel.contrast(rgb(hex), rgb(colours.bg))
  const greys = backdropGreys(colours)
  const text = [
    { colour: rgb(colours.text), min: 4.5 },
    { colour: rgb(greys.muted), min: plain(colours.muted) },
    { colour: rgb(greys.faint), min: plain(colours.faint) },
  ]
  return chrome ? [...text, { colour: rgb(colours.borderStrong), min: 3 }] : text
}

const declarationLines = (text: string): string[] =>
  text
    .split(';')
    .map(part => part.trim())
    .filter(part => part !== '')
    .map(part => `  ${part};`)

/**
 * The glass: the scene's tint at its opacity, strongest under the conversation column and fading out toward the sides,
 * so the scene stays crisp at the edges as in Claude Code. A gradient, not a mask or a filter: nothing per frame.
 */
function glassDeclarations(glass: SceneGlass): string[] {
  const tint = rgba(glass.tint, glass.opacity)
  const [from, to] = GLASS_PLATEAU
  return [`  background-image: linear-gradient(90deg, transparent 0%, ${tint} ${from * 100}%, ${tint} ${to * 100}%, transparent 100%);`]
}

/** Where the glass reaches full strength across the width (it ramps in from each edge). */
const GLASS_PLATEAU = [0.22, 0.78] as const

/** The glass's strength at a horizontal position (0–1 across the viewport), as `glassDeclarations` paints it. */
function glassWeight(position: number): number {
  const [from, to] = GLASS_PLATEAU
  if (position < from) return position / from
  if (position > to) return (1 - position) / (1 - to)
  return 1
}

/**
 * The veil a theme lays under its text on a backdrop: at least the opacity its readability floor needs over that scene
 * (`ReadabilityModel.minimumVeil`), raised by the user's tint. 0 when the backdrop has no scene and no tint is asked.
 */
function veilOpacity(theme: SchemeTheme, source: SceneSource | undefined, reading: ReadingVeil): number {
  const user = Math.min(1, Math.max(0, reading.tint / 100))
  if (source === undefined) return user
  const colours = theme.colours
  const glass = theme.backdrop?.glass
  if (source.sample === undefined && source.surround === undefined) return Math.max(UNSAMPLED_VEIL, user)
  const veil = ReadabilityModel.hexToRgb(colours.bg)
  const texts = readabilityTargets(colours)
  // A column can sit anywhere over the picture (a split pane, a wide sidebar), so the veil reads over the whole of it,
  // each pixel under the glass as strong as the glass is there.
  if (source.surround !== undefined) {
    const tint = glass === undefined ? undefined : ReadabilityModel.hexToRgb(glass.tint)
    const sample = source.surround.map((pixel, index) => {
      const weight = glassWeight(((index % SCENE_SAMPLE.width) + 0.5) / SCENE_SAMPLE.width)
      return tint === undefined || glass === undefined ? pixel : ReadabilityModel.composite(pixel, tint, glass.opacity * weight)
    })
    return Math.max(ReadabilityModel.minimumVeil({ sample, veil, texts }), user)
  }
  let input: VeilInput = { sample: source.sample ?? [], veil, texts }
  if (glass !== undefined) input = { ...input, glass: { colour: ReadabilityModel.hexToRgb(glass.tint), opacity: glass.opacity } }
  return Math.max(ReadabilityModel.minimumVeil(input), user)
}

/**
 * The surface chrome outside the column lays under itself (the turn rail): the theme background at the opacity that
 * keeps the same targets readable over the whole picture, where the glass has faded out. The user's tint raises it too.
 */
function chromeOpacity(theme: SchemeTheme, source: SceneSource | undefined, reading: ReadingVeil): number {
  const user = Math.min(1, Math.max(0, reading.tint / 100))
  if (source === undefined) return user
  const pixels = source.surround ?? source.sample
  if (pixels === undefined) return Math.max(UNSAMPLED_VEIL, user)
  const need = ReadabilityModel.minimumVeil({
    sample: pixels,
    veil: ReadabilityModel.hexToRgb(theme.colours.bg),
    texts: readabilityTargets(theme.colours, true),
  })
  return Math.max(need, user)
}

/** The veil a scheme lays under its column over a scene, as the CSS that paints it would: for tests and the agent. */
export interface VeilMaterial {
  /** Opacity of the theme background over the scene (and its glass) under the column. */
  readonly opacity: number
  /** Opacity of the theme background under chrome outside the column. */
  readonly chrome: number
  /** The greys the conversation's text uses over the scene. */
  readonly greys: BackdropGreys
}

function veilMaterial(theme: SchemeTheme, source: SceneSource | undefined, reading: ReadingVeil = { blur: 0, tint: 0 }): VeilMaterial {
  return { opacity: veilOpacity(theme, source, reading), chrome: chromeOpacity(theme, source, reading), greys: backdropGreys(theme.colours) }
}

/** The band the reading veil covers: the column's own width (the shared `--dsh-chat-content-width`) plus a margin. */
const VEIL_BAND = 'min(100%, calc(var(--dsh-chat-content-width, 760px) + 96px))'
/** The veil's sides fade over 32px, so the scene keeps its edges. */
const VEIL_FADE = 'linear-gradient(90deg, transparent 0, #000 32px, #000 calc(100% - 32px), transparent 100%)'
/** The same band and fade drawn on a full-width box (the composer seat), centred like the veil. */
const SEAT_BAND = `linear-gradient(90deg, transparent calc(50% - ${VEIL_BAND} / 2), #000 calc(50% - ${VEIL_BAND} / 2 + 32px), #000 calc(50% + ${VEIL_BAND} / 2 - 32px), transparent calc(50% + ${VEIL_BAND} / 2))`
/** The user bubble's outline over a backdrop: a hairline in the strong border step, inside its box. */
export const BUBBLE_RING = 'inset 0 0 0 1px var(--dshx-tone-6)'
/** The turn rail pill's outline over a backdrop: a hairline in the theme's line step, half strength. */
export const RAIL_RING = 'inset 0 0 0 1px color-mix(in srgb, var(--dshx-tone-4) 50%, transparent)'
/** The composer seat fades the transcript out over its top 36px (ConversationRoot's input mask). */
const SEAT_FADE = 'linear-gradient(180deg, transparent 0, #000 36px)'

/** A tint over a still of the scene, the still fixed to the viewport like the scene so the two line up. */
const stillLayers = (tint: string | undefined, still: string): string[] => [
  `  background-image: ${tint === undefined ? '' : `linear-gradient(${tint}, ${tint}), `}${still};`,
  `  background-attachment: ${tint === undefined ? '' : 'scroll, '}fixed;`,
  `  background-size: ${tint === undefined ? '' : 'auto, '}cover;`,
  '  background-position: center;',
  '  background-repeat: no-repeat;',
]

/**
 * The reading veil: a band the column's width and the conversation's full height, in the non-scrolling conversation
 * body, made a stacking context so the band stays under every message and the composer and over the backdrop. It
 * paints the theme background at the veil opacity over the scene, blurred two ways:
 *
 * - without a GPU, over a pre-blurred still of the scene fixed to the viewport like the scene, so the two line up.
 *   Static: no filter runs per frame (a live `backdrop-filter` re-blurred the moving scene every frame on the CPU, 8
 *   fps), and the motion under the text stops while the sides keep moving.
 * - with a GPU (`GPU_ATTRIBUTE`), over the moving scene itself through `backdrop-filter`, which the GPU composites.
 *
 * The composer seat at the bottom paints the same tint over the same still, fixed the same way, so the transcript fades
 * out under the composer into the veil instead of into a band of plain background; its mask cuts it to the veil's band.
 */
function readingVeilCss(host: string, gpuHost: string, source: SceneSource | undefined, opacity: number, blur: number, bg: string): string {
  const body = (scope: string) => `${scope} [data-conversation-content]`
  const tint = opacity > 0 ? rgba(bg, opacity) : undefined
  const blurred = source !== undefined && blur > 0 ? SceneCatalog.image(SceneCatalog.blurred(source.svg, blur)) : undefined
  const background = blurred === undefined ? [`  background-color: ${tint ?? 'transparent'};`] : stillLayers(tint, blurred)
  const blocks: string[] = []
  // A scene the theme's text already reads on, with no blur asked, needs no band: only the seat continues the scene.
  if (tint !== undefined || blurred !== undefined)
    blocks.push(
      `${body(host)} {`,
      '  isolation: isolate;',
      '}',
      `${body(host)}::before {`,
      "  content: '';",
      '  position: absolute;',
      '  top: 0;',
      '  bottom: 0;',
      '  left: 0;',
      '  right: 0;',
      '  margin-inline: auto;',
      `  width: ${VEIL_BAND};`,
      '  z-index: -1;',
      '  pointer-events: none;',
      ...background,
      `  mask-image: ${VEIL_FADE};`,
      `  -webkit-mask-image: ${VEIL_FADE};`,
      '}',
    )
  if (blurred !== undefined)
    blocks.push(
      `${body(gpuHost)}::before {`,
      '  background-image: none;',
      `  background-color: ${tint ?? 'transparent'};`,
      `  backdrop-filter: blur(${blur}px);`,
      `  -webkit-backdrop-filter: blur(${blur}px);`,
      '}',
    )
  if (source !== undefined) {
    // Without a blur the veil shows the moving scene; the seat takes the scene's resting picture, which only shows there.
    const still = blurred ?? SceneCatalog.image(SceneCatalog.resting(source.svg))
    const seat = `${body(host)}[data-content-phase='active'] [data-composer-seat]`
    blocks.push(
      `${seat} {`,
      // A transform hint would make the seat a containing block that turns its fixed background into a scrolling one.
      '  will-change: auto;',
      '  background: none;',
      '}',
      // On a pseudo-element under the seat's content: a mask on the seat itself would fade the composer card too. The
      // sticky seat (z-index 9) is a stacking context, so this stays over the transcript and under the card.
      `${seat}::before {`,
      "  content: '';",
      '  position: absolute;',
      '  inset: 0;',
      '  z-index: -1;',
      '  pointer-events: none;',
      ...stillLayers(tint, still),
      `  mask-image: ${SEAT_FADE}, ${SEAT_BAND};`,
      `  -webkit-mask-image: ${SEAT_FADE}, ${SEAT_BAND};`,
      '  mask-composite: intersect;',
      '  -webkit-mask-composite: source-in;',
      '}',
    )
  }
  return blocks.join('\n')
}

function backdropCss(scope: string, theme: SchemeTheme, backdrop: Backdrop, scenes: SceneSources, reading: ReadingVeil): string {
  const host = `${scope} ${BACKDROP_HOST}`
  const gpuHost = `${scope}[${GPU_ATTRIBUTE}] ${BACKDROP_HOST}`
  // Four pseudo-elements host the items, back to front: two on the dockview between two on the shell, all under content.
  const slotsOf = (on: string) => [`${on}::before`, `${on} .dv-dockview::before`, `${on} .dv-dockview::after`, `${on}::after`]
  const slots = slotsOf(host)
  const source = backdrop.scene === undefined ? undefined : scenes.get(backdrop.scene)
  const items: string[][] = []
  for (const layer of backdrop.layers ?? []) items.push(declarationLines(layer))
  if (backdrop.glass !== undefined) items.push(glassDeclarations(backdrop.glass))
  const material = veilMaterial(theme, source, reading)
  const blocks = [
    // The shell becomes the backdrop's stacking context; its dockview surfaces turn transparent so the layers show.
    `${host} {`,
    '  isolation: isolate;',
    '  --dv-group-view-background-color: transparent;',
    '  --dv-tabs-and-actions-container-background-color: transparent;',
    '  --dv-activegroup-visiblepanel-tab-background-color: transparent;',
    '  --dv-inactivegroup-visiblepanel-tab-background-color: transparent;',
    // Chrome that sits on the scene outside the column (the turn rail) lays this under itself.
    `  --dshx-backdrop-chrome: ${rgba(theme.colours.bg, material.chrome)};`,
    // The raised bubble fill can match the veiled scene behind it: a strong hairline keeps the user's message apart.
    `  --dshx-backdrop-bubble-ring: ${BUBBLE_RING};`,
    // The turn rail: previous, its ticks and next on a slim, centred pill of that surface with a soft hairline, the
    // arrows always shown; the filter on its own round chip above it.
    '  --dshx-backdrop-rail-pad: 2px;',
    // The pill is the track here: chat's resting 8% ink fill under the ticks steps aside (council round 34 B2).
    '  --dshx-backdrop-rail-fill: transparent;',
    '  --dshx-backdrop-rail-gap: 4px;',
    '  --dshx-backdrop-rail-inset: 4px;',
    '  --dshx-backdrop-rail-align: center;',
    '  --dshx-backdrop-rail-origin: center;',
    '  --dshx-backdrop-rail-steps: 1;',
    '  --dshx-backdrop-rail-band-radius: 999px;',
    '  --dshx-backdrop-rail-chip-radius: 999px;',
    `  --dshx-backdrop-rail-ring: ${RAIL_RING};`,
    '}',
    // Docked panes are drawn in Dockview's render overlays, which hold a transform and paint containment for
    // compositing. Either makes the overlay the frame of every fixed background inside it, so each pane fitted its own
    // copy of the scene still to itself: a scene repeated per split, out of register with the one behind. The backdrop
    // is one picture fixed to the viewport, so the docked overlays give both up (floating windows keep theirs).
    `${host} .dv-render-overlay:not(.dv-render-overlay-float) {`,
    '  transform: none;',
    '  will-change: auto;',
    '  contain: none;',
    '  backface-visibility: visible;',
    '}',
    // Only conversations show the scene: every other pane (Settings, Backlog, ...) keeps the theme's own surface.
    `${host} [data-workbench-panel-id]:not(:has([data-conversation-content])) {`,
    '  background-color: var(--dshx-tone-0);',
    '}',
  ]
  // Over a scene the conversation's greys lift a little (`backdropGreys`); the veil is computed for these colours. The
  // aliases are redeclared here because the body resolved them from the unlifted steps.
  if (source !== undefined)
    blocks.push(
      `${host} [data-conversation-content] {`,
      `  --dshx-tone-8: ${material.greys.faint};`,
      `  --dshx-tone-9: ${material.greys.muted};`,
      `  --dshx-tone-faint: ${material.greys.faint};`,
      `  --dshx-tone-muted: ${material.greys.muted};`,
      `  --dsw-alias-label-tertiary: ${material.greys.faint};`,
      `  --dsw-alias-label-caption: ${material.greys.faint};`,
      `  --dsw-alias-label-secondary: ${material.greys.muted};`,
      `  --dsw-alias-label-document-preview: ${material.greys.muted};`,
      '}',
    )
  // The scene's stage, under every layer: the client keeps its picture aligned with the viewport, like the blurred still
  // in the reading veil, and steps its animations (`SCENE_STAGE_ATTRIBUTE`).
  if (source !== undefined && backdrop.scene !== undefined)
    blocks.push(
      [
        `${host} > [${SCENE_STAGE_ATTRIBUTE}="${backdrop.scene}"] {`,
        '  display: block;',
        '  position: absolute;',
        '  inset: 0;',
        `  z-index: ${-MAX_BACKDROP_ITEMS - 1};`,
        '  overflow: hidden;',
        '  pointer-events: none;',
        '  contain: strict;',
        '}',
      ].join('\n'),
    )
  items.forEach((declarations, index) => {
    blocks.push(
      [
        `${slots[index]} {`,
        "  content: '';",
        '  position: absolute;',
        '  inset: 0;',
        `  z-index: ${index - MAX_BACKDROP_ITEMS};`,
        '  pointer-events: none;',
        ...declarations,
        '}',
      ].join('\n'),
    )
  })
  if (backdrop.keyframes !== undefined) blocks.push(backdrop.keyframes)
  const blur = Math.min(READING_BOUNDS.blur.max, Math.max(0, reading.blur))
  if (material.opacity > 0 || source !== undefined) blocks.push(readingVeilCss(host, gpuHost, source, material.opacity, blur, theme.colours.bg))
  // The inline scene sees the query itself and rests by its own rules; the layers stop here. In a tab the user is not
  // in they hold still, with the scene.
  const used = slots.slice(0, items.length).join(', ')
  if (used !== '') {
    const held = slotsOf(`${scope}[${BACKDROP_PAUSED_ATTRIBUTE}] ${BACKDROP_HOST}`).slice(0, items.length).join(', ')
    blocks.push(`${held} {`, '  animation-play-state: paused !important;', '}')
    blocks.push('@media (prefers-reduced-motion: reduce) {', `  ${used} { animation: none !important; }`, '}')
  }
  return blocks.join('\n')
}

/**
 * The CSS a definition adds after the generated blocks: per scheme, the pins under the runtime selector and the backdrop.
 * The light backdrop is guarded so it never shows in dark.
 */
function definitionCss(
  definition: ThemeDefinition,
  selectors: { readonly light: string; readonly dark: string },
  scenes: SceneSources = new Map(),
  reading: ReadingVeil = { blur: 0, tint: 0 },
): string {
  const parts: string[] = []
  for (const scheme of ['light', 'dark'] as const satisfies readonly Scheme[]) {
    const theme = definition[scheme]
    if (theme === undefined) continue
    const selector = selectors[scheme]
    parts.push([`${selector} {`, ...pins(theme), '}'].join('\n'))
    // The light block is guarded: these slots have no generated dark value to out-rank a light one in dark.
    parts.push(
      [`${scheme === 'light' ? `${selector}:not([data-ds-dark-theme])` : selector} {`, ...identityPins(IdentityDerivation.paletteOf(theme, scheme)), '}'].join(
        '\n',
      ),
    )
    if (theme.backdrop !== undefined)
      parts.push(backdropCss(scheme === 'light' ? `${selector}:not([data-ds-dark-theme])` : selector, theme, theme.backdrop, scenes, reading))
  }
  return parts.join('\n\n')
}

/** The built-in scenes a definition paints, in either scheme. */
function scenesOf(definition: ThemeDefinition): string[] {
  const ids = [definition.dark?.backdrop?.scene, definition.light?.backdrop?.scene].filter(id => id !== undefined)
  return [...new Set(ids)]
}

/** Theme definitions: parsing, contrast report, generator input and CSS. */
export class ThemeDefinitionModel {
  static readonly parse = parseDefinition
  static readonly contrastWarnings = contrastWarnings
  static readonly baseInput = baseInput
  static readonly css = definitionCss
  static readonly scenesOf = scenesOf
  static readonly veilMaterial = veilMaterial
  static readonly glassWeight = glassWeight
}
