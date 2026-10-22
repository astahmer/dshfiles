import { MarkdownText, writeClipboard, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@dshfiles/plugin-ui/components/ui/popover'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { ArrowUpRightIcon, BookOpenIcon, CheckIcon, CopyIcon, MessageSquareIcon, SearchIcon, type LucideIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'

import { MemoryAnchorModel } from './memory-anchor.ts'
import { memoryApi, type MemoryPreview, type PanelNote, type PanelThread } from './api.ts'
import { memoryReferencePreviewEvent, memoryReferencePreviewRequestSchema, type MemoryReferencePreviewRequest } from './memory-reference.ts'
import { PanelFormat, noteStatusBadge, noteStatusLabels, originLabels } from './panel-format.ts'

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

/** A preview the card knows how to draw; `excerpt` is also the shape an older Host leaves it in. */
type PreviewCard =
  | { readonly kind: 'note'; readonly note: PanelNote }
  | { readonly kind: 'digest'; readonly thread: PanelThread }
  | { readonly kind: 'excerpt'; readonly summary: string }
  | { readonly kind: 'missing'; readonly summary: string }

/** A Host older than the structured preview sends only `{ summary }`: show that text rather than guess a shape. */
const previewCard = (data: MemoryPreview | undefined): PreviewCard | undefined => {
  if (data === undefined) return undefined
  if (data.kind === 'note' && data.note !== null) return { kind: 'note', note: data.note }
  if (data.kind === 'digest' && data.thread !== null) return { kind: 'digest', thread: data.thread }
  if (data.kind === 'missing') return { kind: 'missing', summary: data.summary }
  return { kind: 'excerpt', summary: data.summary }
}

const SectionHeading = (props: { readonly title: string; readonly trailing?: string }): JSX.Element => (
  <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
    <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">{props.title}</h4>
    {props.trailing === undefined ? null : <span className="dshx:text-[11px] dshx:text-muted-foreground">{props.trailing}</span>}
  </div>
)

const ThreadLink = (props: { readonly sessionId: string; readonly onOpenThread: (sessionId: string) => void }): JSX.Element => (
  <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:p-2.5">
    <span className="dshx:flex dshx:size-8 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:bg-muted dshx:text-muted-foreground">
      <MessageSquareIcon className="dshx:size-4" />
    </span>
    <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
      <span className="dshx:text-[10px] dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">Thread</span>
      <span className="dshx:truncate dshx:text-xs">{props.sessionId}</span>
    </div>
    <Button size="xs" variant="outline" onClick={() => props.onOpenThread(props.sessionId)}>
      Open thread <ArrowUpRightIcon />
    </Button>
  </div>
)

const NoteCard = (props: { readonly note: PanelNote; readonly onOpenThread: (sessionId: string) => void }): JSX.Element => {
  const tone = PanelFormat.noteToneOf(props.note.type)
  const { title, body } = PanelFormat.splitNoteText(props.note.text)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-4">
      <div className="dshx:flex dshx:flex-col dshx:gap-2" data-dshfiles-memory-body>
        <h2 className="dshx:text-lg dshx:font-semibold dshx:leading-snug" data-dshfiles-memory-title>
          {title}
        </h2>
        {body.length === 0 ? null : <MarkdownText text={body} labels={markdownLabels} />}
      </div>

      {props.note.type === 'feedback' ? (
        <div className="dshx:flex dshx:items-start dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-destructive/20 dshx:bg-destructive/5 dshx:p-3">
          <span className="dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:bg-destructive/10 dshx:text-destructive">
            <tone.Icon className="dshx:size-4" />
          </span>
          <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
            <span className="dshx:text-xs dshx:font-semibold dshx:text-destructive">This is a correction</span>
            <span className="dshx:text-xs dshx:text-muted-foreground">It appears in the start block of new threads in this project.</span>
          </div>
        </div>
      ) : null}

      <section className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Source and evidence">
        <SectionHeading title="Source & evidence" trailing={`${String(props.note.citations)} citation${props.note.citations === 1 ? '' : 's'}`} />
        {props.note.sourceThread === null ? (
          <p className="dshx:rounded-xl dshx:border dshx:border-dashed dshx:border-border dshx:p-3 dshx:text-xs dshx:text-muted-foreground">
            No source thread: {originLabels[props.note.origin]}.
          </p>
        ) : (
          <ThreadLink sessionId={props.note.sourceThread} onOpenThread={props.onOpenThread} />
        )}
        <p className="dshx:text-[11px] dshx:text-muted-foreground">
          {originLabels[props.note.origin]} · {PanelFormat.formatStamp(props.note.createdAt)}
          {props.note.sourceSeq === null ? '' : ` · message #${String(props.note.sourceSeq)}`}
        </p>
      </section>

      <section className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Metadata">
        <SectionHeading title="Metadata" />
        <dl className="dshx:grid dshx:grid-cols-2 dshx:gap-x-4 dshx:gap-y-2 dshx:text-xs">
          <div className="dshx:flex dshx:flex-col">
            <dt className="dshx:text-[11px] dshx:text-muted-foreground">Project</dt>
            <dd className="dshx:truncate" title={props.note.project}>
              {PanelFormat.projectName(props.note.project)}
            </dd>
          </div>
          <div className="dshx:flex dshx:flex-col">
            <dt className="dshx:text-[11px] dshx:text-muted-foreground">Type</dt>
            <dd>{tone.label}</dd>
          </div>
          <div className="dshx:flex dshx:flex-col">
            <dt className="dshx:text-[11px] dshx:text-muted-foreground">Status</dt>
            <dd>{noteStatusLabels[props.note.status]}</dd>
          </div>
          <div className="dshx:flex dshx:flex-col">
            <dt className="dshx:text-[11px] dshx:text-muted-foreground">Scope</dt>
            <dd className="dshx:truncate">{props.note.scope}</dd>
          </div>
          <div className="dshx:flex dshx:flex-col">
            <dt className="dshx:text-[11px] dshx:text-muted-foreground">Created</dt>
            <dd>{PanelFormat.formatStamp(props.note.createdAt)}</dd>
          </div>
          <div className="dshx:flex dshx:flex-col">
            <dt className="dshx:text-[11px] dshx:text-muted-foreground">Updated</dt>
            <dd>{PanelFormat.formatStamp(props.note.updatedAt)}</dd>
          </div>
        </dl>
        {props.note.status === 'valid' ? null : (
          <p className="dshx:text-[11px] dshx:text-muted-foreground">
            {noteStatusLabels[props.note.status]}
            {props.note.reason === null ? '' : `: ${props.note.reason}`}
          </p>
        )}
      </section>
    </div>
  )
}

