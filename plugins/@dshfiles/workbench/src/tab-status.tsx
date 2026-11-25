import { StatusGlyph, workStatusLabels, type WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { ActivityIcon, BotIcon, GitMergeIcon, InboxIcon, LibraryIcon, ListTodoIcon, MessagesSquareIcon, SettingsIcon, type LucideIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
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
 * A page tab's destination glyph (round five B4): 14px in a 16px seat before the title, tertiary ink on a background tab
 * and the destination's nav tone on the tab on screen; the label stays ink. Every page tab draws it, so activating one
 * never moves its title. Decorative: the title names the page.
 */
export const TabDestinationGlyph = (props: {
  readonly destination: TabDestination
  /** The tab on screen; omit when the strip marks it with CSS and pass `activeClassName` instead. */
  readonly active?: boolean
  /** Classes that turn the tone on from the strip's own active marker (`dshx:in-[.dv-active-tab]:text-nav-tone`). */
  readonly activeClassName?: string
}): JSX.Element => {
  const Glyph = DESTINATION_GLYPHS[props.destination.icon]
  return (
    <span
      aria-hidden="true"
      data-tab-destination={props.destination.id}
      data-active={props.active === true ? '' : undefined}
      className={cn(
        'dshx:flex dshx:size-4 dshx:flex-none dshx:items-center dshx:justify-center',
        DESTINATION_TONES[props.destination.id],
        props.active === true ? 'dshx:text-nav-tone' : 'dshx:text-(--dsw-alias-label-tertiary)',
        props.activeClassName,
      )}
    >
      <Glyph size={14} strokeWidth={1.5} />
    </span>
  )
}
