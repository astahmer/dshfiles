import { BotIcon, BugIcon, CircleHelpIcon, LightbulbIcon, SquareCheckIcon, StickyNoteIcon, type LucideIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

import type { BacklogKind, BacklogStatus } from './item.js'

const statusLabels = { inbox: 'Inbox', todo: 'Todo', doing: 'In progress', done: 'Done', dropped: 'Dropped' } satisfies Record<BacklogStatus, string>
const kindLabels = { task: 'Task', bug: 'Bug', idea: 'Idea', note: 'Note', question: 'Question' } satisfies Record<BacklogKind, string>

const statusTone = {
  inbox: 'dshx:text-muted-foreground',
  todo: 'dshx:text-muted-foreground',
  doing: 'dshx:text-warning',
  done: 'dshx:text-violet',
  dropped: 'dshx:text-muted-foreground',
} satisfies Record<BacklogStatus, string>

/** Linear-style progress rings: dashed for untriaged, empty, half, full with a check, full with a cross. */
const StatusIcon = (props: { readonly status: BacklogStatus; readonly className?: string }): JSX.Element => (
  <svg aria-hidden viewBox="0 0 14 14" width="14" height="14" className={cn('dshx:shrink-0', statusTone[props.status], props.className)}>
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
        <circle cx="7" cy="7" r="6.25" fill="currentColor" />
        <path d="m4.4 7.2 1.8 1.8 3.5-3.6" fill="none" stroke="var(--color-background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) : null}
    {props.status === 'dropped' ? (
      <>
        <circle cx="7" cy="7" r="6.25" fill="currentColor" />
        <path d="m5 5 4 4m0-4-4 4" fill="none" stroke="var(--color-background)" strokeWidth="1.5" strokeLinecap="round" />
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

/** The owner as a tiny avatar: the user's initial, or a bot for an agent. */
const ActorAvatar = (props: { readonly actorId: string | undefined }): JSX.Element => {
  const agent = props.actorId?.startsWith('agent:') === true
  return (
    <span
      title={agent ? `Agent ${props.actorId?.slice('agent:'.length) ?? ''}` : 'You'}
      className={cn(
        'dshx:inline-flex dshx:size-[18px] dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-[10px] dshx:font-semibold',
        agent ? 'dshx:bg-violet/15 dshx:text-violet' : 'dshx:bg-info/15 dshx:text-info',
      )}
    >
      {agent ? <BotIcon aria-hidden className="dshx:size-3" /> : 'Y'}
    </span>
  )
}

export class ItemGlyphs {
  static readonly statusLabels = statusLabels
  static readonly kindLabels = kindLabels
  static readonly StatusIcon = StatusIcon
  static readonly KindIcon = KindIcon
  static readonly ActorAvatar = ActorAvatar
}
