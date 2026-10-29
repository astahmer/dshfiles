import { MarkdownText, type MarkdownLabels, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  AlarmClockIcon,
  ArrowRightLeftIcon,
  ChevronRightIcon,
  CopyIcon,
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
  MoreHorizontalIcon,
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
import { errorMessage, useQueries, useQuery } from '@dshfiles/plugin-ui/query'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { ActivityDescription } from './activity-description.js'
import { ActorThreadLink } from './actor-thread-link.js'
import { BacklogReferenceChip } from './backlog-reference-chip.js'
import { BacklogActivityReferences } from './activity-thread-reference.js'
import { useAgentDispatch } from './agent-dispatch-context.js'
import { backlogApi, BacklogViews, type BacklogDetailView, type BacklogSummaryView } from './api.js'
import { useComposerFiles } from './composer-attachments.js'
import { fileInput, type ComposerFile } from './composer-files.js'
import type { ComposerThread } from './composer.js'
import type { BacklogAttachment } from './item.js'
import { BacklogItems, type BacklogAttention, type BacklogEvent, type BacklogLink, type BacklogProposal, type BacklogRelation } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { AttachmentMedia, ItemFiles } from './item-files.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import { BacklogText } from './item-text.js'
import { markdownImageReferences } from './image-attachment-reference.js'
import { submitReply } from './reply-submission.js'
import { ItemPickers } from './item-pickers.js'
import { startThreadItemOf, type StartThreadItem } from './start-thread.js'
import { BacklogTextBox } from './text-box.js'
import { actorThreadFor } from './actor-thread.js'
import { BacklogTriage } from './triage.js'
import { workspaceReferenceLabel } from './workspace-reference-label.js'
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
  if (link.type === 'workspace') return workspaceReferenceLabel(link.target)
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
    const submittedBody = markdownImageReferences(body, pending)
    if (submittedBody !== props.body) actions.update.mutate({ id: props.id, body: submittedBody })
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

const ReplyEditor = (props: {
  readonly itemId: number
  readonly event: BacklogEvent
  readonly threads: readonly ComposerThread[]
  readonly projects: readonly string[]
  readonly onSave: (text: string, files: readonly ComposerFile[]) => Promise<void>
  readonly onCancel: () => void
}): JSX.Element => {
  const api = useApi(backlogApi)
  const attachments = props.event.attachments ?? []
  const reads = useQueries({
    queries: attachments.map(attachment => ({
      queryKey: ['dshfiles-backlog-file', props.itemId, attachment.id],
      queryFn: ({ signal }) => api.readFile({ id: props.itemId, attachmentId: attachment.id }, { signal }),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  const loading = reads.some(read => read.data === undefined && !read.isError)
  const failedRead = reads.some(read => read.isError || read.data?.ok === false)
  const initialFiles: ComposerFile[] = attachments.flatMap((attachment: BacklogAttachment, index) => {
    const read = reads[index]?.data
    if (read?.ok !== true) return []
    const file: ComposerFile = {
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      mediaType: attachment.mediaType,
      bytes: attachment.bytes,
      dataUrl: read.value.dataUrl,
    }
    if (attachment.width !== undefined && attachment.height !== undefined) {
      return [{ ...file, width: attachment.width, height: attachment.height }]
    }
    return [file]
  })
  if (loading)
    return (
      <p role="status" className="dshx:text-xs dshx:text-muted-foreground">
        Loading reply attachments…
      </p>
    )
  if (failedRead)
    return (
      <p role="alert" className="dshx:text-xs dshx:text-destructive">
        A reply attachment could not be loaded.
      </p>
    )
  return (
    <ReplyComposer event={props.event} files={initialFiles} threads={props.threads} projects={props.projects} onSave={props.onSave} onCancel={props.onCancel} />
  )
}

const ReplyComposer = (props: {
  readonly event: BacklogEvent
  readonly files: readonly ComposerFile[]
  readonly threads: readonly ComposerThread[]
  readonly projects: readonly string[]
  readonly onSave: (text: string, files: readonly ComposerFile[]) => Promise<void>
  readonly onCancel: () => void
}): JSX.Element => {
  const [text, setText] = useState(props.event.detail)
  const [failed, setFailed] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const attachments = useComposerFiles({ initial: props.files, onError: setFailed })
  const save = async (submittedText: string): Promise<void> => {
    if ((submittedText.trim() === '' && attachments.files.length === 0) || pending) return
    setPending(true)
    setFailed(null)
    try {
      await props.onSave(markdownImageReferences(submittedText, attachments.files), attachments.files)
    } catch (error) {
      setFailed(errorMessage(error, 'The reply could not be saved.'))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-1">
      <BacklogTextBox
        ariaLabel="Edit reply"
        placeholder="Reply… Markdown, b:12, jj:rev, @ items, threads, projects and agents; paste or drop an image"
        value={text}
        onChange={setText}
        threads={props.threads}
        projects={props.projects}
        attachments={attachments}
        variant="reply"
        submitLabel="Save reply"
        submitDisabled={text.trim() === '' && attachments.files.length === 0}
        pending={pending}
        onSubmit={submitted => void save(submitted)}
        onCancel={props.onCancel}
      />
      {failed === null ? null : (
        <p role="alert" className="dshx:text-xs dshx:text-destructive">
          {failed}
        </p>
      )}
      <Button variant="ghost" size="sm" disabled={pending} onClick={props.onCancel}>
        Cancel
      </Button>
    </div>
  )
}

/** Comments read as messages; every other event folds into one "made N changes" line per actor run, opened on demand. */
const Conversation = (props: {
  readonly events: readonly BacklogEvent[]
  readonly links: readonly BacklogLink[]
  readonly attention: BacklogAttention
  readonly itemId: number
  readonly threads: readonly ComposerThread[]
  readonly projects: readonly string[]
  readonly threadLabel: ThreadLabel
  readonly openThread: OpenThread
  readonly agentReplying: boolean
}): JSX.Element => {
  const attention = props.attention
  const actions = useBacklogActions()
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [commentFailure, setCommentFailure] = useState<string | null>(null)
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const [openDiffs, setOpenDiffs] = useState<ReadonlySet<string>>(new Set())
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
    <ol aria-label="Activity" className="dshx:relative dshx:flex dshx:flex-col dshx:gap-4">
      <span aria-hidden className="dshx:absolute dshx:inset-y-2 dshx:left-[9px] dshx:w-px dshx:bg-border" />
      {runs.map((run, index) => {
        if (run.kind === 'comment') {
          const commentId = run.event.commentId
          const canEdit = run.event.actor === 'user' && commentId !== undefined
          const isEditing = commentId !== undefined && editingComment === commentId
          return (
            <li key={`c:${commentId ?? String(index)}`} className="dshx:relative dshx:flex dshx:gap-2.5">
              <ItemGlyphs.ActorAvatar actorId={run.event.actor} className="dshx:z-10 dshx:mt-0.5 dshx:size-5" />
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
                <p className="dshx:text-xs dshx:text-muted-foreground">
                  <span className="dshx:font-medium dshx:text-foreground">{ItemGlyphs.actorName(run.event.actor)}</span> · {ItemGlyphs.ago(run.event.at)}
                </p>
                <div className="dshx:group dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2 dshx:text-[13px]">
                  {isEditing ? (
                    <ReplyEditor
                      key={commentId}
                      itemId={props.itemId}
                      event={run.event}
                      threads={props.threads}
                      projects={props.projects}
                      onSave={async (text, files) => {
                        if (commentId === undefined) return
                        await actions.editComment.mutateAsync({
                          id: props.itemId,
                          commentId,
                          text,
                          files: files.map(fileInput),
                        })
                        setEditingComment(null)
                      }}
                      onCancel={() => setEditingComment(null)}
                    />
                  ) : (
                    <>
                      <MarkdownText text={run.event.detail} labels={markdownLabels} variant="compact" />
                      <AttachmentMedia itemId={props.itemId} attachments={run.event.attachments ?? []} />
                      {canEdit ? (
                        <div className="dshx:flex dshx:justify-end dshx:opacity-0 dshx:transition-opacity dshx:group-hover:opacity-100 dshx:group-focus-within:opacity-100">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label="Reply actions" className="dshx:text-muted-foreground">
                                <MoreHorizontalIcon aria-hidden className="dshx:size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="dshx-root dshx:min-w-36">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setCommentFailure(null)
                                  setEditingComment(commentId ?? null)
                                }}
                              >
                                <PencilIcon aria-hidden className="dshx:size-3.5" /> Edit reply
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="dshx:text-destructive dshx:focus:text-destructive"
                                onSelect={() => {
                                  if (commentId === undefined || !window.confirm('Delete this reply? This cannot be undone.')) return
                                  void actions.deleteComment
                                    .mutateAsync({ id: props.itemId, commentId })
                                    .catch(error => setCommentFailure(errorMessage(error, 'The reply could not be deleted.')))
                                }}
                              >
                                Delete reply
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : null}
                    </>
                  )}
                  {commentFailure === null ? null : (
                    <p role="alert" className="dshx:text-xs dshx:text-destructive">
                      {commentFailure}
                    </p>
                  )}
                </div>
              </div>
            </li>
          )
        }
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
                    <div key={String(position)}>
                      <p>
                        <ActorThreadLink actorId={event.actor} openThread={props.openThread} />{' '}
                        <ActivityDescription
                          description={ItemGlyphs.describeEvent(event, attention)}
                          threadId={threadId}
                          threadLabel={props.threadLabel}
                          openThread={props.openThread}
                        />{' '}
                        · {ItemGlyphs.ago(event.at)}
                      </p>
                      {event.fieldChanges?.length ? (
                        <>
                          <button
                            type="button"
                            className="dshx:mt-1 dshx:text-info dshx:underline dshx:underline-offset-2 dshx:hover:text-foreground"
                            aria-expanded={openDiffs.has(`${String(index)}:${String(position)}`)}
                            onClick={() => {
                              const key = `${String(index)}:${String(position)}`
                              setOpenDiffs(current => new Set(current.has(key) ? [...current].filter(candidate => candidate !== key) : [...current, key]))
                            }}
                          >
                            {openDiffs.has(`${String(index)}:${String(position)}`) ? 'Hide changes' : 'Show changes'}
                          </button>
                          {openDiffs.has(`${String(index)}:${String(position)}`) ? (
                            <div className="dshx:mt-1 dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:p-2 dshx:text-[11px]">
                              {event.fieldChanges.map(change => (
                                <div key={change.field} className="dshx:grid dshx:grid-cols-[4rem_minmax(0,1fr)] dshx:gap-2">
                                  <span className="dshx:font-medium dshx:text-foreground">{change.field}</span>
                                  <span className="dshx:min-w-0 dshx:break-words">
                                    <del className="dshx:text-destructive">{change.before || '∅'}</del>
                                    {' → '}
                                    <ins className="dshx:text-success dshx:no-underline">{change.after || '∅'}</ins>
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
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
      {props.agentReplying ? (
        <li
          role="status"
          aria-label="Agent is thinking"
          className="dshx:relative dshx:flex dshx:items-center dshx:gap-2.5 dshx:text-xs dshx:text-muted-foreground"
        >
          <span
            aria-hidden
            className="dshx:z-10 dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:border dshx:border-border dshx:bg-background"
          >
            <span className="dshx:size-1.5 dshx:animate-pulse dshx:rounded-full dshx:bg-info" />
          </span>
          <span className="dshx:animate-pulse">Thinking…</span>
        </li>
      ) : null}
    </ol>
  )
}

const CommentBox = (props: {
  readonly item: StartThreadItem
  readonly threads: readonly ComposerThread[]
  readonly projects: readonly string[]
  readonly openCreatedByDefault: boolean
  readonly smartThreadRouting: boolean
  readonly smartReplyAnswers: boolean
  readonly threadStartNotifications: 'off' | 'in-app' | 'system' | 'both'
  readonly onAnswering: (answering: boolean) => void
}): JSX.Element => {
  const actions = useBacklogActions()
  const dispatch = useAgentDispatch()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const [failed, setFailed] = useState<string | null>(null)
  const attachments = useComposerFiles({ onError: setFailed })

  /** A leading `@handle` starts that agent's thread; anything else, or a handle nothing matches, stays a comment. */
  const submit = async (submittedText: string): Promise<void> => {
    const files = [...attachments.files]
    if ((submittedText.trim() === '' && files.length === 0) || submitting.current) return
    submitting.current = true
    setPending(true)
    setFailed(null)
    try {
      const text = markdownImageReferences(submittedText, files)
      await submitReply({
        text,
        files,
        save: async saved => {
          const payload = saved.map(fileInput)
          await actions.comment.mutateAsync(payload.length === 0 ? { id: props.item.id, text } : { id: props.item.id, text, files: payload })
        },
        dispatch:
          dispatch === null
            ? null
            : {
                dispatch: ({ text: replyText }) =>
                  dispatch.dispatch({
                    item: props.item,
                    text: replyText,
                    files: files.map(fileInput),
                    open: props.openCreatedByDefault,
                    smartThreadRouting: props.smartThreadRouting,
                    notificationDelivery: props.threadStartNotifications,
                  }),
                answerReply: ({ text: replyText }) => dispatch.answerReply({ item: props.item, text: replyText }),
                smartReplyAnswers: props.smartReplyAnswers,
              },
        onAnswering: props.onAnswering,
        view: {
          clear: () => {
            setText('')
            attachments.clear()
          },
          restore: restored => {
            setText(current => (current === '' ? restored.text : current))
            attachments.restore(restored.files)
          },
          fail: setFailed,
        },
      })
    } finally {
      submitting.current = false
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
        onSubmit={submittedText => void submit(submittedText)}
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
}): JSX.Element => {
  const actions = useBacklogActions()
  const api = useApi(backlogApi)
  const link = props.link
  const linkedItem = useQuery({
    queryKey: ['dshfiles-backlog', 'reference-title', link.target],
    enabled: link.type === 'item',
    staleTime: 30_000,
    queryFn: async ({ signal }) => BacklogViews.detailResult(await api.get({ id: Number(link.target) }, { signal })),
  })
  const Icon = linkIcons[link.type]
  const [urlOpen, setUrlOpen] = useState(false)
  const openAction = (): (() => void) | undefined => {
    if (link.type === 'thread') return () => props.openThread(link.target)
    return undefined
  }
  const open = openAction()
  return (
    <li className="dshx:group/link dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:transition-colors dshx:hover:bg-accent/50">
      <Icon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
      {link.type === 'item' ? (
        <BacklogReferenceChip id={Number(link.target)} itemTitle={linkedItem.data?.ok === true ? linkedItem.data.value.item.title : null} />
      ) : link.type === 'url' ? (
        <Popover open={urlOpen} onOpenChange={setUrlOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="dshx:min-w-0 dshx:truncate dshx:text-left dshx:text-[13px] dshx:hover:underline">
              {linkLabel(link)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="dshx-root dshx:w-48 dshx:p-1">
            <button
              type="button"
              className="dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-2 dshx:py-1.5 dshx:text-left dshx:text-[13px] dshx:hover:bg-accent"
              onClick={() => {
                void window.open(link.target, '_blank', 'noopener,noreferrer')
                setUrlOpen(false)
              }}
            >
              <ExternalLinkIcon aria-hidden className="dshx:size-3.5" />
              Open in browser
            </button>
            <button
              type="button"
              className="dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-2 dshx:py-1.5 dshx:text-left dshx:text-[13px] dshx:hover:bg-accent"
              onClick={() => {
                void writeClipboard(link.target)
                setUrlOpen(false)
              }}
            >
              <CopyIcon aria-hidden className="dshx:size-3.5" />
              Copy URL
            </button>
          </PopoverContent>
        </Popover>
      ) : open === undefined ? (
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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:rounded-md dshx:border dshx:px-1.5 dshx:py-1 dshx:text-xs">
              <ItemGlyphs.ActorAvatar actorId={props.actorId} className="dshx:size-4 dshx:ring-0" />
              {name}
            </span>
          </TooltipTrigger>
          <TooltipContent>{name}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="xs"
            variant="outline"
            aria-label={`Open ${name}'s thread: ${thread.title}`}
            onClick={() => props.openThread(thread.id)}
            className="dshx:h-7 dshx:max-w-48 dshx:gap-1.5 dshx:px-1.5"
          >
            <ItemGlyphs.ActorAvatar actorId={props.actorId} className="dshx:size-4 dshx:ring-0" />
            <span className="dshx:truncate">{agentQuery.data === null ? thread.title : name}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{`${name} · ${thread.title}`}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  readonly smartThreadRouting: boolean
  readonly smartReplyAnswers: boolean
  readonly threadStartNotifications: 'off' | 'in-app' | 'system' | 'both'
  readonly projectPaths: readonly string[]
  readonly triageOff: boolean
}): JSX.Element => {
  const actions = useBacklogActions()
  const [agentReplying, setAgentReplying] = useState(false)
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
        <TooltipProvider>
          <div className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Start thread"
                  onClick={() => props.startThread([startThreadItemOf({ id: item.id, title: item.title, project: item.project, preview: item.body })])}
                >
                  <MessagesSquareIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Start a thread for this item</TooltipContent>
            </Tooltip>
            {props.triageOff ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Run triage"
                    disabled={actions.triage.isPending}
                    onClick={() => actions.triage.mutate(item.id)}
                    className={cn(actions.triage.isPending && 'dshx:animate-pulse')}
                  >
                    <WandSparklesIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run triage</TooltipContent>
              </Tooltip>
            )}
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
        </TooltipProvider>
      </header>
      <div ref={scroller} className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
        <div className={cn('dshx:mx-auto dshx:flex dshx:flex-col dshx:gap-6 dshx:px-5 dshx:py-5', props.expanded && 'dshx:max-w-3xl dshx:px-8')}>
          <BacklogItemMenu
            item={item}
            projectPaths={props.projectPaths}
            update={input => actions.update.mutate(input)}
            triage={id => actions.triage.mutate(id)}
            triageOff={props.triageOff}
            startThread={props.startThread}
          >
            <div
              tabIndex={-1}
              aria-label={`Item b:${String(item.id)}`}
              className="dshx:flex dshx:flex-col dshx:gap-3 dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-info/50"
            >
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
                <div key={thread.id} className="dshx:flex dshx:items-start dshx:gap-2 dshx:text-xs">
                  <span aria-hidden className="dshx:mt-1 dshx:size-1.5 dshx:shrink-0 dshx:animate-pulse dshx:rounded-full dshx:bg-info" />
                  <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                    <span className="dshx:text-muted-foreground">Running in</span>
                    <span className="dshx:truncate dshx:font-medium">{thread.title}</span>
                  </span>
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
                      triageOff={props.triageOff}
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
              threads={props.threads}
              projects={props.projectPaths}
              threadLabel={threadLabel}
              openThread={props.openThread}
              agentReplying={agentReplying}
            />
            <CommentBox
              item={{ id: item.id, title: item.title, project: item.project, preview: item.body.slice(0, 500) }}
              threads={props.threads}
              projects={props.projectPaths}
              openCreatedByDefault={props.openCreatedByDefault}
              smartThreadRouting={props.smartThreadRouting}
              smartReplyAnswers={props.smartReplyAnswers}
              threadStartNotifications={props.threadStartNotifications}
              onAnswering={setAgentReplying}
            />
          </Section>
        </div>
      </div>
    </>
  )
}

/** The selected item, editable in place: a side panel beside the list, or the whole panel when expanded. */
const ITEM_PEEK_WIDTH = { min: 320, initial: 460 } as const

const ItemPeek = (props: {
  readonly panelRoot: RefObject<HTMLElement | null>
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
  readonly smartThreadRouting: boolean
  readonly smartReplyAnswers: boolean
  readonly threadStartNotifications: 'off' | 'in-app' | 'system' | 'both'
  readonly projectPaths: readonly string[]
  readonly triageOff: boolean
}): JSX.Element => {
  const api = useApi(backlogApi)
  const [width, setWidth] = useState<number>(ITEM_PEEK_WIDTH.initial)
  const resizeStart = useRef<{ readonly pointerId: number; readonly startX: number; readonly startWidth: number } | null>(null)
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
  const regionWidth = props.panelRoot.current?.querySelector<HTMLElement>('[data-backlog-content-region]')?.clientWidth ?? window.innerWidth
  const maxWidth = Math.max(ITEM_PEEK_WIDTH.min, Math.min(regionWidth * 0.55, regionWidth - 320))
  const compact = regionWidth <= 672
  const effectiveWidth = Math.min(width, maxWidth)
  const resize = (nextWidth: number): void => setWidth(Math.min(maxWidth, Math.max(ITEM_PEEK_WIDTH.min, nextWidth)))
  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') resize(width + 24)
    else if (event.key === 'ArrowRight') resize(width - 24)
    else if (event.key === 'Home') resize(ITEM_PEEK_WIDTH.min)
    else if (event.key === 'End') resize(Number.MAX_SAFE_INTEGER)
    else return
    event.preventDefault()
  }
  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    resizeStart.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: effectiveWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = resizeStart.current
    if (start === null || start.pointerId !== event.pointerId) return
    resize(start.startWidth + start.startX - event.clientX)
  }
  const onResizePointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (resizeStart.current?.pointerId === event.pointerId) resizeStart.current = null
  }
  return (
    <aside
      aria-label="Item detail"
      style={props.expanded || props.embedded === true || compact ? undefined : { width: effectiveWidth }}
      className={cn(
        'dshx:relative dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background',
        props.expanded || props.embedded === true
          ? 'dshx:min-w-0 dshx:flex-1'
          : 'dshx:min-w-0 dshx:max-w-[55%] dshx:shrink-0 dshx:border-l dshx:border-border dshx:animate-in dshx:fade-in-0 dshx:slide-in-from-right-2 dshx:duration-150 dshx:@max-pane-compact:absolute dshx:@max-pane-compact:inset-0 dshx:@max-pane-compact:z-20 dshx:@max-pane-compact:w-auto dshx:@max-pane-compact:max-w-none dshx:@max-pane-compact:border-l-0',
      )}
    >
      {props.expanded || props.embedded === true ? null : (
        <div
          role="separator"
          aria-label="Resize item detail"
          aria-orientation="vertical"
          aria-valuemin={ITEM_PEEK_WIDTH.min}
          aria-valuemax={maxWidth}
          aria-valuenow={effectiveWidth}
          tabIndex={0}
          onKeyDown={onResizeKeyDown}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerEnd}
          onPointerCancel={onResizePointerEnd}
          className="dshx:absolute dshx:inset-y-0 dshx:left-0 dshx:z-10 dshx:w-2 dshx:-translate-x-1/2 dshx:cursor-col-resize dshx:touch-none dshx:outline-none dshx:before:absolute dshx:before:inset-y-0 dshx:before:left-1/2 dshx:before:w-0.5 dshx:before:-translate-x-1/2 dshx:before:bg-transparent dshx:hover:before:bg-primary dshx:focus-visible:before:bg-primary dshx:@max-pane-compact:hidden"
        />
      )}
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
          smartThreadRouting={props.smartThreadRouting}
          smartReplyAnswers={props.smartReplyAnswers}
          threadStartNotifications={props.threadStartNotifications}
          projectPaths={props.projectPaths}
          triageOff={props.triageOff}
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
