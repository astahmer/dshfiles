import { MarkdownText, relativeTime, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import {
  ArrowRightLeftIcon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  FolderIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  HashIcon,
  LinkIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SparklesIcon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { backlogApi, type BacklogDetailView, type BacklogSummaryView } from './api.js'
import { BacklogItems, type BacklogEvent, type BacklogLink, type BacklogProposal } from './item.js'
import { BacklogTriage } from './triage.js'
import { ItemGlyphs } from './item-glyphs.js'
import { ItemPickers } from './item-pickers.js'
import { BacklogQueries, useBacklogActions } from './use-backlog-actions.js'

type OpenThread = (sessionId: string) => void

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
const AGO_SUFFIX = { minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const
const ago = (time: number): string => {
  const age = relativeTime(time, Date.now())
  return age.unit === 'now' ? 'just now' : `${String(age.n)}${AGO_SUFFIX[age.unit]} ago`
}
const projectName = (project: string): string => project.split('/').filter(Boolean).at(-1) ?? project
const actorName = (id: string): string => (id === 'user' ? 'You' : id === 'system' ? 'System' : `Agent ${id.replace(/^agent:(session-)?/, '').slice(0, 8)}`)

const linkIcons = {
  item: HashIcon,
  thread: MessagesSquareIcon,
  revision: GitCommitHorizontalIcon,
  branch: GitBranchIcon,
  workspace: FolderIcon,
  url: ExternalLinkIcon,
} satisfies Record<BacklogLink['type'], LucideIcon>

const linkLabel = (link: BacklogLink): string => {
  if (link.type === 'item') return `b:${link.target}`
  if (link.type === 'thread') return `Thread ${link.target.replace(/^session-/, '').slice(0, 8)}`
  if (link.type === 'revision') return `jj:${link.target}`
  if (link.type === 'url') return link.target.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return link.target
}

const linkTypeOf = (value: string): BacklogLink['type'] | undefined => BacklogItems.linkTypes.find(type => type === value)

const eventIcons = {
  created: SparklesIcon,
  edited: PencilIcon,
  moved: ArrowRightLeftIcon,
  linked: LinkIcon,
  unlinked: LinkIcon,
  commented: MessageSquareIcon,
  triaged: WandSparklesIcon,
} satisfies Record<BacklogEvent['kind'], LucideIcon>

const eventSentence = (event: BacklogEvent): string => {
  if (event.kind === 'created') return 'created the item'
  if (event.kind === 'moved') return `moved it ${event.detail}`
  if (event.kind === 'edited') return `edited ${event.detail}`
  if (event.kind === 'linked') return `linked ${event.detail}`
  if (event.kind === 'unlinked') return `unlinked ${event.detail}`
  if (event.kind === 'triaged')
    return event.actor === 'system' ? `triage ${event.detail}` : `${event.detail.split(' ')[0] ?? ''} triage: ${event.detail.split(' ').slice(1).join(' ')}`
  return 'commented'
}

const Property = (props: { readonly label: string; readonly children: ReactNode }): JSX.Element => (
  <div className="dshx:grid dshx:grid-cols-[88px_minmax(0,1fr)] dshx:items-center dshx:gap-2 dshx:text-[13px]">
    <span className="dshx:text-muted-foreground">{props.label}</span>
    <div className="dshx:flex dshx:min-w-0 dshx:items-center">{props.children}</div>
  </div>
)

const SectionTitle = (props: { readonly children: ReactNode; readonly action?: ReactNode }): JSX.Element => (
  <div className="dshx:flex dshx:items-center dshx:justify-between">
    <h4 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.children}</h4>
    {props.action}
  </div>
)

const AddLink = (props: { readonly id: number }): JSX.Element => {
  const actions = useBacklogActions()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<BacklogLink['type']>('url')
  const [target, setTarget] = useState('')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Add link">
          <PlusIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="dshx-root dshx:w-80 dshx:p-2">
        <form
          className="dshx:flex dshx:items-center dshx:gap-1.5"
          onSubmit={event => {
            event.preventDefault()
            if (target.trim() === '') return
            actions.link.mutate({ id: props.id, link: { type, target: target.trim() } }, { onSuccess: () => setTarget('') })
            setOpen(false)
          }}
        >
          <select
            aria-label="Link type"
            className="dshx:h-7 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-1.5 dshx:text-xs dshx:text-foreground"
            value={type}
            onChange={event => setType(linkTypeOf(event.currentTarget.value) ?? 'url')}
          >
            {BacklogItems.linkTypes.map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <input
            aria-label="Link target"
            autoFocus
            placeholder="URL, session id, revision, branch, b:…"
            className="dshx:h-7 dshx:min-w-0 dshx:flex-1 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-xs dshx:outline-none dshx:focus-visible:border-ring"
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
  useEffect(() => setTitle(props.title), [props.title])
  const save = (): void => {
    if (title.trim() !== '' && title !== props.title) actions.update.mutate({ id: props.id, title })
  }
  return (
    <textarea
      aria-label="Title"
      rows={1}
      value={title}
      onChange={event => setTitle(event.currentTarget.value.replace(/\n/g, ''))}
      onBlur={save}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') setTitle(props.title)
      }}
      className="dshx:field-sizing-content dshx:w-full dshx:resize-none dshx:bg-transparent dshx:text-lg dshx:font-semibold dshx:leading-snug dshx:tracking-tight dshx:text-foreground dshx:outline-none"
    />
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
        placeholder="Add a description… Markdown, b:12, jj:rev and URLs become links."
        onChange={event => setBody(event.currentTarget.value)}
        onBlur={save}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save()
          if (event.key === 'Escape') {
            setBody(props.body)
            setEditing(false)
          }
        }}
        className="dshx:field-sizing-content dshx:min-h-24 dshx:w-full dshx:resize-none dshx:rounded-md dshx:bg-transparent dshx:text-[13px] dshx:leading-relaxed dshx:text-foreground dshx:outline-none"
      />
    )
  return (
    <button
      type="button"
      aria-label="Edit description"
      onClick={() => setEditing(true)}
      className="dshx:-mx-2 dshx:rounded-md dshx:px-2 dshx:py-1 dshx:text-left dshx:text-[13px] dshx:leading-relaxed dshx:transition-colors dshx:hover:bg-accent/50"
    >
      {props.body === '' ? (
        <span className="dshx:text-muted-foreground">Add a description…</span>
      ) : (
        <MarkdownText text={props.body} labels={markdownLabels} variant="compact" />
      )}
    </button>
  )
}

