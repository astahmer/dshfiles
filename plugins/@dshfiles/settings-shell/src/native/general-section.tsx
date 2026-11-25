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

/** The control a search entry names: the row tagged with its id, focused on its first control. */
const revealSettingsEntry = (input: { readonly container: HTMLElement; readonly entryId: string }): boolean => {
  const row = input.container.querySelector<HTMLElement>(`[data-settings-entry="${CSS.escape(input.entryId)}"]`)
  if (row === null) return false
  row.scrollIntoView({ block: 'center' })
  const focusable = row.querySelector<HTMLElement>('button, input, select, textarea, [role="switch"], [tabindex]:not([tabindex="-1"])') ?? row
  focusable.focus({ preventScroll: true })
  return true
}

/**
 * Each Appearance card's own colours (round five B7): paper, ink and accent dots generated from the kit's palette for
 * that scheme, so the card shows the theme it picks rather than only its icon. System shows both papers and the accent.
 */
const themeSwatches = (): CSSProperties & Record<`--settings-swatch-${string}`, string> => {
  const light = PaletteMath.standaloneColours('light')
  const dark = PaletteMath.standaloneColours('dark')
  const dot = (x: number, fill: string, edge: string): string =>
    `radial-gradient(circle at ${String(x)}px 50%, ${fill} 4px, ${edge} 4.5px, ${edge} 5px, transparent 5.5px)`
  // One mid-grey ring on every dot: a near-white or near-black dot then shows on a light and on a dark card alike.
  const ring = light.faint
  const strip = (paper: string, ink: string, accent: string): string => [dot(6, paper, ring), dot(20, ink, ring), dot(34, accent, accent)].join(', ')
  return {
    '--settings-swatch-light': strip(light.bg, light.text, light.accent),
    '--settings-swatch-dark': strip(dark.bg, dark.text, dark.accent),
    '--settings-swatch-system': strip(light.bg, dark.bg, light.accent),
  }
}

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
        // Round five P4: the chosen Appearance cube (core theme row, unlayered module CSS) at the tint rung: the selected
        // wash, a 1px accent border and a 2px accent tick in its top-end corner. Narrow panes get shorter cubes.
        'dshx:[&_[class*=_themeCube][aria-pressed=true]]:relative dshx:[&_[class*=_themeCube][aria-pressed=true]]:border! dshx:[&_[class*=_themeCube][aria-pressed=true]]:border-ring! dshx:[&_[class*=_themeCube][aria-pressed=true]]:bg-selected-wash!',
        "dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:absolute dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:top-2.5 dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:right-3.5 dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:bottom-auto dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:left-auto dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:h-2.5 dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:w-1.5 dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:rotate-45 dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:border-r-2 dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:border-b-2 dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:border-ring dshx:[&_[class*=_themeCube][aria-pressed=true]]:after:content-['']",
        'dshx:@max-pane-narrow:[&_[class*=_themeCube]]:py-2! dshx:@max-pane-narrow:[&_[class*=_themeCube]]:gap-1!',
        // Each card's theme swatch under its label (`themeSwatches`): cards in core order, Light, Dark, System.
        "dshx:[&_[class*=_themeCube]]:before:order-last dshx:[&_[class*=_themeCube]]:before:mt-1 dshx:[&_[class*=_themeCube]]:before:h-3 dshx:[&_[class*=_themeCube]]:before:w-10 dshx:[&_[class*=_themeCube]]:before:content-['']",
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
        <div className="dshx:mt-1 dshx:text-xs dshx:leading-[18px] dshx:text-muted-foreground">{props.t('developerTools.description')}</div>
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
