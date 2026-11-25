/**
 * Ported from @deepseek-ai/dsh-client-ui-settings-general@0.2.2-rc.2 (MIT): `GeneralSection.js`,
 * `CurrentVersionRow.js`, `DeveloperToolsRow.js` and `chrome.js`.
 */
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { PaletteMath } from '@dshfiles/plugin-ui/theme/palette'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ShellTranslate } from './locales.js'
import { useObservable } from './use-observable.js'
import { DshReleaseIndicator } from '../release-notice.js'
import { SECTION_TITLE_CLASS } from '../section-title.js'

/** The control a search entry names: the row tagged with its id, focused on its first control. */
const revealSettingsEntry = (input: { readonly container: HTMLElement; readonly entryId: string }): boolean => {
  const row = input.container.querySelector<HTMLElement>(`[data-settings-entry="${CSS.escape(input.entryId)}"]`)
  if (row === null) return false
  row.scrollIntoView({ block: 'center' })
  const focusable = row.querySelector<HTMLElement>('button, input, select, textarea, [role="switch"], [tabindex]:not([tabindex="-1"])') ?? row
  focusable.focus({ preventScroll: true })
  return true
}

type SchemeColours = ReturnType<typeof PaletteMath.standaloneColours>

/** One scheme's miniature window: the page, its sidebar strip, two text lines and one indigo (Needs-you) diamond. */
const previewParts = (colours: SchemeColours): string =>
  [
    `<rect width="96" height="56" fill="${colours.bg}"/>`,
    `<rect data-part="sidebar" width="24" height="56" fill="${colours.panel}"/>`,
    `<rect x="24" width="1" height="56" fill="${colours.line}"/>`,
    `<rect data-part="line" x="34" y="15" width="46" height="4" rx="2" fill="${colours.text}"/>`,
    `<rect data-part="line" x="34" y="25" width="32" height="4" rx="2" fill="${colours.muted}"/>`,
    `<polygon data-part="diamond" points="38,35 42,39 38,43 34,39" fill="${colours.accent}"/>`,
    `<rect data-part="line" x="46" y="37" width="22" height="4" rx="2" fill="${colours.muted}"/>`,
  ].join('')

/**
 * Each Appearance card's preview (round five B7): a 96×56 miniature drawn in that theme's own palette, so the card
 * shows the theme it picks rather than an icon. System shows the light window with its trailing half in dark.
 */
const themePreview = (scheme: 'light' | 'dark' | 'system'): string => {
  const light = PaletteMath.standaloneColours('light')
  const dark = PaletteMath.standaloneColours('dark')
  const body =
    scheme === 'system'
      ? `${previewParts(light)}<g clip-path="url(#half)">${previewParts(dark)}</g>`
      : previewParts(scheme === 'light' ? light : dark)
  // One mid-grey edge on every preview, so a near-white or near-black window shows on a light and on a dark card alike.
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="56" viewBox="0 0 96 56">',
    '<defs><clipPath id="frame"><rect width="96" height="56" rx="6"/></clipPath><clipPath id="half"><rect x="48" width="48" height="56"/></clipPath></defs>',
    `<g clip-path="url(#frame)">${body}</g>`,
    `<rect x="0.5" y="0.5" width="95" height="55" rx="5.5" fill="none" stroke="${light.faint}"/>`,
    '</svg>',
  ].join('')
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const themeSwatches = (): CSSProperties & Record<`--settings-swatch-${string}`, string> => ({
  '--settings-swatch-light': themePreview('light'),
  '--settings-swatch-dark': themePreview('dark'),
  '--settings-swatch-system': themePreview('system'),
})

