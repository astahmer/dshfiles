import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import {
  AlarmClockIcon,
  ArrowRightLeftIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  FolderIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  HashIcon,
  KeyRoundIcon,
  LinkIcon,
  Maximize2Icon,
  MessageSquareIcon,
  MessagesSquareIcon,
  Minimize2Icon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  QuoteIcon,
  SparklesIcon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useAgentDispatch } from './agent-dispatch-context.js'
import { backlogApi, BacklogViews, type BacklogDetailView, type BacklogSummaryView } from './api.js'
import type { ComposerThread } from './composer.js'
import { BacklogItems, type BacklogAttention, type BacklogEvent, type BacklogLink, type BacklogProposal, type BacklogRelation } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { ItemFiles } from './item-files.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import { BacklogText } from './item-text.js'
import { ItemPickers } from './item-pickers.js'
import type { StartThreadItem } from './start-thread.js'
import { BacklogTriage } from './triage.js'
import { BacklogQueries, useBacklogActions } from './use-backlog-actions.js'

type OpenThread = (sessionId: string) => void

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
const HOUR_MS = 3_600_000

const linkIcons = {
  item: HashIcon,
  thread: MessagesSquareIcon,
  revision: GitCommitHorizontalIcon,
  branch: GitBranchIcon,
  workspace: FolderIcon,
  url: ExternalLinkIcon,
  secret: KeyRoundIcon,
} satisfies Record<BacklogLink['type'], LucideIcon>

const relationLabels = {
  related: 'Related',
  'depends-on': 'Depends on',
  blocks: 'Blocks',
  duplicates: 'Duplicates',
  implements: 'Implemented by',
  fixes: 'Fixed by',
  'discovered-from': 'Discovered from',
  'discussed-in': 'Discussed in',
} satisfies Record<BacklogRelation, string>

const provenanceLabels = { user: 'you', agent: 'agent', extracted: 'from text', inferred: 'suggested' } as const

const linkLabel = (link: BacklogLink): string => {
  if (link.type === 'item') return `b:${link.target}`
  if (link.type === 'thread') return `Thread ${link.target.replace(/^session-/, '').slice(0, 8)}`
  if (link.type === 'revision') return `jj:${link.target}`
  if (link.type === 'url') return link.target.replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (link.type === 'secret') return `secret:${link.target}`
  return link.target
}

const linkTypeOf = (value: string): BacklogLink['type'] | undefined => BacklogItems.linkTypes.find(type => type === value)
const relationOf = (value: string): BacklogRelation | undefined => BacklogItems.relations.find(relation => relation === value)

const eventIcons = {
  created: SparklesIcon,
  edited: PencilIcon,
  moved: ArrowRightLeftIcon,
  linked: LinkIcon,
  unlinked: LinkIcon,
  commented: MessageSquareIcon,
  triaged: WandSparklesIcon,
} satisfies Record<BacklogEvent['kind'], LucideIcon>

const Section = (props: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode }): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:gap-2">
    <div className="dshx:flex dshx:h-6 dshx:items-center dshx:justify-between">
      <h4 className="dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground">{props.title}</h4>
      {props.action}
    </div>
    {props.children}
  </section>
)