const AttentionRow = (props: { readonly note: PanelNote; readonly onOpenNote: (id: number) => void }): JSX.Element => {
  const tone = PanelFormat.noteToneOf(props.note.type)
  return (
    <li>
      <button
        type="button"
        onClick={() => props.onOpenNote(props.note.id)}
        className="dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:px-1.5 dshx:py-1.5 dshx:text-left dshx:hover:bg-accent/40"
      >
        <span className={cn('dshx:flex dshx:size-6 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md', tone.iconTile)}>
          <tone.Icon className="dshx:size-3.5" />
        </span>
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-xs">{PanelFormat.noteExcerpt(props.note.text, 90)}</span>
        <span className={cn('dshx:shrink-0 dshx:rounded-full dshx:px-1.5 dshx:py-px dshx:text-[10px]', tone.badge)}>{tone.label}</span>
        <span className="dshx:shrink-0 dshx:text-[10px] dshx:text-muted-foreground">{PanelFormat.formatDay(props.note.updatedAt)}</span>
      </button>
    </li>
  )
}

/** The note card with the detail panel's Related and History views, fetched only when their tab is opened. */
const NotePreview = (props: {
  readonly note: PanelNote
  readonly onOpenThread: (sessionId: string) => void
  readonly onOpenNote: (id: number) => void
}): JSX.Element => {
  const api = useApi(memoryApi)
  const [tab, setTab] = useState('details')
  const related = useQuery({
    queryKey: ['dshfiles-memory', 'preview-related', props.note.project],
    enabled: tab === 'related',
    queryFn: ({ signal }) => api.notes({ project: props.note.project, scope: '', type: '', query: '', thread: '', includeInvalid: true }, { signal }),
  })
  const history = useQuery({
    queryKey: ['dshfiles-memory', 'preview-history', props.note.id],
    enabled: tab === 'history',
    queryFn: ({ signal }) => api.noteHistory({ id: props.note.id }, { signal }),
  })
  const relatedNotes = PanelFormat.relatedNotes(props.note, related.data ?? [])
  const versions = history.data ?? []
  return (
    <Tabs value={tab} onValueChange={setTab} className="dshx:flex dshx:flex-col dshx:gap-3">
      <TabsList aria-label="Memory preview views" className="dshx:h-7 dshx:w-fit dshx:bg-muted/60">
        <TabsTrigger value="details" className="dshx:text-[11px]">
          Details
        </TabsTrigger>
        <TabsTrigger value="related" className="dshx:text-[11px]">
          Related{relatedNotes.length === 0 ? '' : ` (${String(relatedNotes.length)})`}
        </TabsTrigger>
        <TabsTrigger value="history" className="dshx:text-[11px]">
          History{versions.length <= 1 ? '' : ` (${String(versions.length)})`}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="details">
        <NoteCard note={props.note} onOpenThread={props.onOpenThread} />
      </TabsContent>
      <TabsContent value="related">
        {related.isPending ? <Skeleton className="dshx:h-3 dshx:w-2/3" /> : null}
        {related.isError ? (
          <p role="alert" className="dshx:text-xs dshx:text-destructive">
            {errorMessage(related.error, 'Related memories are unavailable.')}
          </p>
        ) : null}
        {related.isSuccess && relatedNotes.length === 0 ? (
          <p className="dshx:text-xs dshx:text-muted-foreground">No other memory shares this note&apos;s project, thread or words.</p>
        ) : null}
        {relatedNotes.length === 0 ? null : (
          <ul className="dshx:flex dshx:flex-col dshx:gap-1">
            {relatedNotes.map(note => (
              <AttentionRow key={note.id} note={note} onOpenNote={props.onOpenNote} />
            ))}
          </ul>
        )}
      </TabsContent>
      <TabsContent value="history">
        {history.isPending ? <Skeleton className="dshx:h-3 dshx:w-2/3" /> : null}
        {history.isError ? (
          <p role="alert" className="dshx:text-xs dshx:text-destructive">
            {errorMessage(history.error, 'The note history is unavailable.')}
          </p>
        ) : null}
        {history.isSuccess && versions.length <= 1 ? <p className="dshx:text-xs dshx:text-muted-foreground">No earlier versions.</p> : null}
        {versions.length <= 1 ? null : (
          <ol aria-label="Note history" className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-l dshx:border-border dshx:pl-3">
            {versions.map(version => (
              <li key={version.id} className="dshx:flex dshx:flex-col dshx:gap-0.5">
                <button
                  type="button"
                  onClick={() => props.onOpenNote(version.id)}
                  className={cn(
                    'dshx:w-fit dshx:text-left dshx:font-mono dshx:text-xs dshx:hover:underline',
                    version.id === props.note.id ? 'dshx:font-semibold' : 'dshx:text-muted-foreground',
                  )}
                >
                  n:{version.id}
                </button>
                <span className="dshx:text-[11px] dshx:text-muted-foreground">
                  {PanelFormat.formatStamp(version.updatedAt)} · {noteStatusLabels[version.status]} · {originLabels[version.origin]}
                </span>
                <span className="dshx:text-xs">{PanelFormat.noteExcerpt(version.text, 160)}</span>
              </li>
            ))}
          </ol>
        )}
      </TabsContent>
    </Tabs>
  )
}