/** The General section column; rows come from `settings.general.item` registrants. */
export const GeneralSection = (
  props: Pick<PropsRenderSlots<'settings.general.item'>, 'renderSlot'> & {
    readonly target?: string | undefined
    /**
     * A notice after the rows (a newer DSH release); it never sits among the preferences. Round three item 30: it arrives
     * after the first paint, so above the rows it pushed them down 71px; below them it moves nothing.
     */
    readonly banner?: React.ReactNode
  },
): JSX.Element => {
  const column = useRef<HTMLDivElement>(null)
  const swatches = useMemo(() => themeSwatches(), [])
  useEffect(() => {
    if (props.target === undefined || column.current === null) return
    revealSettingsEntry({ container: column.current, entryId: props.target })
  }, [props.target])
  return (
    // Narrow pane (a phone): a native row's label and description need at least 12rem before its control, otherwise
    // the control wraps under them; without this the text squeezed to one word per line beside the selector. The
    // native rows are unlayered module CSS, so the basis must be important to beat their own `flex`.
    <div
      className={cn(
        "dshx:flex dshx:w-full dshx:flex-col dshx:[&>[data-slot='settings.general.item']>:last-child]:border-b-0",
        // Below 28rem every native row stacks, its control under its text (round five B7), like the plugin rows.
        'dshx:@max-pane-narrow:[&_[class$=row]]:flex-col! dshx:@max-pane-narrow:[&_[class$=row]]:items-start! dshx:@max-pane-narrow:[&_[class$=row]]:gap-y-2',
        'dshx:@max-pane-narrow:[&_[class$=rowText]]:min-w-0! dshx:@max-pane-narrow:[&_[class$=rowText]]:w-full!',
        // Round three item 30: the Language note reads as the Language row's own caption, under one divider.
        'dshx:[&_[class$=row]:has(+[data-settings-language-note])]:border-b-0! dshx:[&_[class$=row]:has(+[data-settings-language-note])]:pb-1!',
        // The chosen Appearance cube (core theme row, unlayered module CSS) is the kit's selected card (council round 3
        // B3, A1): the wash, a ring edge and a check badge in its top-end corner, and no inset row marker. Narrow panes get
        // shorter cubes.
        'dshx:[&_[class*=_themeCube][aria-pressed=true]]:border! dshx:[&_[class*=_themeCube][aria-pressed=true]]:selected-card!',
        'dshx:@max-pane-narrow:[&_[class*=_themeCube]]:py-2! dshx:@max-pane-narrow:[&_[class*=_themeCube]]:gap-1!',
        // The rows' selectors (core module CSS, filled and borderless) in the kit's one select look (council round 3 B3,
        // kit A4): 32px, a 1px border, the page fill, 8px corners.
        'dshx:[&_[class*=_selector_]]:select-look! dshx:[&_[class*=_selector_]:hover]:bg-(--dsw-alias-interactive-bg-hover)!',
        // A touch screen keeps 44px controls: the selectors, and the stepper whose up and down buttons are 44px there.
        'dshx:pointer-coarse:[&_[class*=_selector_]]:h-11! dshx:pointer-coarse:[&_[class*=_stepper_]]:h-11! dshx:pointer-coarse:[&_[class*=_stepper_]+[class*=_unit_]]:h-11!',
        // Font size: the core stepper and its "px" read as one field with the unit as an inner suffix, the kit's UnitInput
        // look (council round 3 B3, kit A4), instead of a filled number pill beside a loose unit.
        'dshx:[&_[class*=_stepper_]]:h-8! dshx:[&_[class*=_stepper_]]:min-w-14! dshx:[&_[class*=_stepper_]]:justify-start! dshx:[&_[class*=_stepper_]]:rounded-r-none! dshx:[&_[class*=_stepper_]]:border! dshx:[&_[class*=_stepper_]]:border-r-0! dshx:[&_[class*=_stepper_]]:border-field-border! dshx:[&_[class*=_stepper_]]:bg-(--dsw-alias-bg-base)! dshx:[&_[class*=_stepper_]]:pl-2.5!',
        // The value and its unit at the kit UnitInput's text size (council round 4 B5), not core's 14px.
        'dshx:[&_[class*=_stepper_]_[class*=_value_]]:text-sm! dshx:[&_[class*=_stepper_]_[class*=_value_]]:leading-5! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:text-sm!',
        // No chevron trailing the field (council round 4 B5): core's More font settings disclosure read as the field's
        // menu. It stays, as a quiet text button named by its own label, after the field.
        'dshx:[&_[class*=_expander_]]:ml-1! dshx:[&_[class*=_expander_]]:h-8! dshx:[&_[class*=_expander_]]:w-auto! dshx:[&_[class*=_expander_]]:rounded-md! dshx:[&_[class*=_expander_]]:px-2! dshx:[&_[class*=_expander_]]:text-sm! dshx:[&_[class*=_expander_]]:text-muted-foreground! dshx:[&_[class*=_expander_]>svg]:hidden! dshx:[&_[class*=_expander_]]:before:content-[attr(aria-label)]',
        'dshx:[&_[class*=_stepper_]+[class*=_unit_]]:-ml-2! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:inline-flex! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:h-8! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:items-center! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:rounded-r-(--dsw-radius-md)! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:border! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:border-l-0! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:border-field-border! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:bg-(--dsw-alias-bg-base)! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:pr-2.5! dshx:[&_[class*=_stepper_]+[class*=_unit_]]:text-muted-foreground!',
        // Each card leads with its theme's 96×56 preview (`themeSwatches`, round five B7) in place of core's icon, label
        // under it; cards in core order, Light, Dark, System. Tighter padding keeps the card about as tall as before.
        "dshx:[&_[class*=_themeCube]>svg]:hidden! dshx:[&_[class*=_themeCube]]:py-3! dshx:[&_[class*=_themeCube]]:gap-2! dshx:[&_[class*=_themeCube]]:before:order-first dshx:[&_[class*=_themeCube]]:before:h-14 dshx:[&_[class*=_themeCube]]:before:w-24 dshx:[&_[class*=_themeCube]]:before:shrink-0 dshx:[&_[class*=_themeCube]]:before:content-['']",
        // Helper copy reads in lines of 60 characters at most (council round 6 B5), whichever plugin drew the row.
        'dshx:[&_[class*=_desc]]:max-w-[60ch]! dshx:[&_[class*=Description]]:max-w-[60ch]!',
        'dshx:[&_[class*=_themeCube]:nth-child(1)]:before:[background:var(--settings-swatch-light)] dshx:[&_[class*=_themeCube]:nth-child(2)]:before:[background:var(--settings-swatch-dark)] dshx:[&_[class*=_themeCube]:nth-child(3)]:before:[background:var(--settings-swatch-system)]',
      )}
      data-settings-theme-swatches=""
      ref={column}
      style={swatches}
    >
      {props.renderSlot('settings.general.item', {})}
      {props.banner}
    </div>
  )
}