const TagsField = (props: { readonly id: number; readonly tags: readonly string[] }): JSX.Element => {
  const actions = useBacklogActions()
  const [draft, setDraft] = useState('')
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1">
      {props.tags.map(tag => (
        <span
          key={tag}
          className="dshx:group/tag dshx:inline-flex dshx:h-5 dshx:items-center dshx:gap-0.5 dshx:rounded-full dshx:border dshx:border-border dshx:pl-2 dshx:pr-1 dshx:text-[11px] dshx:text-muted-foreground"
        >
          #{tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            className="dshx:rounded-full dshx:opacity-0 dshx:transition-opacity dshx:group-hover/tag:opacity-100 dshx:hover:text-foreground"
            onClick={() => actions.update.mutate({ id: props.id, tags: props.tags.filter(other => other !== tag) })}
          >
            <XIcon className="dshx:size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label="Add tag"
        placeholder={props.tags.length === 0 ? 'Add tag' : '+'}
        value={draft}
        onChange={event => setDraft(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || draft.trim() === '') return
          actions.update.mutate({ id: props.id, tags: [...props.tags, draft.trim()] })
          setDraft('')
        }}
        className="dshx:h-5 dshx:w-16 dshx:bg-transparent dshx:text-[12px] dshx:outline-none dshx:placeholder:text-muted-foreground"
      />
    </div>
  )
}

const CommentBox = (props: { readonly id: number }): JSX.Element => {
  const actions = useBacklogActions()
  const [text, setText] = useState('')
  const submit = (): void => {
    if (text.trim() === '' || actions.comment.isPending) return
    actions.comment.mutate({ id: props.id, text }, { onSuccess: () => setText('') })
  }
  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        submit()
      }}
      className="dshx:flex dshx:items-end dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-2 dshx:transition-colors dshx:focus-within:border-input"
    >
      <textarea
        aria-label="Comment"
        rows={1}
        placeholder="Leave a comment…"
        value={text}
        onChange={event => setText(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
        }}
        className="dshx:field-sizing-content dshx:max-h-40 dshx:min-h-6 dshx:flex-1 dshx:resize-none dshx:bg-transparent dshx:text-[13px] dshx:outline-none dshx:placeholder:text-muted-foreground"
      />
      <Button type="submit" size="icon-xs" variant="ghost" aria-label="Send comment" disabled={text.trim() === ''}>
        <CornerDownLeftIcon />
      </Button>
    </form>
  )
}

