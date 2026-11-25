import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  BotIcon,
  BugIcon,
  CircleAlertIcon,
  CircleHelpIcon,
  CirclePauseIcon,
  HandIcon,
  LightbulbIcon,
  SquareCheckIcon,
  StickyNoteIcon,
  WandSparklesIcon,
  type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'

import type { BacklogAttention, BacklogKind, BacklogStatus } from './item.js'
import { activityPhrase } from './activity-phrase.js'
import { actorName } from './actor-name.js'
import { BacklogProjectPaths } from './project-paths.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

const statusLabels = { inbox: 'Inbox', todo: 'Todo', doing: 'In progress', done: 'Done', dropped: 'Dropped' } satisfies Record<BacklogStatus, string>
const kindLabels = { task: 'Task', bug: 'Bug', idea: 'Idea', note: 'Note', question: 'Question' } satisfies Record<BacklogKind, string>
const attentionLabels = { none: 'No attention', 'needs-input': 'Needs you', blocked: 'Blocked', waiting: 'Waiting' } satisfies Record<BacklogAttention, string>

const statusTone = {
  inbox: 'dshx:text-foreground',
  todo: 'dshx:text-foreground',
  doing: 'dshx:text-foreground',
  done: 'dshx:text-muted-foreground',
  dropped: 'dshx:text-muted-foreground',
} satisfies Record<BacklogStatus, string>

/** Freshness the glyph draws as stale: an open item idle past its limit may be out of date. */
const isStale = (freshness: string): boolean => freshness === 'stale' || freshness === 'dormant'

/**
 * Linear-style progress rings: an open item (Inbox, Todo) is a solid ink ring, In progress adds an ink half, then a
 * muted check, or a muted ring with one diagonal stroke for Dropped (DESIGN.md › Colour roles: the red cross is
 * Failed's, and a page's own vocabulary takes no status hue). The dashed faint ring is only for a stale item (DESIGN.md ›
 * Status glyphs; council round 6, D3). A filled dot is what a project's own colour dot looks like.
 */
const StatusIcon = (props: { readonly status: BacklogStatus; readonly stale?: boolean; readonly className?: string }): JSX.Element => (
  <svg
    aria-hidden
    viewBox="0 0 14 14"
    width="14"
    height="14"
    data-stale={props.stale === true || undefined}
    className={cn('dshx:size-3.5 dshx:shrink-0', props.stale === true ? 'dshx:text-muted-foreground' : statusTone[props.status], props.className)}
  >
    {props.status === 'inbox' || props.status === 'todo' ? (
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={props.stale === true ? '2.2 1.8' : undefined} />
    ) : null}
    {props.status === 'doing' ? (
      <>
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={props.stale === true ? '2.2 1.8' : undefined} />
        <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
      </>
    ) : null}
    {props.status === 'done' ? (
      <>
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="m4.2 7.2 1.9 1.9 3.7-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) : null}
    {props.status === 'dropped' ? (
      <>
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="m3.4 10.6 7.2-7.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ) : null}
  </svg>
)

const kindIcons = { task: SquareCheckIcon, bug: BugIcon, idea: LightbulbIcon, note: StickyNoteIcon, question: CircleHelpIcon } satisfies Record<
  BacklogKind,
  LucideIcon
>
const kindTone = {
  task: 'dshx:text-muted-foreground',
  bug: 'dshx:text-muted-foreground',
  idea: 'dshx:text-muted-foreground',
  note: 'dshx:text-muted-foreground',
  question: 'dshx:text-muted-foreground',
} satisfies Record<BacklogKind, string>

const KindIcon = (props: { readonly kind: BacklogKind; readonly className?: string }): JSX.Element => {
  const Icon = kindIcons[props.kind]
  return <Icon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0', kindTone[props.kind], props.className)} />
}

const attentionIcons = { 'needs-input': HandIcon, blocked: CircleAlertIcon, waiting: CirclePauseIcon } satisfies Record<
  Exclude<BacklogAttention, 'none'>,
  LucideIcon
>
const attentionTone = {
  'needs-input': 'dshx:bg-warning/12 dshx:text-warning',
  blocked: 'dshx:bg-destructive/12 dshx:text-destructive',
  waiting: 'dshx:bg-muted dshx:text-muted-foreground',
} satisfies Record<Exclude<BacklogAttention, 'none'>, string>

const attentionIconTone = {
  'needs-input': 'dshx:text-warning',
  blocked: 'dshx:text-destructive',
  waiting: 'dshx:text-muted-foreground',
} satisfies Record<Exclude<BacklogAttention, 'none'>, string>

/**
 * The attention glyph alone, the width of a Status or Kind icon, for icon columns such as menu rows: the pill below is
 * 24px wide and pushes the row's label 10px past its neighbours.
 */
const AttentionIcon = (props: { readonly attention: BacklogAttention; readonly className?: string }): JSX.Element => {
  if (props.attention === 'none') return <span aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0', props.className)} />
  const Icon = attentionIcons[props.attention]
  return <Icon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0', attentionIconTone[props.attention], props.className)} />
}

/** A small pill only when the item asks for something; nothing for the normal case. */
const AttentionBadge = (props: { readonly attention: BacklogAttention; readonly compact?: boolean }): JSX.Element | null => {
  if (props.attention === 'none') return null
  const Icon = attentionIcons[props.attention]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'dshx:inline-flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:px-1.5 dshx:text-2xs dshx:font-medium',
            attentionTone[props.attention],
          )}
        >
          <Icon aria-hidden className="dshx:size-3" />
          {props.compact === true ? null : attentionLabels[props.attention]}
        </span>
      </TooltipTrigger>
      <TooltipContent>{attentionLabels[props.attention]}</TooltipContent>
    </Tooltip>
  )
}

const projectTones = [
  'dshx:bg-info',
  'dshx:bg-violet',
  'dshx:bg-teal',
  'dshx:bg-warning',
  'dshx:bg-success',
  'dshx:bg-graph-1',
  'dshx:bg-graph-2',
  'dshx:bg-graph-3',
  'dshx:bg-graph-4',
  'dshx:bg-graph-5',
] as const

const projectName = (project: string): string => project.split('/').filter(Boolean).at(-1) ?? project

/** A stable color per project path, so the same project reads the same everywhere without anyone picking one. */
const projectTone = (project: string): string => {
  let hash = 0
  for (const char of project) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return projectTones[hash % projectTones.length] ?? 'dshx:bg-info'
}

const ProjectDot = (props: { readonly project: string; readonly className?: string }): JSX.Element => (
  <StatusDot className={cn('dshx:inline-block', projectTone(props.project), props.className)} />
)

/** A project as its dot and short name; the full path stays in the tooltip. */
const ProjectLabel = (props: { readonly project: string; readonly className?: string }): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className={cn('dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5', props.className)}>
        <ProjectDot project={props.project} />
        <span className="dshx:truncate">{projectName(props.project)}</span>
      </span>
    </TooltipTrigger>
    <TooltipContent>{BacklogProjectPaths.displayPath(props.project)}</TooltipContent>
  </Tooltip>
)

