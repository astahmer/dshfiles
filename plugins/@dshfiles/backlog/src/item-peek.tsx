import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import {
  AlarmClockIcon,
  ArrowRightLeftIcon,
  ChevronRightIcon,
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
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { BacklogActivityReferences } from './activity-thread-reference.js'
import { useAgentDispatch } from './agent-dispatch-context.js'
import { backlogApi, BacklogViews, type BacklogDetailView, type BacklogSummaryView } from './api.js'
import { useComposerFiles } from './composer-attachments.js'
import { fileInput, type ComposerFile } from './composer-files.js'
import type { ComposerThread } from './composer.js'
import { BacklogItems, type BacklogAttention, type BacklogEvent, type BacklogLink, type BacklogProposal, type BacklogRelation } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { AttachmentMedia, ItemFiles } from './item-files.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import { BacklogText } from './item-text.js'
import { ItemPickers } from './item-pickers.js'
import { startThreadItemOf, type StartThreadItem } from './start-thread.js'
import { BacklogTextBox } from './text-box.js'
import { actorThreadFor } from './actor-thread.js'
import { BacklogTriage } from './triage.js'
import { BacklogQueries, useBacklogActions } from './use-backlog-actions.js'

type OpenThread = (sessionId: string) => void
type ThreadLabel = (sessionId: string) => string

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

const shortSessionId = (sessionId: string): string => sessionId.replace(/^session-/, '').slice(0, 8)

const linkLabel = (link: BacklogLink): string => {
  if (link.type === 'item') return `b:${link.target}`
  if (link.type === 'thread') return `Thread ${shortSessionId(link.target)}`
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
  const pickerTrigger = 'dshx:h-7 dshx:w-auto dshx:text-xs'
  const relationOptions: readonly ComboboxOption[] = BacklogItems.relations.map(value => ({ value, label: relationLabels[value] }))
  const linkTypeOptions: readonly ComboboxOption[] = BacklogItems.linkTypes.map(value => ({ value, label: value }))
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
            <Combobox
              contentClassName="dshx:w-44"
              label="Relation"
              onValueChange={value => setRelation(relationOf(value) ?? 'related')}
              options={relationOptions}
              triggerClassName={pickerTrigger}
              value={relation}
            />
            <Combobox
              contentClassName="dshx:w-44"
              label="Link type"
              onValueChange={value => setType(linkTypeOf(value) ?? 'url')}
              options={linkTypeOptions}
              triggerClassName={pickerTrigger}
              value={type}
            />
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

const BodyField = (props: {
  readonly id: number
  readonly body: string
  readonly threads: readonly ComposerThread[]
  readonly projects: readonly string[]
}): JSX.Element => {
  const actions = useBacklogActions()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(props.body)
  const [failed, setFailed] = useState<string | null>(null)
  const saved = useRef(false)
  const attachments = useComposerFiles({ onError: setFailed })
  useEffect(() => {
    if (!editing) setBody(props.body)
  }, [props.body, editing])
  useEffect(() => {
    if (editing) saved.current = false
  }, [editing])
  const save = async (): Promise<void> => {
    if (saved.current) return
    saved.current = true
    setEditing(false)
    setFailed(null)
    const pending = [...attachments.files]
    attachments.clear()
    if (body !== props.body) actions.update.mutate({ id: props.id, body })
    for (const file of pending) {
      try {
        await actions.attachFile.mutateAsync({ id: props.id, file: fileInput(file) })
      } catch (error) {
        setFailed(errorMessage(error, 'That attachment could not be saved.'))
        return
      }
    }
  }
  const cancel = (): void => {
    saved.current = true
    setBody(props.body)
    attachments.clear()
    setFailed(null)
    setEditing(false)
  }
  if (editing)
    return (
      <div className="dshx:flex dshx:flex-col dshx:gap-1">
        <BacklogTextBox
          ariaLabel="Body"
          placeholder="Add a description… Markdown, b:12 and jj:rev add links; @ mentions items, threads, projects and agents; paste or drop an image."
          value={body}
          onChange={setBody}
          threads={props.threads}
          projects={props.projects}
          attachments={attachments}
          variant="body"
          autoFocus
          onBlur={() => void save()}
          onCancel={cancel}
          onSubmit={() => void save()}
        />
        {failed === null ? null : (
          <p role="alert" className="dshx:text-[11px] dshx:text-destructive">
            {failed}
          </p>
        )}
      </div>
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

const ActivityDescription = (props: {
  readonly event: BacklogEvent
  readonly attention: BacklogAttention
  readonly threadId: string | undefined
  readonly threadLabel: ThreadLabel
  readonly openThread: OpenThread
}): JSX.Element => {
  const description = ItemGlyphs.describeEvent(props.event, props.attention)
  const threadId = props.threadId
  if (threadId === undefined) return <>{description}</>
  const reference = BacklogActivityReferences.threadReferenceRange(description, threadId)
  if (reference === undefined) return <>{description}</>
  const label = props.threadLabel(threadId)
  const text = reference.text.startsWith('thread:')
    ? `the thread “${label}”`
    : `${reference.text.toLowerCase().startsWith('a ') ? 'a' : 'the'} thread “${label}”`
  return (
    <>
      {description.slice(0, reference.start)}
      <button
        type="button"
        aria-label={`Open thread ${label}`}
        title={`Open thread ${label}`}
        className="dshx:inline dshx:appearance-none dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:font-medium dshx:text-info dshx:underline dshx:underline-offset-2 dshx:hover:text-foreground"
        onClick={() => props.openThread(threadId)}
      >
        {text}
      </button>
      {description.slice(reference.end)}
    </>
  )
}

/** Comments read as messages; every other event folds into one "made N changes" line per actor run, opened on demand. */
const Conversation = (props: {
  readonly events: readonly BacklogEvent[]
  readonly links: readonly BacklogLink[]
  readonly attention: BacklogAttention
  readonly itemId: number
  readonly threadLabel: ThreadLabel
  readonly openThread: OpenThread
}): JSX.Element => {
  const attention = props.attention
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const threadIdsByEvent = new Map<BacklogEvent, string>()
  for (const [eventIndex, event] of props.events.entries()) {
    const threadId = BacklogActivityReferences.threadIdOf({ event, eventIndex, events: props.events, links: props.links })
    if (threadId !== undefined) threadIdsByEvent.set(event, threadId)
  }
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
                <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2 dshx:text-[13px]">
                  <MarkdownText text={run.event.detail} labels={markdownLabels} variant="compact" />
                  <AttachmentMedia itemId={props.itemId} attachments={run.event.attachments ?? []} />
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
                run.events.map((event, position) => {
                  const threadId = threadIdsByEvent.get(event)
                  return (
                    <p key={String(position)}>
                      <span className="dshx:font-medium dshx:text-foreground">{ItemGlyphs.actorName(event.actor)}</span>{' '}
                      <ActivityDescription
                        event={event}
                        attention={attention}
                        threadId={threadId}
                        threadLabel={props.threadLabel}
                        openThread={props.openThread}
                      />{' '}
                      · {ItemGlyphs.ago(event.at)}
                    </p>
                  )
                })
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

const CommentBox = (props: {
  readonly item: StartThreadItem
  readonly threads: readonly ComposerThread[]
  readonly projects: readonly string[]
  readonly openCreatedByDefault: boolean
}): JSX.Element => {
  const actions = useBacklogActions()
  const dispatch = useAgentDispatch()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const attachments = useComposerFiles({ onError: setFailed })

  const comment = (files: readonly ComposerFile[]): void => {
    const payload = files.map(fileInput)
    setText('')
    attachments.clear()
    const request = payload.length === 0 ? { id: props.item.id, text } : { id: props.item.id, text, files: payload }
    actions.comment.mutate(request, {
      onError: error => {
        setText(current => (current === '' ? text : current))
        attachments.restore(files)
        setFailed(errorMessage(error, 'The reply was not saved.'))
      },
    })
  }
  /** A leading `@handle` starts that agent's thread; anything else, or a handle nothing matches, stays a comment. */
  const submit = async (): Promise<void> => {
    const files = [...attachments.files]
    if ((text.trim() === '' && files.length === 0) || pending) return
    if (dispatch === null || text.trim() === '') {
      comment(files)
      return
    }
    setPending(true)
    setFailed(null)
    try {
      setText('')
      attachments.clear()
      const outcome = await dispatch.dispatch({ item: props.item, text, files: files.map(fileInput), open: props.openCreatedByDefault })
      if (outcome.kind === 'failed') {
        setText(current => (current === '' ? text : current))
        attachments.restore(files)
        setFailed(outcome.reason)
      } else comment(files)
    } catch (error) {
      setText(current => (current === '' ? text : current))
      attachments.restore(files)
      setFailed(errorMessage(error, 'The reply was not sent.'))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-1">
      <BacklogTextBox
        ariaLabel="Comment"
        placeholder="Reply… Markdown, b:12, jj:rev, @ items, threads, projects and agents; paste or drop an image"
        value={text}
        onChange={setText}
        threads={props.threads}
        projects={props.projects}
        attachments={attachments}
        variant="reply"
        submitLabel="Reply"
        submitDisabled={text.trim() === '' && attachments.files.length === 0}
        pending={pending}
        onSubmit={() => void submit()}
      />
      {failed === null ? null : (
        <p role="alert" className="dshx:text-[11px] dshx:text-destructive">
          {failed}
        </p>
      )}
    </div>
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
  readonly threadLabel: string
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
          {link.type === 'thread' ? props.threadLabel : linkLabel(link)}
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

const AgentThreadChip = (props: {
  readonly actorId: string
  readonly threads: readonly ComposerThread[]
  readonly agentForThread: (sessionId: string) => Promise<{ readonly name: string } | null>
  readonly openThread: OpenThread
}): JSX.Element => {
  const thread = actorThreadFor(props.actorId, props.threads)
  const sessionId = props.actorId.slice('agent:'.length)
  const agentQuery = useQuery({
    queryKey: ['dshfiles-backlog', 'agent-thread', sessionId],
    queryFn: () => props.agentForThread(sessionId),
    enabled: props.actorId.startsWith('agent:'),
    staleTime: 30_000,
    retry: false,
  })
  if (!props.actorId.startsWith('agent:')) return <ItemGlyphs.ActorAvatar actorId={props.actorId} />
  const name = agentQuery.data?.name ?? ItemGlyphs.actorName(props.actorId)
  if (thread === undefined) {
    return (
      <span title={name} className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:rounded-md dshx:border dshx:px-1.5 dshx:py-1 dshx:text-xs">
        <ItemGlyphs.ActorAvatar actorId={props.actorId} className="dshx:size-4 dshx:ring-0" />
        {name}
      </span>
    )
  }
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      title={`${name} · ${thread.title}`}
      aria-label={`Open ${name}'s thread: ${thread.title}`}
      onClick={() => props.openThread(thread.id)}
      className="dshx:h-7 dshx:max-w-48 dshx:gap-1.5 dshx:px-1.5"
    >
      <ItemGlyphs.ActorAvatar actorId={props.actorId} className="dshx:size-4 dshx:ring-0" />
      <span className="dshx:truncate">{agentQuery.data === null ? thread.title : name}</span>
    </Button>
  )
}

const PeekBody = (props: {
  readonly detail: BacklogDetailView
  readonly threads: readonly ComposerThread[]
  readonly loading: boolean
  readonly expanded: boolean
  readonly toggleExpanded: () => void
  readonly openThread: OpenThread
  readonly agentForThread: (sessionId: string) => Promise<{ readonly name: string } | null>
  readonly select: (id: number) => void
  readonly close: () => void
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly openCreatedByDefault: boolean
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
  const relationshipLinks = BacklogItems.uniqueLinks(item.links)
  const threadsById = new Map(props.threads.map(thread => [thread.id, thread]))
  const threadTitleCounts = new Map<string, number>()
  for (const link of relationshipLinks) {
    if (link.type !== 'thread') continue
    const title = threadsById.get(link.target)?.title
    if (title !== undefined) threadTitleCounts.set(title, (threadTitleCounts.get(title) ?? 0) + 1)
  }
  const threadLabel: ThreadLabel = sessionId => {
    const thread = threadsById.get(sessionId)
    return BacklogActivityReferences.threadLabelOf({
      title: thread?.title,
      sessionId,
      duplicateTitle: thread !== undefined && (threadTitleCounts.get(thread.title) ?? 0) > 1,
    })
  }
  const running = props.threads.filter(thread => thread.running && relationshipLinks.some(link => link.type === 'thread' && link.target === thread.id))
  const groups = BacklogItems.relations
    .map(relation => ({ relation, links: relationshipLinks.filter(link => (link.relation ?? 'related') === relation) }))
    .filter(group => group.links.length > 0)
  return (
    <>
      <header className="dshx:flex dshx:h-11 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4">
        <nav aria-label="Breadcrumb" className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
          {item.project === null ? null : (
            <>
              <ItemGlyphs.ProjectLabel project={item.project} />
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
            onClick={() => props.startThread([startThreadItemOf({ id: item.id, title: item.title, project: item.project, preview: item.body })])}
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
                <span className="dshx:ml-1 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
                  {item.actors.map(actor => (
                    <AgentThreadChip
                      key={actor.id}
                      actorId={actor.id}
                      threads={props.threads}
                      agentForThread={props.agentForThread}
                      openThread={props.openThread}
                    />
                  ))}
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
              <BodyField id={item.id} body={item.body} threads={props.threads} projects={props.projectPaths} />
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
                      thread={link.type === 'thread' ? threadsById.get(link.target) : undefined}
                      threadLabel={link.type === 'thread' ? threadLabel(link.target) : linkLabel(link)}
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
            <Conversation
              events={item.events}
              links={relationshipLinks}
              attention={item.attention ?? 'none'}
              itemId={item.id}
              threadLabel={threadLabel}
              openThread={props.openThread}
            />
            <CommentBox
              item={{ id: item.id, title: item.title, project: item.project, preview: item.body.slice(0, 500) }}
              threads={props.threads}
              projects={props.projectPaths}
              openCreatedByDefault={props.openCreatedByDefault}
            />
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
  readonly agentForThread: (sessionId: string) => Promise<{ readonly name: string } | null>
  readonly select: (id: number) => void
  readonly close: () => void
  readonly embedded?: boolean
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly openCreatedByDefault: boolean
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
          agentForThread={props.agentForThread}
          select={props.select}
          close={props.close}
          startThread={props.startThread}
          openCreatedByDefault={props.openCreatedByDefault}
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