const Activity = (props: { readonly events: readonly BacklogEvent[] }): JSX.Element => (
  <ol aria-label="Activity" className="dshx:relative dshx:flex dshx:flex-col dshx:gap-3">
    <span aria-hidden className="dshx:absolute dshx:inset-y-1 dshx:left-[9px] dshx:w-px dshx:bg-border" />
    {props.events.map(event => {
      const Icon = eventIcons[event.kind]
      return (
        <li key={`${String(event.at)}:${event.kind}:${event.detail.slice(0, 24)}`} className="dshx:relative dshx:flex dshx:gap-2.5">
          <span className="dshx:z-10 dshx:inline-flex dshx:size-[19px] dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:border dshx:border-border dshx:bg-background">
            <Icon aria-hidden className="dshx:size-2.5 dshx:text-muted-foreground" />
          </span>
          <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1 dshx:pt-px">
            <p className="dshx:text-xs dshx:text-muted-foreground">
              <span className="dshx:font-medium dshx:text-foreground">{actorName(event.actor)}</span> {eventSentence(event)} · {ago(event.at)}
            </p>
            {event.kind === 'commented' ? (
              <div className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2 dshx:text-[13px]">
                <MarkdownText text={event.detail} labels={markdownLabels} variant="compact" />
              </div>
            ) : null}
          </div>
        </li>
      )
    })}
  </ol>
)

/** Triage's suggestion, shown until accepted or dismissed: each change as before → after, with its confidence. */
const ProposalCard = (props: { readonly id: number; readonly proposal: BacklogProposal; readonly current: BacklogDetailView['item'] }): JSX.Element => {
  const actions = useBacklogActions()
  const proposal = props.proposal
  const rows = [
    proposal.kind === undefined
      ? null
      : {
          label: 'Kind',
          before: <ItemGlyphs.KindIcon kind={props.current.kind} />,
          after: (
            <>
              <ItemGlyphs.KindIcon kind={proposal.kind} />
              {ItemGlyphs.kindLabels[proposal.kind]}
            </>
          ),
        },
    proposal.status === undefined
      ? null
      : {
          label: 'Status',
          before: <ItemGlyphs.StatusIcon status={props.current.status} />,
          after: (
            <>
              <ItemGlyphs.StatusIcon status={proposal.status} />
              {ItemGlyphs.statusLabels[proposal.status]}
            </>
          ),
        },
    proposal.title === undefined ? null : { label: 'Title', before: null, after: <span className="dshx:truncate">{proposal.title}</span> },
    proposal.tags === undefined
      ? null
      : { label: 'Tags', before: null, after: <span className="dshx:truncate">{proposal.tags.map(tag => `#${tag}`).join(' ')}</span> },
    proposal.duplicateOf === undefined ? null : { label: 'Duplicate', before: null, after: <span>of b:{proposal.duplicateOf}</span> },
  ].filter(row => row !== null)
  return (
    <section
      aria-label="Triage suggestion"
      className="dshx:flex dshx:flex-col dshx:gap-2.5 dshx:rounded-lg dshx:border dshx:border-violet/30 dshx:bg-violet/5 dshx:p-3 dshx:animate-in dshx:fade-in-0"
    >
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
        <WandSparklesIcon aria-hidden className="dshx:size-3.5 dshx:text-violet" />
        <span className="dshx:font-medium">Triage suggests</span>
        <span className="dshx:text-muted-foreground">
          {Math.round(proposal.confidence * 100)}% · {proposal.source}
        </span>
      </div>
      <ul className="dshx:flex dshx:flex-col dshx:gap-1">
        {rows.map(row => (
          <li key={row.label} className="dshx:grid dshx:grid-cols-[72px_minmax(0,1fr)] dshx:items-center dshx:gap-2 dshx:text-[13px]">
            <span className="dshx:text-muted-foreground">{row.label}</span>
            <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
              {row.before === null ? null : (
                <>
                  <span className="dshx:opacity-50">{row.before}</span>
                  <span className="dshx:text-muted-foreground">→</span>
                </>
              )}
              {row.after}
            </span>
          </li>
        ))}
      </ul>
      {proposal.reason === '' ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{proposal.reason}</p>}
      <div className="dshx:flex dshx:items-center dshx:gap-1.5">
        <Button size="xs" onClick={() => actions.applyProposal.mutate(props.id)} disabled={actions.applyProposal.isPending}>
          Accept
        </Button>
        <Button size="xs" variant="ghost" onClick={() => actions.dismissProposal.mutate(props.id)} disabled={actions.dismissProposal.isPending}>
          Dismiss
        </Button>
        <span className="dshx:ml-auto dshx:text-[11px] dshx:text-muted-foreground" title={BacklogTriage.describe(proposal)}>
          {ago(proposal.at)}
        </span>
      </div>
    </section>
  )
}

