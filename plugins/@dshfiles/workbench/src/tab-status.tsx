import { StatusGlyph, workStatusLabels, type WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { ActivityIcon, BotIcon, GitMergeIcon, InboxIcon, LibraryIcon, ListTodoIcon, MessagesSquareIcon, SettingsIcon, SquarePenIcon, type LucideIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { placeToneStyle } from '@dshfiles/plugin-ui/components/ui/place-glyph'
import { defineRegistry, useRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'
import type { TabDestination, TabDestinationIcon, TabDestinationId, TabStatus } from './tabs.js'

/**
 * The one mapping from a thread tab's status onto the shared work-status vocabulary (DESIGN.md "Status vocabulary").
 * Both tab strips draw it, so a thread shows the same glyph on its tab as in the thread list: working is the
 * colourless ink ring, Needs you the indigo diamond, failed the red cross, an unseen finish (Ready) the green dot.
 */
export const TAB_WORK_STATUS = {
  needsYou: 'needs-you',
  failed: 'failed',
  running: 'working',
  unread: 'ready',
} as const satisfies Record<TabStatus, WorkStatus>

/** The status mark of one thread tab; never a coloured dot of the strip's own. */
export const TabStatusGlyph = (props: {
  readonly status: TabStatus
  /** Accessible name; an empty or missing one falls back to the vocabulary's English label. Ignored when `decorative`. */
  readonly label?: string | undefined
  /** Hide from assistive technology when the tab's own name already says the state. */
  readonly decorative?: boolean
  readonly className?: string
}): JSX.Element => (
  <StatusGlyph
    status={TAB_WORK_STATUS[props.status]}
    label={props.label === undefined || props.label === '' ? workStatusLabels[TAB_WORK_STATUS[props.status]] : props.label}
    decorative={props.decorative ?? false}
    data-tab-status={props.status}
    {...(props.className === undefined ? {} : { className: props.className })}
  />
)

const DESTINATION_GLYPHS = {
  'messages-square': MessagesSquareIcon,
  inbox: InboxIcon,
  'git-merge': GitMergeIcon,
  'list-todo': ListTodoIcon,
  bot: BotIcon,
  activity: ActivityIcon,
  library: LibraryIcon,
  settings: SettingsIcon,
} as const satisfies Record<TabDestinationIcon, LucideIcon>

/** The rail's identity tones (DESIGN.md › Navigation identity), so a page tab names its destination in the same colour. */
const DESTINATION_TONES = {
  threads: 'dshx:nav-tone-threads',
  inbox: 'dshx:nav-tone-inbox',
  land: 'dshx:nav-tone-land',
  work: 'dshx:nav-tone-work',
  agents: 'dshx:nav-tone-agents',
  observe: 'dshx:nav-tone-observe',
  knowledge: 'dshx:nav-tone-knowledge',
  settings: 'dshx:nav-tone-settings',
} as const satisfies Record<TabDestinationId, string>

/**
 * A page's own glyph for its tab (round nine B2): a page that sits under a destination but is a place of its own (AI
 * accounts and Plugins under Settings) names itself with the glyph and tone its row carries in that destination's list,
 * not the destination's glyph. The plugin that owns that list provides the entries (settings-shell for Settings pages);
 * both tab strips read them. Tone: any CSS colour. Glyph: a lucide icon or any svg component that takes `size` and
 * `strokeWidth` (Usage's own bar chart).
 */
export interface TabPlaceGlyph {
  readonly panelId: string
  readonly glyph: LucideIcon | ComponentType<{ readonly size?: number; readonly strokeWidth?: number }>
  readonly tone: string
}
export const TabPlaceGlyphs = defineRegistry<TabPlaceGlyph>('@dshfiles/workbench.tab-place-glyph')

/** The 20px seat on a 16px footprint (negative margins), so the active tab's tile never moves its title. */
const TAB_PLACE_SEAT = 'dshx:flex dshx:size-5 dshx:-m-0.5 dshx:flex-none dshx:items-center dshx:justify-center dshx:rounded-md'

/**
 * A page tab's destination glyph (round five B4): 14px before the title, tertiary ink on a background tab and the
 * destination's nav tone on the tab on screen, on that tone's 14% tile (round nine B2, the rail's selected place); the
 * label stays ink. A page with its own place glyph (`TabPlaceGlyphs`) shows that one, in its tone. Every page tab draws
 * it, so activating one never moves its title. Decorative: the title names the page.
 */
export const TabDestinationGlyph = (props: {
  readonly destination: TabDestination
  /** The page the tab shows: a page with its own place glyph draws that instead of its destination's. */
  readonly panelId?: string | undefined
  /** The tab on screen; omit when the strip marks it with CSS and pass `activeClassName` instead. */
  readonly active?: boolean
  /** Classes that turn the tone on from the strip's own active marker (`dshx:in-[.dv-active-tab]:text-nav-tone`). */
  readonly activeClassName?: string
}): JSX.Element => {
  const places = useRegistry(TabPlaceGlyphs)
  const place = props.panelId === undefined ? undefined : places.findLast(candidate => candidate.panelId === props.panelId)
  const Glyph = place?.glyph ?? DESTINATION_GLYPHS[props.destination.icon]
  return (
    <span
      aria-hidden="true"
      data-tab-destination={props.destination.id}
      data-tab-place={place === undefined ? undefined : place.panelId}
      data-active={props.active === true ? '' : undefined}
      style={place === undefined ? undefined : placeToneStyle(place.tone)}
      className={cn(
        TAB_PLACE_SEAT,
        place === undefined ? DESTINATION_TONES[props.destination.id] : undefined,
        props.active === true ? 'dshx:bg-nav-tile dshx:text-nav-tone' : 'dshx:text-(--dsw-alias-label-tertiary)',
        props.activeClassName,
      )}
    >
      <Glyph size={14} strokeWidth={1.5} />
    </span>
  )
}

/**
 * A new thread tab's mark (council round 6 B6): a thread with no status and no project yet would leave its 16px seat
 * empty, so it draws the compose glyph there, tertiary on a background tab and the Threads tone on the tab on screen,
 * as a page tab draws its destination. Its status replaces it once the thread runs. Decorative: the title names it.
 */
export const TabComposeGlyph = (props: {
  /** The tab on screen; omit when the strip marks it with CSS and pass `activeClassName` instead. */
  readonly active?: boolean
  readonly activeClassName?: string
}): JSX.Element => (
  <span
    aria-hidden="true"
    data-tab-compose=""
    className={cn(
      'dshx:flex dshx:size-4 dshx:flex-none dshx:items-center dshx:justify-center',
      DESTINATION_TONES.threads,
      props.active === true ? 'dshx:text-nav-tone' : 'dshx:text-(--dsw-alias-label-tertiary)',
      props.activeClassName,
    )}
  >
    <SquarePenIcon size={14} strokeWidth={1.5} />
  </span>
)