const DigestCard = (props: { readonly thread: PanelThread; readonly onOpenThread: (sessionId: string) => void }): JSX.Element => (
  <div className="dshx:flex dshx:flex-col dshx:gap-4">
    <div className="dshx:flex dshx:flex-col dshx:gap-2" data-dshfiles-memory-body>
      <h2 className="dshx:text-lg dshx:font-semibold dshx:leading-snug" data-dshfiles-memory-title>
        {props.thread.title.length === 0 ? '(untitled thread)' : props.thread.title}
      </h2>
      {props.thread.decision.length === 0 ? null : <p className="dshx:text-sm dshx:font-medium">{props.thread.decision}</p>}
      <MarkdownText text={props.thread.digest} labels={markdownLabels} />
    </div>
    <p className="dshx:text-[11px] dshx:text-muted-foreground">
      {props.thread.source === 'model' ? 'Written by a cheap model from the thread transcript.' : 'Built from the thread record without a model call.'}
    </p>
    <section className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Source and evidence">
      <SectionHeading title="Source & evidence" trailing={`${String(props.thread.citations)} citation${props.thread.citations === 1 ? '' : 's'}`} />
      <ThreadLink sessionId={props.thread.id} onOpenThread={props.onOpenThread} />
    </section>
    <section className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Metadata">
      <SectionHeading title="Metadata" />
      <dl className="dshx:grid dshx:grid-cols-2 dshx:gap-x-4 dshx:gap-y-2 dshx:text-xs">
        <div className="dshx:flex dshx:flex-col">
          <dt className="dshx:text-[11px] dshx:text-muted-foreground">Project</dt>
          <dd className="dshx:truncate" title={props.thread.project}>
            {PanelFormat.projectName(props.thread.project)}
          </dd>
        </div>
        <div className="dshx:flex dshx:flex-col">
          <dt className="dshx:text-[11px] dshx:text-muted-foreground">Digested</dt>
          <dd>{props.thread.digestedAt === null ? 'not yet' : PanelFormat.formatStamp(props.thread.digestedAt)}</dd>
        </div>
      </dl>
    </section>
  </div>
)

