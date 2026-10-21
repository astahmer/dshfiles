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

import type { BacklogAttention, BacklogKind, BacklogStatus } from './item.js'

const statusLabels = { inbox: 'Inbox', todo: 'Todo', doing: 'In progress', done: 'Done', dropped: 'Dropped' } satisfies Record<BacklogStatus, string>
const kindLabels = { task: 'Task', bug: 'Bug', idea: 'Idea', note: 'Note', question: 'Question' } satisfies Record<BacklogKind, string>
const attentionLabels = { none: 'No attention', 'needs-input': 'Needs you', blocked: 'Blocked', waiting: 'Waiting' } satisfies Record<BacklogAttention, string>

const statusTone = {
  inbox: 'dshx:text-muted-foreground',
  todo: 'dshx:text-muted-foreground',
  doing: 'dshx:text-warning',
  done: 'dshx:text-success',
  dropped: 'dshx:text-destructive',
} satisfies Record<BacklogStatus, string>

/** Linear-style progress rings: dashed for untriaged, empty, half, then a green check or a red cross, since a filled
 * dot is what a project's own colour dot looks like. */
const StatusIcon = (props: { readonly status: BacklogStatus; readonly className?: string }): JSX.Element => (
  <svg aria-hidden viewBox="0 0 14 14" width="14" height="14" className={cn('dshx:size-3.5 dshx:shrink-0', statusTone[props.status], props.className)}>
    {props.status === 'inbox' ? <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.8" /> : null}
    {props.status === 'todo' ? <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /> : null}
    {props.status === 'doing' ? (
      <>
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
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
        <path d="m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
  bug: 'dshx:text-destructive',
  idea: 'dshx:text-warning',
  note: 'dshx:text-info',
  question: 'dshx:text-teal',
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

/** A small pill only when the item asks for something; nothing for the normal case. */
const AttentionBadge = (props: { readonly attention: BacklogAttention; readonly compact?: boolean }): JSX.Element | null => {
  if (props.attention === 'none') return null
  const Icon = attentionIcons[props.attention]
  return (
    <span
      title={attentionLabels[props.attention]}
      className={cn(
        'dshx:inline-flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:px-1.5 dshx:text-[11px] dshx:font-medium',
        attentionTone[props.attention],
      )}
    >
      <Icon aria-hidden className="dshx:size-3" />
      {props.compact === true ? null : attentionLabels[props.attention]}
    </span>
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
  <span aria-hidden className={cn('dshx:inline-block dshx:size-2 dshx:shrink-0 dshx:rounded-full', projectTone(props.project), props.className)} />
)

/** A project as its dot and short name; the full path stays in the tooltip. */
const ProjectLabel = (props: { readonly project: string; readonly className?: string }): JSX.Element => (
  <span title={props.project} className={cn('dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5', props.className)}>
    <ProjectDot project={props.project} />
    <span className="dshx:truncate">{projectName(props.project)}</span>
  </span>
)

const actorName = (id: string | undefined): string => {
  if (id === undefined || id === 'user') return 'You'
  if (id === 'system') return 'Automatic'
  return `Agent ${id.replace(/^agent:(session-)?/, '').slice(0, 6)}`
}

/** An actor as a tiny avatar: the user's initial, a bot for an agent, a wand for automatic triage and signals. */
const ActorAvatar = (props: { readonly actorId: string | undefined; readonly className?: string }): JSX.Element => {
  const agent = props.actorId?.startsWith('agent:') === true
  const system = props.actorId === 'system'
  return (
    <span
      title={actorName(props.actorId)}
      className={cn(
        'dshx:inline-flex dshx:size-[18px] dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-[9px] dshx:font-semibold dshx:ring-2 dshx:ring-background',
        agent ? 'dshx:bg-violet/20 dshx:text-violet' : system ? 'dshx:bg-muted dshx:text-muted-foreground' : 'dshx:bg-info/20 dshx:text-info',
        props.className,
      )}
    >
      {agent ? <BotIcon aria-hidden className="dshx:size-2.5" /> : system ? <WandSparklesIcon aria-hidden className="dshx:size-2.5" /> : 'Y'}
    </span>
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
        <span className="dshx:z-10 dshx:inline-flex dshx:h-[18px] dshx:items-center dshx:rounded-full dshx:bg-muted dshx:px-1 dshx:text-[9px] dshx:text-muted-foreground dshx:ring-2 dshx:ring-background">
          +{props.actorIds.length - max}
        </span>
      ) : null}
    </span>
  )
}

const attentionPhrases = {
  none: 'cleared the request',
  'needs-input': 'asked for your input',
  blocked: 'flagged it blocked',
  waiting: 'set it waiting',
} satisfies Record<BacklogAttention, string>

/**
 * One event as a short sentence after the actor's name. An attention change records only the field name, so the item's
 * current attention says what it was set to.
 */
const describeEvent = (event: { readonly kind: string; readonly detail: string; readonly actor: string }, attention: BacklogAttention): string => {
  if (event.kind === 'created') return 'captured it'
  if (event.kind === 'moved') return `moved it ${event.detail}`
  if (event.kind === 'commented') return 'commented'
  if (event.kind === 'linked') return `linked ${event.detail}`
  if (event.kind === 'unlinked') return `unlinked ${event.detail}`
  if (event.kind === 'triaged') return event.actor === 'system' ? `triage ${event.detail}` : `${event.detail.split(' ')[0] ?? 'handled'} a suggestion`
  if (event.detail === 'attention') return attentionPhrases[attention]
  return `edited ${event.detail}`
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
  static readonly KindIcon = KindIcon
  static readonly AttentionBadge = AttentionBadge
  static readonly ProjectDot = ProjectDot
  static readonly ProjectLabel = ProjectLabel
  static readonly ActorAvatar = ActorAvatar
  static readonly ActorStack = ActorStack
  static readonly projectName = projectName
  static readonly actorName = actorName
  static readonly ago = ago
  static readonly describeEvent = describeEvent
}