const AddLink = (props: { readonly id: number }): JSX.Element => {
  const actions = useBacklogActions()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<BacklogLink['type']>('url')
  const [relation, setRelation] = useState<BacklogRelation>('related')
  const [target, setTarget] = useState('')
  const selectClass = 'dshx:h-7 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-1.5 dshx:text-xs dshx:text-foreground'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Add link">
          <PlusIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="dshx-root dshx:w-96 dshx:p-2">
        <form
          className="dshx:flex dshx:flex-col dshx:gap-2"
          onSubmit={event => {
            event.preventDefault()
            if (target.trim() === '') return
            actions.link.mutate({ id: props.id, link: { type, target: target.trim(), relation } }, { onSuccess: () => setTarget('') })
            setOpen(false)
          }}
        >
          <div className="dshx:flex dshx:gap-1.5">
            <select
              aria-label="Relation"
              className={selectClass}
              value={relation}
              onChange={event => setRelation(relationOf(event.currentTarget.value) ?? 'related')}
            >
              {BacklogItems.relations.map(value => (
                <option key={value} value={value}>
                  {relationLabels[value]}
                </option>
              ))}
            </select>
            <select aria-label="Link type" className={selectClass} value={type} onChange={event => setType(linkTypeOf(event.currentTarget.value) ?? 'url')}>
              {BacklogItems.linkTypes.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <input
            aria-label="Link target"
            autoFocus
            placeholder="URL, session id, jj revision, branch, item number…"
            className="dshx:h-8 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-xs dshx:outline-none dshx:focus-visible:border-ring"
            value={target}
            onChange={event => setTarget(event.currentTarget.value)}
          />
        </form>
      </PopoverContent>
    </Popover>
  )
}

const TitleField = (props: { readonly id: number; readonly title: string }): JSX.Element => {
  const actions = useBacklogActions()
  const [title, setTitle] = useState(props.title)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    setTitle(props.title)
  }, [props.title])
  const save = (): void => {
    setEditing(false)
    if (title.trim() !== '' && title !== props.title) actions.update.mutate({ id: props.id, title })
  }
  if (editing)
    return (
      <textarea
        aria-label="Title"
        autoFocus
        rows={1}
        value={title}
        onChange={event => setTitle(event.currentTarget.value.replace(/\n/g, ''))}
        onBlur={save}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setTitle(props.title)
            setEditing(false)
          }
        }}
        className="dshx:field-sizing-content dshx:w-full dshx:resize-none dshx:bg-transparent dshx:text-xl dshx:font-semibold dshx:leading-snug dshx:tracking-tight dshx:text-foreground dshx:outline-none"
      />
    )
  return (
    <div className="dshx:flex dshx:items-start dshx:gap-1">
      <BacklogText
        text={props.title}
        onActivate={() => setEditing(true)}
        className="dshx:min-w-0 dshx:flex-1 dshx:cursor-text dshx:text-xl dshx:font-semibold dshx:leading-snug dshx:tracking-tight dshx:text-foreground dshx:[&>div]:text-xl! dshx:[&>div]:leading-snug! dshx:[&>div]:text-foreground! dshx:[&>div>p]:my-0"
      />
      <Button aria-label="Edit title" onClick={() => setEditing(true)} size="icon-xs" type="button" variant="ghost">
        <PencilIcon aria-hidden />
      </Button>
    </div>
  )
}

const BodyField = (props: { readonly id: number; readonly body: string }): JSX.Element => {
  const actions = useBacklogActions()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(props.body)
  useEffect(() => {
    if (!editing) setBody(props.body)
  }, [props.body, editing])
  const save = (): void => {
    setEditing(false)
    if (body !== props.body) actions.update.mutate({ id: props.id, body })
  }
  if (editing)
    return (
      <textarea
        aria-label="Body"
        autoFocus
        value={body}
        placeholder="Add a description… Markdown and URLs are clickable; b:12 and jj:rev add relationship links."
        onChange={event => setBody(event.currentTarget.value)}
        onBlur={save}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save()
          if (event.key === 'Escape') {
            setBody(props.body)
            setEditing(false)
          }
        }}
        className="dshx:field-sizing-content dshx:min-h-28 dshx:w-full dshx:resize-none dshx:rounded-lg dshx:border dshx:border-input dshx:bg-transparent dshx:p-2.5 dshx:text-[13px] dshx:leading-relaxed dshx:text-foreground dshx:outline-none"
      />
    )
  if (props.body === '')
    return (
      <button
        type="button"
        aria-label="Edit description"
        onClick={() => setEditing(true)}
        className="dshx:-mx-2 dshx:rounded-lg dshx:px-2 dshx:py-1.5 dshx:text-left dshx:text-[13px] dshx:leading-relaxed dshx:text-muted-foreground dshx:transition-colors dshx:hover:bg-accent/40"
      >
        Add a description…
      </button>
    )
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-1">
      <BacklogText
        text={props.body}
        onActivate={() => setEditing(true)}
        className="dshx:-mx-2 dshx:min-w-0 dshx:flex-1 dshx:cursor-text dshx:rounded-lg dshx:px-2 dshx:py-1.5 dshx:text-left dshx:text-[13px] dshx:leading-relaxed dshx:transition-colors dshx:hover:bg-accent/40"
      />
      <Button aria-label="Edit description" className="dshx:mt-1 dshx:shrink-0" onClick={() => setEditing(true)} size="icon-xs" type="button" variant="ghost">
        <PencilIcon aria-hidden />
      </Button>
    </div>
  )
}