const ExcerptCard = (props: { readonly summary: string }): JSX.Element => (
  <div
    data-dshfiles-memory-body
    className="dshx:whitespace-pre-wrap dshx:break-words dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/40 dshx:p-3 dshx:font-mono dshx:text-[11px] dshx:leading-relaxed"
  >
    {props.summary}
  </div>
)

const MissingCard = (props: { readonly id: string; readonly summary: string }): JSX.Element => (
  <div className="dshx:flex dshx:items-start dshx:gap-2.5 dshx:rounded-lg dshx:border dshx:border-dashed dshx:border-border dshx:p-3">
    <span className="dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:bg-muted dshx:text-muted-foreground">
      <SearchIcon className="dshx:size-3.5" />
    </span>
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
      <span className="dshx:text-xs dshx:font-medium">Nothing stored for {props.id}</span>
      <span data-dshfiles-memory-body className="dshx:text-xs dshx:text-muted-foreground">
        {props.summary}
      </span>
    </div>
  </div>
)

/** The badge, tile and context line the card's own kind implies, so a miss never claims to be a digest. */
type PreviewHeader = {
  readonly Icon: LucideIcon
  readonly tile: string
  readonly label: string
  readonly labelClass: string
  readonly status: { readonly label: string; readonly className: string } | undefined
}

const headerOf = (card: PreviewCard): PreviewHeader => {
  if (card.kind === 'note') {
    const tone = PanelFormat.noteToneOf(card.note.type)
    return {
      Icon: tone.Icon,
      tile: tone.iconTile,
      label: tone.label,
      labelClass: tone.badge,
      status: { label: noteStatusLabels[card.note.status], className: noteStatusBadge[card.note.status] },
    }
  }
  if (card.kind === 'digest') {
    return {
      Icon: BookOpenIcon,
      tile: 'dshx:bg-violet/10 dshx:text-violet',
      label: 'Thread digest',
      labelClass: 'dshx:bg-violet/10 dshx:text-violet',
      status: undefined,
    }
  }
  if (card.kind === 'excerpt') {
    return {
      Icon: MessageSquareIcon,
      tile: 'dshx:bg-info/10 dshx:text-info',
      label: 'Thread excerpt',
      labelClass: 'dshx:bg-info/10 dshx:text-info',
      status: undefined,
    }
  }
  return {
    Icon: SearchIcon,
    tile: 'dshx:bg-muted dshx:text-muted-foreground',
    label: 'Not found',
    labelClass: 'dshx:bg-muted dshx:text-muted-foreground',
    status: undefined,
  }
}

const CardHeader = (props: { readonly card: PreviewCard; readonly request: MemoryReferencePreviewRequest }): JSX.Element => {
  const header = headerOf(props.card)
  return (
    <div className="dshx:flex dshx:items-center dshx:gap-3">
      <span className={cn('dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl', header.tile)}>
        <header.Icon className="dshx:size-4" />
      </span>
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-wrap dshx:items-center dshx:gap-1.5">
        <Badge variant="outline" className={cn('dshx:border-transparent', header.labelClass)}>
          {header.label}
        </Badge>
        {header.status === undefined ? null : (
          <Badge variant="outline" className={cn('dshx:border-transparent', header.status.className)}>
            {header.status.label}
          </Badge>
        )}
        {props.card.kind === 'note' && props.card.note.confidence === 'inferred' ? (
          <Badge variant="muted" className="dshx:font-normal">
            inferred
          </Badge>
        ) : null}
      </div>
      <code className="dshx:shrink-0 dshx:rounded-md dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground">
        {props.request.id}
        {props.request.range === undefined ? '' : ` #${props.request.range}`}
      </code>
    </div>
  )
}