const PeekBody = (props: {
  readonly detail: BacklogDetailView
  readonly loading: boolean
  readonly openThread: OpenThread
  readonly select: (id: number) => void
  readonly close: () => void
}): JSX.Element => {
  const actions = useBacklogActions()
  const item = props.detail.item
  const scroller = useRef<HTMLDivElement | null>(null)
  useEffect(() => scroller.current?.scrollTo({ top: 0 }), [item.id])
  return (
    <>
      <header className="dshx:flex dshx:h-11 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4">
        <span className="dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">b:{item.id}</span>
        {item.freshness === 'fresh' ? null : (
          <span
            className={cn(
              'dshx:rounded-full dshx:px-1.5 dshx:text-[11px]',
              item.freshness === 'stale' ? 'dshx:bg-warning/15 dshx:text-warning' : 'dshx:bg-muted dshx:text-muted-foreground',
            )}
          >
            {item.freshness}
          </span>
        )}
        <div className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1">
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
          <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={props.close}>
            <XIcon />
          </Button>
        </div>
      </header>
      <div ref={scroller} className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-5 dshx:overflow-y-auto dshx:px-5 dshx:py-4">
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <TitleField id={item.id} title={item.title} />
          {props.loading ? (
            <p className="dshx:line-clamp-3 dshx:text-[13px] dshx:leading-relaxed dshx:text-muted-foreground">{item.body}</p>
          ) : (
            <BodyField id={item.id} body={item.body} />
          )}
        </div>
        {item.proposal === undefined || item.proposal === null ? null : <ProposalCard id={item.id} proposal={item.proposal} current={item} />}
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <Property label="Status">
            <ItemPickers.Status id={item.id} status={item.status} withLabel onPick={status => actions.update.mutate({ id: item.id, status })} />
          </Property>
          <Property label="Kind">
            <ItemPickers.Kind id={item.id} kind={item.kind} onPick={kind => actions.update.mutate({ id: item.id, kind })} />
          </Property>
          <Property label="Project">
            <span className="dshx:truncate dshx:px-2 dshx:text-[13px]" title={item.project ?? undefined}>
              {item.project === null ? <span className="dshx:text-muted-foreground">None</span> : projectName(item.project)}
            </span>
          </Property>
          <Property label="Tags">
            <div className="dshx:px-2">
              <TagsField id={item.id} tags={item.tags} />
            </div>
          </Property>
          <Property label="People">
            <div className="dshx:flex dshx:items-center dshx:gap-1 dshx:px-2">
              {item.actors.map(actor => (
                <ItemGlyphs.ActorAvatar key={actor.id} actorId={actor.id} />
              ))}
            </div>
          </Property>
        </div>
        <section className="dshx:flex dshx:flex-col dshx:gap-2">
          <SectionTitle action={<AddLink id={item.id} />}>Links</SectionTitle>
          {item.links.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">Nothing linked yet.</p> : null}
          <ul aria-label="Links" className="dshx:flex dshx:flex-col dshx:gap-0.5">
            {item.links.map(link => {
              const Icon = linkIcons[link.type]
              const open =
                link.type === 'thread'
                  ? () => props.openThread(link.target)
                  : link.type === 'item'
                    ? () => props.select(Number(link.target))
                    : link.type === 'url'
                      ? () => window.open(link.target, '_blank', 'noopener,noreferrer')
                      : undefined
              return (
                <li
                  key={`${link.type}:${link.target}`}
                  className="dshx:group/link dshx:flex dshx:h-7 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:hover:bg-accent/60"
                >
                  <Icon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
                  {open === undefined ? (
                    <span className="dshx:min-w-0 dshx:truncate dshx:font-mono! dshx:text-xs">{linkLabel(link)}</span>
                  ) : (
                    <button type="button" onClick={open} className="dshx:min-w-0 dshx:truncate dshx:text-left dshx:text-[13px] dshx:hover:underline">
                      {linkLabel(link)}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Unlink ${link.type} ${link.target}`}
                    className="dshx:ml-auto dshx:rounded dshx:text-muted-foreground dshx:opacity-0 dshx:transition-opacity dshx:group-hover/link:opacity-100 dshx:hover:text-foreground"
                    onClick={() => actions.link.mutate({ id: item.id, link, remove: true })}
                  >
                    <XIcon className="dshx:size-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
        {props.detail.backlinks.length === 0 ? null : (
          <section className="dshx:flex dshx:flex-col dshx:gap-2">
            <SectionTitle>Referenced by</SectionTitle>
            <ul aria-label="Referenced by" className="dshx:flex dshx:flex-col dshx:gap-0.5">
              {props.detail.backlinks.map(backlink => (
                <li key={backlink.id}>
                  <button
                    type="button"
                    onClick={() => props.select(backlink.id)}
                    className="dshx:flex dshx:h-7 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-left dshx:text-[13px] dshx:hover:bg-accent/60"
                  >
                    <ItemGlyphs.StatusIcon status={backlink.status} />
                    <span className="dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">b:{backlink.id}</span>
                    <span className="dshx:min-w-0 dshx:truncate">{backlink.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="dshx:flex dshx:flex-col dshx:gap-3">
          <SectionTitle>Activity</SectionTitle>
          <Activity events={item.events} />
          <CommentBox id={item.id} />
          <p className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-[11px] dshx:text-muted-foreground">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> to send · <Kbd>Esc</Kbd> to close
          </p>
        </section>
      </div>
    </>
  )
}

/** Linear's issue peek: the selected item beside the list, editable in place. */
const ItemPeek = (props: {
  readonly id: number
  readonly summary: BacklogSummaryView | undefined
  readonly openThread: OpenThread
  readonly select: (id: number) => void
  readonly close: () => void
}): JSX.Element => {
  const api = useApi(backlogApi)
  const summary = props.summary
  // The list row already holds most of the item, so the peek opens filled and the full detail swaps in.
  const placeholder =
    summary === undefined
      ? undefined
      : { ok: true as const, value: { item: { ...summary, body: summary.preview, humanFields: [], events: [] }, backlinks: [] } }
  const detail = useQuery({
    queryKey: [BacklogQueries.key, 'item', props.id],
    queryFn: ({ signal }) => api.get({ id: props.id }, { signal }),
    refetchInterval: 5_000,
    placeholderData: () => placeholder,
  })
  return (
    <aside
      aria-label="Item detail"
      className="dshx:flex dshx:min-h-0 dshx:w-[440px] dshx:max-w-[55%] dshx:shrink-0 dshx:flex-col dshx:border-l dshx:border-border dshx:bg-background dshx:animate-in dshx:fade-in-0 dshx:slide-in-from-right-4 dshx:duration-150 dshx:@max-pane-compact:absolute dshx:@max-pane-compact:inset-0 dshx:@max-pane-compact:z-20 dshx:@max-pane-compact:w-auto dshx:@max-pane-compact:max-w-none dshx:@max-pane-compact:border-l-0"
    >
      {detail.data === undefined ? null : detail.data.ok ? (
        <PeekBody detail={detail.data.value} loading={detail.isPlaceholderData} openThread={props.openThread} select={props.select} close={props.close} />
      ) : (
        <p className="dshx:p-6 dshx:text-sm dshx:text-muted-foreground">b:{props.id} does not exist.</p>
      )}
    </aside>
  )
}

export class BacklogPeek {
  static readonly Panel = ItemPeek
}