/**
 * General's group headings (council round 6 B5): the transcript rows chat registers (View mode, When to collapse work
 * details, Replies after collapse, order 12) sit under one "Transcript" heading, after core's Font size (11); the rows
 * after them (Show coding view at 15 onwards) start a "Behavior" group, so the transcript group ends where its rows do.
 * "Basics" (council round 7 B2) heads core's Permission (-20), Language (0), Appearance (10) and Font size (11), so every
 * General row sits in a named group.
 */
export const GENERAL_HEADINGS = [
  { id: 'dshfiles-general-basics-heading', key: 'general.basicsHeading', order: -30, first: true },
  { id: 'dshfiles-general-transcript-heading', key: 'general.transcriptHeading', order: 11.5, first: false },
  { id: 'dshfiles-general-behavior-heading', key: 'general.behaviorHeading', order: 13, first: false },
] as const

/**
 * One General group heading: 15/20 ink, 24px above it, no divider of its own (the row above keeps its own). The `first`
 * heading opens the page and starts at its top.
 */
export const GeneralGroupHeading = (props: { readonly label: string; readonly first?: boolean }): JSX.Element => (
  <h3 className={cn(SECTION_TITLE_CLASS, props.first === true ? 'dshx:pb-1' : 'dshx:pt-6 dshx:pb-1')} data-settings-general-heading="">
    {props.label}
  </h3>
)

/** The release the native client build embeds; the port keeps the version it was taken from. */
export const CurrentVersionRow = (props: { readonly t: ShellTranslate; readonly version: string }): JSX.Element => (
  <div className="dshx:py-4 dshx:text-base dshx:leading-[22px] dshx:wrap-anywhere dshx:text-foreground" data-settings-entry="current-version" tabIndex={-1}>
    {props.t('general.currentVersion', { version: props.version })}
  </div>
)

/**
 * The shared developer-tool visibility switch. Round three item 29: it moves at once and stays usable while the Host
 * saves (`aria-busy`, never `disabled`, which dropped focus to the page and held the thumb for 660 ms); a refused write
 * moves it back over the same 120ms transition and says so. The kit switch replaces the native one, which takes no
 * `aria-busy`.
 */
export const DeveloperToolsRow = (props: {
  readonly t: ShellTranslate
  readonly enabled: ObservableSnapshot<boolean>
  readonly setEnabled: (enabled: boolean) => Promise<void>
}): JSX.Element => {
  const enabled = useObservable(props.enabled)
  /** The value the last click asked for, until its write settles; a newer click supersedes an older write. */
  const [asked, setAsked] = useState<{ readonly value: boolean; readonly sequence: number } | undefined>(undefined)
  const sequence = useRef(0)
  const [failed, setFailed] = useState(false)
  const settle = (written: number, refused: boolean): void => {
    if (written !== sequence.current) return
    setAsked(undefined)
    setFailed(refused)
  }
  return (
    <div
      className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-6 dshx:border-b-[0.5px] dshx:border-[var(--dsw-alias-border-l2)] dshx:py-4"
      data-settings-entry="developer-tools"
    >
      <div>
        <div className="dshx:text-base dshx:leading-5">{props.t('developerTools.title')}</div>
        <div className="dshx:mt-1 dshx:max-w-[60ch] dshx:text-xs dshx:leading-[18px] dshx:text-muted-foreground">{props.t('developerTools.description')}</div>
        {failed && <div role="alert">{props.t('developerTools.error')}</div>}
      </div>
      <Switch
        aria-busy={asked === undefined ? undefined : true}
        aria-label={props.t('developerTools.title')}
        checked={asked?.value ?? enabled}
        className="dshx-root dshx:shrink-0"
        onCheckedChange={next => {
          sequence.current += 1
          const written = sequence.current
          setFailed(false)
          setAsked({ value: next, sequence: written })
          props.setEnabled(next).then(
            () => settle(written, false),
            () => settle(written, true),
          )
        }}
      />
    </div>
  )
}

/** The sidebar trigger content: the gear, and the label only in the wide column. */
export const TriggerContent = (props: { readonly wide: boolean; readonly t: ShellTranslate }): JSX.Element => (
  <>
    <span className="dshx:relative dshx:inline-flex">
      <IconSettingsOutlineMedium size={props.wide ? 16 : 18} />
      <DshReleaseIndicator t={props.t} />
    </span>
    {props.wide && <span className="dshx:overflow-hidden dshx:whitespace-nowrap">{props.t('trigger')}</span>}
  </>
)

export const HeaderContent = (props: { readonly t: ShellTranslate }): JSX.Element => <>{props.t('title')}</>

export const CloseLabel = (props: { readonly t: ShellTranslate }): JSX.Element => <>{props.t('close')}</>