/** An actor as a tiny avatar: the user's initial, a bot for an agent, a wand for automatic triage and signals. */
const ActorAvatar = (props: { readonly actorId: string | undefined; readonly className?: string }): JSX.Element => {
  const agent = props.actorId?.startsWith('agent:') === true
  const system = props.actorId === 'system'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'dshx:inline-flex dshx:size-[18px] dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-2xs dshx:font-semibold dshx:ring-2 dshx:ring-background',
            agent
              ? 'dshx:bg-identity-2/20 dshx:text-identity-2'
              : system
                ? 'dshx:bg-muted dshx:text-muted-foreground'
                : 'dshx:bg-identity-1/20 dshx:text-identity-1',
            props.className,
          )}
        >
          {agent ? <BotIcon aria-hidden className="dshx:size-2.5" /> : system ? <WandSparklesIcon aria-hidden className="dshx:size-2.5" /> : 'Y'}
        </span>
      </TooltipTrigger>
      <TooltipContent>{actorName(props.actorId)}</TooltipContent>
    </Tooltip>
  )
}

const ActorStack = (props: { readonly actorIds: readonly string[]; readonly max?: number }): JSX.Element => {
  const max = props.max ?? 3
  return (
    <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:-space-x-1.5">
      {props.actorIds.slice(0, max).map(id => (
        <ActorAvatar key={id} actorId={id} />
      ))}
      {props.actorIds.length > max ? (
        <span className="dshx:z-10 dshx:inline-flex dshx:h-[18px] dshx:items-center dshx:rounded-full dshx:bg-muted dshx:px-1 dshx:text-2xs dshx:text-muted-foreground dshx:ring-2 dshx:ring-background">
          +{props.actorIds.length - max}
        </span>
      ) : null}
    </span>
  )
}

const AGO_SUFFIX = { minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const
const ago = (time: number, now = Date.now()): string => {
  const age = relativeTime(time, now)
  return age.unit === 'now' ? 'now' : `${String(age.n)}${AGO_SUFFIX[age.unit]}`
}

export class ItemGlyphs {
  static readonly statusLabels = statusLabels
  static readonly kindLabels = kindLabels
  static readonly attentionLabels = attentionLabels
  static readonly StatusIcon = StatusIcon
  static readonly isStale = isStale
  static readonly KindIcon = KindIcon
  static readonly AttentionBadge = AttentionBadge
  static readonly AttentionIcon = AttentionIcon
  static readonly ProjectDot = ProjectDot
  static readonly ProjectLabel = ProjectLabel
  static readonly ActorAvatar = ActorAvatar
  static readonly ActorStack = ActorStack
  static readonly projectName = projectName
  static readonly displayProjectPath = BacklogProjectPaths.displayPath
  static readonly actorName = actorName
  static readonly ago = ago
  static readonly describeEvent = activityPhrase
}