export const MemoryReferenceOverlay = (props: {
  /** Opens the Memory page on this item, the way the sidebar's Memory row would. */
  readonly openInMemory: (focus: { readonly id: string; readonly range?: string }) => void
  /** Opens a source thread in the conversation view, the way the panel's thread card does. */
  readonly openThread: (sessionId: string) => void
}): JSX.Element | null => {
  const api = useApi(memoryApi)
  const [request, setRequest] = useState<MemoryReferencePreviewRequest | null>(null)
  const [anchor, setAnchor] = useState<MemoryReferencePreviewRequest['anchor'] | null>(null)
  const [copied, setCopied] = useState(false)
  const preview = useQuery({
    queryKey: ['dshfiles-memory', 'reference-preview', request?.id, request?.range],
    enabled: request !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (request === null) throw new Error('No memory reference is selected.')
      const input = request.range === undefined ? { id: request.id } : { id: request.id, range: request.range }
      return api.preview(input, { signal })
    },
  })

  useEffect(() => {
    const open = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = memoryReferencePreviewRequestSchema.safeParse(event.detail)
      if (!parsed.success) return
      setAnchor(parsed.data.anchor)
      setRequest(parsed.data)
    }
    window.addEventListener(memoryReferencePreviewEvent, open)
    return () => window.removeEventListener(memoryReferencePreviewEvent, open)
  }, [])

  // A landing message scrolls the conversation; the card follows the reference instead of disappearing under it.
  useEffect(() => {
    if (request === null) return
    const remeasure = (): void => {
      const measurement = MemoryAnchorModel.measure(request.anchorId, window.innerHeight)
      if (measurement.kind === 'gone') return
      if (measurement.kind === 'offscreen') {
        setRequest(null)
        return
      }
      setAnchor(measurement.rect)
    }
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    return () => {
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
    }
  }, [request])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1_500)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (request === null) return null
  const card = previewCard(preview.data)
  const copyText = card === undefined ? '' : card.kind === 'note' ? card.note.text : card.kind === 'digest' ? card.thread.digest : card.summary
  return (
    <Popover open onOpenChange={open => !open && setRequest(null)}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{
            position: 'fixed',
            display: 'block',
            left: (anchor ?? request.anchor).left,
            top: (anchor ?? request.anchor).top,
            width: Math.max(1, (anchor ?? request.anchor).width),
            height: Math.max(1, (anchor ?? request.anchor).height),
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          'dshx-root dshx:flex dshx:max-w-[calc(100vw-1rem)] dshx:flex-col dshx:gap-0 dshx:overflow-hidden dshx:p-0',
          card?.kind === 'excerpt' ? 'dshx:w-[44rem]' : 'dshx:w-auto dshx:min-w-[26rem] dshx:max-w-[34rem]',
        )}
        data-dshfiles-memory-preview
      >
        <div className="dshx:border-b dshx:border-border dshx:p-4">
          {card === undefined ? (
            <div className="dshx:flex dshx:items-center dshx:gap-3">
              <Skeleton className="dshx:size-9 dshx:rounded-xl" />
              <div className="dshx:flex dshx:flex-1 dshx:flex-col dshx:gap-1.5">
                <Skeleton className="dshx:h-3 dshx:w-24" />
                <Skeleton className="dshx:h-2.5 dshx:w-40" />
              </div>
            </div>
          ) : (
            <CardHeader card={card} request={request} />
          )}
        </div>
        <div className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-4 dshx:overflow-auto dshx:p-4 dshx:[max-height:min(26rem,58vh)]">
          {preview.isPending && card === undefined ? (
            <div className="dshx:flex dshx:flex-col dshx:gap-2">
              <Skeleton className="dshx:h-4 dshx:w-11/12" />
              <Skeleton className="dshx:h-3 dshx:w-full" />
              <Skeleton className="dshx:h-3 dshx:w-3/5" />
            </div>
          ) : null}
          {preview.isError ? (
            <p role="alert" className="dshx:text-xs dshx:text-destructive">
              {errorMessage(preview.error, 'Memory reference is unavailable.')}
            </p>
          ) : null}
          {card?.kind === 'note' ? (
            <NotePreview
              note={card.note}
              onOpenThread={props.openThread}
              onOpenNote={id => {
                props.openInMemory({ id: `n:${String(id)}` })
                setRequest(null)
              }}
            />
          ) : null}
          {card?.kind === 'digest' ? <DigestCard thread={card.thread} onOpenThread={props.openThread} /> : null}
          {card?.kind === 'excerpt' ? <ExcerptCard summary={card.summary} /> : null}
          {card?.kind === 'missing' ? <MissingCard id={request.id} summary={card.summary} /> : null}
        </div>
        <div className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-1.5 dshx:border-t dshx:border-border dshx:px-4 dshx:py-2.5">
          <Button
            size="xs"
            variant="ghost"
            disabled={copyText.length === 0}
            onClick={() => {
              void writeClipboard(copyText).then(() => setCopied(true))
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              props.openInMemory(request.range === undefined ? { id: request.id } : { id: request.id, range: request.range })
              setRequest(null)
            }}
          >
            Open in Memory
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