const TagsField = (props: { readonly id: number; readonly tags: readonly string[] }): JSX.Element => {
  const actions = useBacklogActions()
  const [draft, setDraft] = useState('')
  return (
    <span className="dshx:inline-flex dshx:flex-wrap dshx:items-center dshx:gap-1">
      {props.tags.map(tag => (
        <span
          key={tag}
          className="dshx:group/tag dshx:inline-flex dshx:h-6 dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:border dshx:border-border dshx:pr-1 dshx:pl-1.5 dshx:text-xs dshx:text-muted-foreground"
        >
          #{tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            className="dshx:opacity-0 dshx:transition-opacity dshx:group-hover/tag:opacity-100 dshx:hover:text-foreground"
            onClick={() => actions.update.mutate({ id: props.id, tags: props.tags.filter(other => other !== tag) })}
          >
            <XIcon className="dshx:size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label="Add tag"
        placeholder="+ tag"
        value={draft}
        onChange={event => setDraft(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || draft.trim() === '') return
          actions.update.mutate({ id: props.id, tags: [...props.tags, draft.trim()] })
          setDraft('')
        }}
        className="dshx:h-6 dshx:w-14 dshx:bg-transparent dshx:text-xs dshx:outline-none dshx:placeholder:text-muted-foreground"
      />
    </span>
  )
}

/** Triage's or a finished thread's suggestion, shown until accepted or dismissed, with its confidence and reason. */
const ProposalCard = (props: { readonly id: number; readonly proposal: BacklogProposal }): JSX.Element => {
  const actions = useBacklogActions()
  const proposal = props.proposal
  const fromThread = proposal.origin === 'thread'
  return (
    <section
      aria-label={fromThread ? 'Thread suggestion' : 'Triage suggestion'}
      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-violet/30 dshx:bg-violet/5 dshx:p-3 dshx:animate-in dshx:fade-in-0"
    >
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
        <WandSparklesIcon aria-hidden className="dshx:size-3.5 dshx:text-violet" />
        <span className="dshx:font-medium">{fromThread ? 'Thread suggests' : 'Triage suggests'}</span>
        <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground">{BacklogTriage.describe(proposal)}</span>
        <span className="dshx:ml-auto dshx:text-muted-foreground">{Math.round(proposal.confidence * 100)}%</span>
      </div>
      {proposal.reason === '' ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{proposal.reason}</p>}
      <div className="dshx:flex dshx:items-center dshx:gap-1.5">
        <Button size="xs" onClick={() => actions.applyProposal.mutate(props.id)} disabled={actions.applyProposal.isPending}>
          Accept
        </Button>
        <Button size="xs" variant="ghost" onClick={() => actions.dismissProposal.mutate(props.id)} disabled={actions.dismissProposal.isPending}>
          Dismiss
        </Button>
      </div>
    </section>
  )
}

type ConversationRun = { readonly kind: 'comment'; readonly event: BacklogEvent } | { readonly kind: 'changes'; readonly events: BacklogEvent[] }

/** Comments read as messages; every other event folds into one "made N changes" line per actor run, opened on demand. */
const Conversation = (props: { readonly events: readonly BacklogEvent[]; readonly attention: BacklogAttention }): JSX.Element => {
  const attention = props.attention
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const runs: ConversationRun[] = []
  for (const event of props.events) {
    const last = runs.at(-1)
    if (event.kind === 'commented') runs.push({ kind: 'comment', event })
    else if (last?.kind === 'changes' && last.events.at(-1)?.actor === event.actor) last.events.push(event)
    else runs.push({ kind: 'changes', events: [event] })
  }
  return (
    <ol aria-label="Activity" className="dshx:relative dshx:flex dshx:flex-col dshx:gap-3">
      <span aria-hidden className="dshx:absolute dshx:inset-y-2 dshx:left-[9px] dshx:w-px dshx:bg-border" />
      {runs.map((run, index) => {
        if (run.kind === 'comment')
          return (
            <li key={`c:${String(index)}`} className="dshx:relative dshx:flex dshx:gap-2.5">
              <ItemGlyphs.ActorAvatar actorId={run.event.actor} className="dshx:z-10 dshx:mt-0.5 dshx:size-5" />
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
                <p className="dshx:text-xs dshx:text-muted-foreground">
                  <span className="dshx:font-medium dshx:text-foreground">{ItemGlyphs.actorName(run.event.actor)}</span> · {ItemGlyphs.ago(run.event.at)}
                </p>
                <div className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2 dshx:text-[13px]">
                  <MarkdownText text={run.event.detail} labels={markdownLabels} variant="compact" />
                </div>
              </div>
            </li>
          )
        const first = run.events[0]
        if (first === undefined) return null
        const expanded = open.has(index) || run.events.length === 1
        const Icon = eventIcons[first.kind]
        return (
          <li key={`e:${String(index)}`} className="dshx:relative dshx:flex dshx:gap-2.5">
            <span className="dshx:z-10 dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:border dshx:border-border dshx:bg-background">
              <Icon aria-hidden className="dshx:size-2.5 dshx:text-muted-foreground" />
            </span>
            <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1 dshx:pt-0.5 dshx:text-xs dshx:text-muted-foreground">
              {expanded ? (
                run.events.map((event, position) => (
                  <p key={String(position)}>
                    <span className="dshx:font-medium dshx:text-foreground">{ItemGlyphs.actorName(event.actor)}</span>{' '}
                    {ItemGlyphs.describeEvent(event, attention)} · {ItemGlyphs.ago(event.at)}
                  </p>
                ))
              ) : (
                <button
                  type="button"
                  className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-left dshx:hover:text-foreground"
                  onClick={() => setOpen(new Set([...open, index]))}
                >
                  <span className="dshx:font-medium dshx:text-foreground">{ItemGlyphs.actorName(first.actor)}</span> made {run.events.length} changes ·{' '}
                  {ItemGlyphs.ago(run.events.at(-1)?.at ?? first.at)}
                  <ChevronRightIcon className="dshx:size-3" />
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const CommentBox = (props: { readonly item: StartThreadItem }): JSX.Element => {
  const actions = useBacklogActions()
  const dispatch = useAgentDispatch()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const comment = (): void => {
    setText('')
    setFailed(null)
    actions.comment.mutate({ id: props.item.id, text }, { onError: () => setText(current => (current === '' ? text : current)) })
  }
  /** A leading `@handle` starts that agent's thread; anything else, or a handle nothing matches, stays a comment. */
  const submit = async (): Promise<void> => {
    if (text.trim() === '' || pending) return
    if (dispatch === null) {
      comment()
      return
    }
    setPending(true)
    setFailed(null)
    try {
      const outcome = await dispatch.dispatch({ item: props.item, text })
      if (outcome.kind === 'dispatched') setText('')
      else if (outcome.kind === 'failed') setFailed(outcome.reason)
      else comment()
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        void submit()
      }}
      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-2.5 dshx:transition-colors dshx:focus-within:border-input"
    >
      <textarea
        aria-label="Comment"
        rows={1}
        placeholder="Reply… b:12, jj:rev and URLs become links; @agent starts a thread"
        value={text}
        onChange={event => setText(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        className="dshx:field-sizing-content dshx:max-h-40 dshx:min-h-10 dshx:resize-none dshx:bg-transparent dshx:text-[13px] dshx:outline-none dshx:placeholder:text-muted-foreground"
      />
      {failed === null ? null : <p className="dshx:text-[11px] dshx:text-destructive">{failed}</p>}
      <div className="dshx:flex dshx:items-center dshx:justify-between">
        <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-[11px] dshx:text-muted-foreground">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd> to send
        </span>
        <Button type="submit" size="xs" disabled={text.trim() === '' || pending}>
          <CornerDownLeftIcon /> Reply
        </Button>
      </div>
    </form>
  )
}

const SnoozeMenu = (props: { readonly id: number; readonly snoozedUntil: number | null }): JSX.Element => {
  const actions = useBacklogActions()
  const until = (hours: number): number => Date.now() + hours * HOUR_MS
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Snooze" className={cn(props.snoozedUntil !== null && 'dshx:text-info')}>
          <AlarmClockIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root">
        <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">Hide until</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.update.mutate({ id: props.id, snoozedUntil: until(3) })}>In 3 hours</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.update.mutate({ id: props.id, snoozedUntil: until(24) })}>Tomorrow</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.update.mutate({ id: props.id, snoozedUntil: until(24 * 7) })}>Next week</DropdownMenuItem>
        {props.snoozedUntil === null ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.update.mutate({ id: props.id, snoozedUntil: null })}>Wake now</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const LinkRow = (props: {
  readonly itemId: number
  readonly link: BacklogLink
  readonly thread: ComposerThread | undefined
  readonly openThread: OpenThread
  readonly select: (id: number) => void
}): JSX.Element => {
  const actions = useBacklogActions()
  const link = props.link
  const Icon = linkIcons[link.type]
  const openAction = (): (() => void) | undefined => {
    if (link.type === 'thread') return () => props.openThread(link.target)
    if (link.type === 'item') return () => props.select(Number(link.target))
    if (link.type === 'url') return () => void window.open(link.target, '_blank', 'noopener,noreferrer')
    return undefined
  }
  const open = openAction()
  return (
    <li className="dshx:group/link dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:transition-colors dshx:hover:bg-accent/50">
      <Icon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
      {open === undefined ? (
        <span className="dshx:min-w-0 dshx:truncate dshx:font-mono! dshx:text-xs">{linkLabel(link)}</span>
      ) : (
        <button type="button" onClick={open} className="dshx:min-w-0 dshx:truncate dshx:text-left dshx:text-[13px] dshx:hover:underline">
          {props.thread?.title ?? linkLabel(link)}
        </button>
      )}
      {props.thread === undefined ? null : (
        <span
          className={cn(
            'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-[10px]',
            props.thread.running ? 'dshx:text-info' : 'dshx:text-muted-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn('dshx:size-1.5 dshx:rounded-full', props.thread.running ? 'dshx:animate-pulse dshx:bg-info' : 'dshx:bg-muted-foreground/50')}
          />
          {props.thread.running ? 'running' : 'idle'}
        </span>
      )}
      {link.provenance === undefined ? null : (
        <span
          className={cn(
            'dshx:shrink-0 dshx:rounded dshx:px-1 dshx:text-[10px]',
            link.provenance === 'inferred' ? 'dshx:border dshx:border-dashed dshx:border-violet/50 dshx:text-violet' : 'dshx:text-muted-foreground',
          )}
        >
          {provenanceLabels[link.provenance]}
        </span>
      )}
      <button
        type="button"
        aria-label={`Unlink ${link.type} ${link.target}`}
        className="dshx:ml-auto dshx:rounded dshx:text-muted-foreground dshx:opacity-0 dshx:transition-opacity dshx:group-hover/link:opacity-100 dshx:hover:text-foreground"
        onClick={() => actions.link.mutate({ id: props.itemId, link, remove: true })}
      >
        <XIcon className="dshx:size-3.5" />
      </button>
    </li>
  )
}

const PeekBody = (props: {
  readonly detail: BacklogDetailView
  readonly threads: readonly ComposerThread[]
  readonly loading: boolean
  readonly expanded: boolean
  readonly toggleExpanded: () => void
  readonly openThread: OpenThread
  readonly select: (id: number) => void
  readonly close: () => void
  readonly startThread: (item: StartThreadItem) => void
  readonly projectPaths: readonly string[]
}): JSX.Element => {
  const actions = useBacklogActions()
  const item = props.detail.item
  const scroller = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // Chromium's scrollTo returns a promise; an expression body would hand it to React as the effect's cleanup.
    void scroller.current?.scrollTo({ top: 0 })
  }, [item.id])
  const captured = item.events.find(event => event.kind === 'created')?.detail.trim() ?? ''
  const showCapture = captured !== '' && captured !== `${item.title}\n${item.body}`.trim() && captured !== item.title.trim()
  const running = props.threads.filter(thread => thread.running && item.links.some(link => link.type === 'thread' && link.target === thread.id))
  const groups = BacklogItems.relations
    .map(relation => ({ relation, links: item.links.filter(link => (link.relation ?? 'related') === relation) }))
    .filter(group => group.links.length > 0)
  return (
    <>
      <header className="dshx:flex dshx:h-11 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4">
        <nav aria-label="Breadcrumb" className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
          {item.project === null ? null : (
            <>
              <ItemGlyphs.ProjectDot project={item.project} />
              <span className="dshx:truncate" title={item.project}>
                {ItemGlyphs.projectName(item.project)}
              </span>
              <span>/</span>
            </>
          )}
          <span className="dshx:font-mono! dshx:text-foreground">b:{item.id}</span>
          {item.freshness === 'fresh' ? null : <span className="dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:text-[11px]">{item.freshness}</span>}
        </nav>
        <div className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Start thread"
            title="Start a thread for this item"
            onClick={() => props.startThread({ id: item.id, title: item.title, project: item.project, preview: item.body })}
          >
            <MessagesSquareIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Run triage"
            title="Run triage"
            disabled={actions.triage.isPending}
            onClick={() => actions.triage.mutate(item.id)}
            className={cn(actions.triage.isPending && 'dshx:animate-pulse')}
          >
            <WandSparklesIcon />
          </Button>
          <SnoozeMenu id={item.id} snoozedUntil={item.snoozedUntil ?? null} />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={item.pinned ? 'Unpin' : 'Pin'}
            aria-pressed={item.pinned}
            className={cn(item.pinned && 'dshx:text-warning')}
            onClick={() => actions.update.mutate({ id: item.id, pinned: !item.pinned })}
          >
            <PinIcon className={cn(item.pinned && 'dshx:fill-current')} />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label={props.expanded ? 'Collapse' : 'Expand'} onClick={props.toggleExpanded}>
            {props.expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={props.close}>
            <XIcon />
          </Button>
        </div>
      </header>
      <div ref={scroller} className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
        <div className={cn('dshx:mx-auto dshx:flex dshx:flex-col dshx:gap-6 dshx:px-5 dshx:py-5', props.expanded && 'dshx:max-w-3xl dshx:px-8')}>
          <BacklogItemMenu
            item={item}
            projectPaths={props.projectPaths}
            update={input => actions.update.mutate(input)}
            triage={id => actions.triage.mutate(id)}
            startThread={props.startThread}
          >
            <div className="dshx:flex dshx:flex-col dshx:gap-3">
              <TitleField id={item.id} title={item.title} />
              <div className="dshx:-ml-1.5 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
                <ItemPickers.Status id={item.id} status={item.status} withLabel onPick={status => actions.update.mutate({ id: item.id, status })} />
                <ItemPickers.Kind id={item.id} kind={item.kind} onPick={kind => actions.update.mutate({ id: item.id, kind })} />
                <ItemPickers.Project
                  id={item.id}
                  project={item.project}
                  projects={props.projectPaths}
                  onPick={project => actions.update.mutate({ id: item.id, project })}
                />
                <ItemPickers.Attention
                  id={item.id}
                  attention={item.attention ?? 'none'}
                  onPick={attention => actions.update.mutate({ id: item.id, attention })}
                />
                <span className="dshx:ml-1">
                  <ItemGlyphs.ActorStack actorIds={item.actors.map(actor => actor.id)} />
                </span>
              </div>
              <TagsField id={item.id} tags={item.tags} />
            </div>
          </BacklogItemMenu>
          {running.length === 0 ? null : (
            <section
              aria-label="Execution"
              className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:rounded-xl dshx:border dshx:border-info/30 dshx:bg-info/5 dshx:p-3"
            >
              {running.map(thread => (
                <div key={thread.id} className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
                  <span aria-hidden className="dshx:size-1.5 dshx:animate-pulse dshx:rounded-full dshx:bg-info" />
                  <span className="dshx:text-muted-foreground">Running in</span>
                  <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{thread.title}</span>
                  <Button size="xs" variant="ghost" className="dshx:ml-auto" onClick={() => props.openThread(thread.id)}>
                    Open thread
                  </Button>
                </div>
              ))}
            </section>
          )}
          {item.proposal === undefined || item.proposal === null ? null : <ProposalCard id={item.id} proposal={item.proposal} />}
          <div className="dshx:flex dshx:flex-col dshx:gap-2">
            {props.loading ? null : <ItemFiles itemId={item.id} attachments={item.attachments} />}
            {props.loading ? (
              <BacklogText
                text={item.body}
                className="dshx:line-clamp-3 dshx:text-[13px] dshx:leading-relaxed dshx:text-muted-foreground dshx:[&>div]:line-clamp-3"
              />
            ) : (
              <BodyField id={item.id} body={item.body} />
            )}
            {showCapture ? (
              <details className="dshx:group/capture dshx:text-xs">
                <summary className="dshx:flex dshx:cursor-pointer dshx:list-none dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground dshx:hover:text-foreground">
                  <QuoteIcon aria-hidden className="dshx:size-3" /> Original capture
                  <ChevronRightIcon className="dshx:size-3 dshx:transition-transform dshx:group-open/capture:rotate-90" />
                </summary>
                <p className="dshx:mt-1.5 dshx:whitespace-pre-wrap dshx:rounded-r-lg dshx:border-l-2 dshx:border-border dshx:bg-muted/40 dshx:px-3 dshx:py-2 dshx:text-[13px] dshx:text-muted-foreground">
                  {captured}
                </p>
              </details>
            ) : null}
          </div>
          <Section title="Relationships" action={<AddLink id={item.id} />}>
            {groups.length === 0 && props.detail.backlinks.length === 0 ? (
              <p className="dshx:text-xs dshx:text-muted-foreground">
                Nothing linked yet. Threads that mention b:{item.id} and revisions that close it link themselves.
              </p>
            ) : null}
            {groups.map(group => (
              <div key={group.relation} className="dshx:flex dshx:flex-col dshx:gap-0.5">
                <span className="dshx:text-[11px] dshx:text-muted-foreground">{relationLabels[group.relation]}</span>
                <ul aria-label={relationLabels[group.relation]} className="dshx:flex dshx:flex-col">
                  {group.links.map(link => (
                    <LinkRow
                      key={`${link.type}:${link.target}`}
                      itemId={item.id}
                      link={link}
                      thread={link.type === 'thread' ? props.threads.find(thread => thread.id === link.target) : undefined}
                      openThread={props.openThread}
                      select={props.select}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {props.detail.backlinks.length === 0 ? null : (
              <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
                <span className="dshx:text-[11px] dshx:text-muted-foreground">Referenced by</span>
                <ul aria-label="Referenced by" className="dshx:flex dshx:flex-col">
                  {props.detail.backlinks.map(backlink => (
                    <BacklogItemMenu
                      key={backlink.id}
                      item={backlink}
                      projectPaths={props.projectPaths}
                      update={input => actions.update.mutate(input)}
                      triage={id => actions.triage.mutate(id)}
                      startThread={props.startThread}
                      openItem={props.select}
                    >
                      <li>
                        <button
                          type="button"
                          onClick={() => props.select(backlink.id)}
                          className="dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-left dshx:text-[13px] dshx:transition-colors dshx:hover:bg-accent/50"
                        >
                          <ItemGlyphs.StatusIcon status={backlink.status} />
                          <span className="dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">b:{backlink.id}</span>
                          <span className="dshx:min-w-0 dshx:truncate">{backlink.title}</span>
                        </button>
                      </li>
                    </BacklogItemMenu>
                  ))}
                </ul>
              </div>
            )}
          </Section>
          <Section title="Activity">
            <Conversation events={item.events} attention={item.attention ?? 'none'} />
            <CommentBox item={{ id: item.id, title: item.title, project: item.project, preview: item.body.slice(0, 500) }} />
          </Section>
        </div>
      </div>
    </>
  )
}

/** The selected item, editable in place: a side panel beside the list, or the whole panel when expanded. */
const ItemPeek = (props: {
  readonly id: number
  readonly threads: readonly ComposerThread[]
  readonly summary: BacklogSummaryView | undefined
  readonly expanded: boolean
  readonly toggleExpanded: () => void
  readonly openThread: OpenThread
  readonly select: (id: number) => void
  readonly close: () => void
  readonly embedded?: boolean
  readonly startThread: (item: StartThreadItem) => void
  readonly projectPaths: readonly string[]
}): JSX.Element => {
  const api = useApi(backlogApi)
  const summary = props.summary
  // The list row already holds most of the item, so the inspector opens filled and the full detail swaps in.
  const placeholder =
    summary === undefined
      ? undefined
      : { ok: true as const, value: { item: { ...summary, body: summary.preview, humanFields: [], events: [] }, backlinks: [] } }
  const detail = useQuery({
    queryKey: [BacklogQueries.key, 'item', props.id],
    queryFn: async ({ signal }) => BacklogViews.detailResult(await api.get({ id: props.id }, { signal })),
    placeholderData: () => placeholder,
  })
  return (
    <aside
      aria-label="Item detail"
      className={cn(
        'dshx:flex dshx:min-h-0 dshx:flex-col dshx:bg-background',
        props.expanded || props.embedded === true
          ? 'dshx:min-w-0 dshx:flex-1'
          : 'dshx:w-[460px] dshx:max-w-[55%] dshx:shrink-0 dshx:border-l dshx:border-border dshx:animate-in dshx:fade-in-0 dshx:slide-in-from-right-2 dshx:duration-150 dshx:@max-pane-compact:absolute dshx:@max-pane-compact:inset-0 dshx:@max-pane-compact:z-20 dshx:@max-pane-compact:w-auto dshx:@max-pane-compact:max-w-none dshx:@max-pane-compact:border-l-0',
      )}
    >
      {detail.data === undefined ? null : detail.data.ok ? (
        <PeekBody
          detail={detail.data.value}
          threads={props.threads}
          loading={detail.isPlaceholderData}
          expanded={props.expanded}
          toggleExpanded={props.toggleExpanded}
          openThread={props.openThread}
          select={props.select}
          close={props.close}
          startThread={props.startThread}
          projectPaths={props.projectPaths}
        />
      ) : (
        <p className="dshx:p-6 dshx:text-sm dshx:text-muted-foreground">b:{props.id} does not exist.</p>
      )}
    </aside>
  )
}

export class BacklogPeek {
  static readonly Panel = ItemPeek
}
