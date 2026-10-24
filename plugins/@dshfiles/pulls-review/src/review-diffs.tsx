import type { CommentAnchor, CommentThread } from './review-comments-api.js'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Check, ChevronDown, MessageSquare, Trash } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCodeHighlighter, languageForPath, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import { useMemo, useState, type ReactNode } from 'react'
import { ReviewDiffModel, type DiffHunk, type DiffLine, type FileComparison, type SplitRow } from './review-diff.js'

export type DiffLayout = 'unified' | 'split'

const anchorKey = (anchor: CommentAnchor): string => `${anchor.side}:${String(anchor.line)}`

interface ThreadsByAnchor {
  readonly byAnchor: ReadonlyMap<string, readonly CommentThread[]>
  readonly countByPath: number
}

export const threadsAt = (threads: readonly CommentThread[], path: string): ThreadsByAnchor => {
  const byAnchor = new Map<string, CommentThread[]>()
  let countByPath = 0
  for (const thread of threads) {
    if (thread.path !== path) continue
    countByPath += 1
    const key = anchorKey(thread.anchor)
    const list = byAnchor.get(key)
    if (list === undefined) byAnchor.set(key, [thread])
    else list.push(thread)
  }
  return { byAnchor, countByPath }
}

const LINE = 'dshx:grid dshx:grid-cols-[3.5rem_3.5rem_1.25rem_minmax(0,1fr)] dshx:text-xs dshx:leading-[18px]'
const LINE_MARKER =
  'dshx:w-0 dshx:select-none dshx:whitespace-nowrap dshx:text-center dshx:font-mono dshx:text-[10px] dshx:leading-[18px] dshx:text-muted-foreground'

const toneOf = (kind: DiffLine['kind']): string => (kind === 'add' ? 'dshx:bg-success/10' : kind === 'del' ? 'dshx:bg-destructive/10' : 'dshx:bg-transparent')

const CodeText = (props: { readonly text: string; readonly spans: readonly HighlightSpan[] | undefined; readonly wrap: boolean }): ReactNode => (
  <span
    className={cn('dshx:min-w-0 dshx:whitespace-pre dshx:font-mono dshx:text-xs dshx:text-foreground', props.wrap && 'dshx:whitespace-pre-wrap dshx:break-all')}
  >
    {props.spans === undefined
      ? props.text.length === 0
        ? '\u00a0'
        : props.text
      : props.spans.map((span, index) => (
          <span key={index} style={span.style}>
            {span.text}
          </span>
        ))}
  </span>
)

/** Highlight each side of a hunk as one fragment, as the native comparison does. */
const highlightHunk = (
  hunk: DiffHunk,
  highlight: (code: string) => HighlightSpan[][] | undefined,
): { readonly old: ReadonlyMap<number, readonly HighlightSpan[]>; readonly next: ReadonlyMap<number, readonly HighlightSpan[]> } => {
  const side = (pick: (line: DiffLine) => number | undefined): ReadonlyMap<number, readonly HighlightSpan[]> => {
    const rows = hunk.lines.flatMap(line => {
      const number = pick(line)
      return number === undefined ? [] : [{ number, text: line.text }]
    })
    if (rows.length === 0) return new Map()
    const spans = highlight(rows.map(row => row.text).join('\n'))
    if (spans === undefined) return new Map()
    return new Map(rows.map((row, index) => [row.number, spans[index] ?? []]))
  }
  return { old: side(line => line.oldNumber), next: side(line => line.newNumber) }
}

const summaryNote = (comparison: FileComparison): string | undefined => {
  const note = ReviewDiffModel.comparisonNote(comparison)
  if (note === 'created') return 'File created in this review.'
  if (note === 'deleted') return 'File deleted in this review.'
  if (note === 'unchanged') return 'The two sides hold the same lines.'
  return undefined
}

/** One inline conversation, rendered under the line it is anchored to. */
const ThreadCard = (props: {
  readonly thread: CommentThread
  readonly onReply: (id: string, body: string) => void
  readonly onResolve: (id: string, resolved: boolean) => void
  readonly onDelete: (id: string) => void
}): ReactNode => {
  const [replyOpen, setReplyOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const resolveLabel = props.thread.resolvedAt === undefined ? 'Resolve' : 'Reopen'
  return (
    <div
      className={cn(
        'dshx:my-1 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2 dshx:text-xs',
        props.thread.resolvedAt !== undefined && 'dshx:opacity-60',
      )}
      data-review-thread={props.thread.id}
    >
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
        <span className="dshx:font-medium dshx:text-foreground">{props.thread.author.kind === 'agent' ? 'Agent' : 'You'}</span>
        <span>{props.thread.path}</span>
        <span className="dshx:ms-auto dshx:flex dshx:items-center dshx:gap-1">
          <Button size="xs" variant="ghost" onClick={() => props.onResolve(props.thread.id, props.thread.resolvedAt === undefined)}>
            <Check aria-hidden /> {resolveLabel}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true)
                return
              }
              props.onDelete(props.thread.id)
            }}
          >
            <Trash aria-hidden /> {confirmDelete ? 'Confirm' : 'Delete'}
          </Button>
        </span>
      </div>
      <p className="dshx:mt-1 dshx:whitespace-pre-wrap dshx:text-xs dshx:text-foreground">{props.thread.body}</p>
      {props.thread.replies.map(item => (
        <p key={item.id} className="dshx:mt-2 dshx:border-s dshx:border-border dshx:ps-2 dshx:whitespace-pre-wrap dshx:text-xs">
          <span className="dshx:me-2 dshx:font-medium dshx:text-muted-foreground">{item.author.kind === 'agent' ? 'Agent' : 'You'}</span>
          {item.body}
        </p>
      ))}
      {replyOpen ? (
        <div className="dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-1">
          <textarea
            autoFocus
            className="dshx:min-h-16 dshx:w-full dshx:resize-y dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:p-2 dshx:font-mono dshx:text-xs"
            aria-label="Reply body"
            placeholder="Reply… (Cmd+Enter)"
            value={reply}
            onChange={event => setReply(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && reply.trim().length > 0) {
                props.onReply(props.thread.id, reply.trim())
                setReply('')
                setReplyOpen(false)
              }
            }}
          />
          <div className="dshx:flex dshx:justify-end dshx:gap-1">
            <Button size="xs" variant="ghost" onClick={() => setReplyOpen(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              disabled={reply.trim().length === 0}
              onClick={() => {
                props.onReply(props.thread.id, reply.trim())
                setReply('')
                setReplyOpen(false)
              }}
            >
              Reply
            </Button>
          </div>
        </div>
      ) : (
        <Button size="xs" variant="link" className="dshx:mt-1 dshx:px-0" onClick={() => setReplyOpen(true)}>
          Reply
        </Button>
      )}
    </div>
  )
}

/** The composer that appears under a line the reviewer picked. */
const AnchorComposer = (props: {
  readonly anchor: CommentAnchor
  readonly path: string
  readonly onSubmit: (body: string, anchor: CommentAnchor) => void
  readonly onCancel: () => void
}): ReactNode => {
  const [body, setBody] = useState('')
  const submit = (): void => {
    if (body.trim().length === 0) return
    props.onSubmit(body.trim(), props.anchor)
    setBody('')
  }
  return (
    <div className="dshx:my-1 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:p-2" data-review-composer="">
      <div className="dshx:mb-1 dshx:text-[11px] dshx:text-muted-foreground">
        Comment on {props.path}:{String(props.anchor.line)} ({props.anchor.side === 'old' ? 'removed' : 'new'})
      </div>
      <textarea
        autoFocus
        className="dshx:min-h-16 dshx:w-full dshx:resize-y dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:p-2 dshx:font-mono dshx:text-xs"
        aria-label="Comment body"
        placeholder="Leave a comment… (Cmd+Enter)"
        value={body}
        onChange={event => setBody(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
          if (event.key === 'Escape') props.onCancel()
        }}
      />
      <div className="dshx:mt-2 dshx:flex dshx:justify-end dshx:gap-1">
        <Button size="xs" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={body.trim().length === 0} onClick={submit}>
          Comment
        </Button>
      </div>
    </div>
  )
}

export interface CommentBinding {
  readonly threads: readonly CommentThread[]
  readonly active: CommentAnchor | undefined
  readonly onPick: (anchor: CommentAnchor | undefined) => void
  readonly onCreate: (body: string, anchor: CommentAnchor) => void
  readonly onReply: (id: string, body: string) => void
  readonly onResolve: (id: string, resolved: boolean) => void
  readonly onDelete: (id: string) => void
}

interface DiffViewProps {
  readonly path: string
  readonly comparison: FileComparison
  readonly layout: DiffLayout
  readonly wrap: boolean
  readonly comments: CommentBinding | undefined
}

const RowCommentButton = (props: { readonly anchor: CommentAnchor; readonly onPick: (anchor: CommentAnchor) => void }): ReactNode => (
  <button
    type="button"
    aria-label={`Comment on line ${String(props.anchor.line)}`}
    className="dshx:absolute dshx:end-1 dshx:top-1/2 dshx:-translate-y-1/2 dshx:rounded dshx:border dshx:border-border dshx:bg-background dshx:px-1 dshx:text-[10px] dshx:text-muted-foreground dshx:opacity-0 dshx:group-hover/line:opacity-100 dshx:hover:text-foreground"
    onClick={() => props.onPick(props.anchor)}
  >
    +
  </button>
)

const LineCommentButton = (props: { readonly line: DiffLine; readonly side: CommentAnchor['side'] }): CommentAnchor | undefined => {
  if (props.side === 'new') return props.line.newNumber === undefined ? undefined : { side: 'new', line: props.line.newNumber }
  return props.line.oldNumber === undefined ? undefined : { side: 'old', line: props.line.oldNumber }
}

/** Inline conversation rows belonging to one line, plus the composer when this line was picked. */
const AnchoredThreads = (props: {
  readonly path: string
  readonly anchor: CommentAnchor | undefined
  readonly comments: CommentBinding | undefined
}): ReactNode => {
  if (props.comments === undefined || props.anchor === undefined) return null
  const key = anchorKey(props.anchor)
  const matching = props.comments.threads.filter(thread => thread.path === props.path && anchorKey(thread.anchor) === key)
  const composing = props.comments.active !== undefined && anchorKey(props.comments.active) === key
  if (!composing && matching.length === 0) return null
  return (
    <div className="dshx:py-1">
      {composing && (
        <AnchorComposer anchor={props.anchor} path={props.path} onSubmit={props.comments.onCreate} onCancel={() => props.comments?.onPick(undefined)} />
      )}
      {matching.map(thread => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          onReply={props.comments?.onReply ?? (() => undefined)}
          onResolve={props.comments?.onResolve ?? (() => undefined)}
          onDelete={props.comments?.onDelete ?? (() => undefined)}
        />
      ))}
    </div>
  )
}

/** Render one file's comparison, with comment affordances on every changed line. */
export const ReviewDiff = (props: DiffViewProps): ReactNode => {
  const language = languageForPath(props.path)
  const highlight = useCodeHighlighter(language)
  const hunks = useMemo(() => props.comparison.hunks.map(hunk => ({ hunk, highlighted: highlightHunk(hunk, highlight) })), [props.comparison.hunks, highlight])
  const note = summaryNote(props.comparison)
  if (props.comparison.kind === 'binary') return <p className="dshx:p-3 dshx:text-xs dshx:text-muted-foreground">Binary file: no text comparison.</p>
  if (props.comparison.kind === 'oversized') return <p className="dshx:p-3 dshx:text-xs dshx:text-muted-foreground">File too large to compare.</p>
  if (props.comparison.kind === 'missing') return <p className="dshx:p-3 dshx:text-xs dshx:text-muted-foreground">This comparison is no longer available.</p>
  return (
    <div className="dshx:min-w-0" data-diff-layout={props.layout}>
      {note !== undefined && <p className="dshx:px-3 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">{note}</p>}
      {props.comparison.coarse && (
        <p className="dshx:px-3 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">The comparison timed out; every line shows as replaced.</p>
      )}
      {props.comparison.truncated && <p className="dshx:px-3 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">Stopped drawing at 5,000 lines.</p>}
      <div className={cn('dshx:font-mono', !props.wrap && 'dshx:overflow-x-auto')}>
        {hunks.map(({ hunk, highlighted }, index) => (
          <section key={index} className="dshx:min-w-0">
            <div className="dshx:border-y dshx:border-border dshx:bg-muted/50 dshx:px-3 dshx:py-1 dshx:text-[11px] dshx:text-muted-foreground">
              {hunk.header}
            </div>
            {props.layout === 'unified'
              ? hunk.lines.map((line, at) => {
                  const side = line.kind === 'del' ? 'old' : 'new'
                  const anchor = LineCommentButton({ line, side })
                  return (
                    <div key={at} className="dshx:min-w-0">
                      <div className={cn('dshx:group/line dshx:relative', LINE, toneOf(line.kind))}>
                        <span className={LINE_MARKER}>{line.oldNumber ?? ''}</span>
                        <span className={LINE_MARKER}>{line.newNumber ?? ''}</span>
                        <span className="dshx:select-none dshx:text-center dshx:text-xs dshx:text-muted-foreground">
                          {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
                        </span>
                        <span className="dshx:min-w-0 dshx:pe-6">
                          <CodeText
                            text={line.text}
                            spans={(side === 'old' ? highlighted.old : highlighted.next).get((side === 'old' ? line.oldNumber : line.newNumber) ?? -1)}
                            wrap={props.wrap}
                          />
                        </span>
                        {anchor !== undefined && props.comments !== undefined && <RowCommentButton anchor={anchor} onPick={props.comments.onPick} />}
                      </div>
                      <AnchoredThreads path={props.path} anchor={anchor} comments={props.comments} />
                    </div>
                  )
                })
              : ReviewDiffModel.splitHunkLines(hunk.lines).map((row, at) => (
                  <SplitLine
                    key={at}
                    row={row}
                    oldSpans={highlighted.old}
                    newSpans={highlighted.next}
                    wrap={props.wrap}
                    path={props.path}
                    comments={props.comments}
                  />
                ))}
          </section>
        ))}
      </div>
    </div>
  )
}

const SplitLine = (props: {
  readonly row: SplitRow
  readonly oldSpans: ReadonlyMap<number, readonly HighlightSpan[]>
  readonly newSpans: ReadonlyMap<number, readonly HighlightSpan[]>
  readonly wrap: boolean
  readonly path: string
  readonly comments: CommentBinding | undefined
}): ReactNode => {
  const left = props.row.left
  const right = props.row.right
  const anchor: CommentAnchor | undefined =
    right !== undefined ? LineCommentButton({ line: right, side: 'new' }) : left === undefined ? undefined : LineCommentButton({ line: left, side: 'old' })
  return (
    <div className="dshx:min-w-0">
      <div className="dshx:group/line dshx:relative dshx:grid dshx:grid-cols-2 dshx:divide-x dshx:divide-border">
        <span className={cn('dshx:grid dshx:grid-cols-[3rem_minmax(0,1fr)] dshx:pe-6', left === undefined ? 'dshx:bg-destructive/5' : toneOf(left.kind))}>
          <span className={LINE_MARKER}>{left?.oldNumber ?? ''}</span>
          <CodeText text={left?.text ?? ''} spans={left === undefined ? undefined : props.oldSpans.get(left.oldNumber ?? -1)} wrap={props.wrap} />
        </span>
        <span className={cn('dshx:grid dshx:grid-cols-[3rem_minmax(0,1fr)]', right === undefined ? 'dshx:bg-success/5' : toneOf(right.kind))}>
          <span className={LINE_MARKER}>{right?.newNumber ?? ''}</span>
          <CodeText text={right?.text ?? ''} spans={right === undefined ? undefined : props.newSpans.get(right.newNumber ?? -1)} wrap={props.wrap} />
        </span>
        {anchor !== undefined && props.comments !== undefined && <RowCommentButton anchor={anchor} onPick={props.comments.onPick} />}
      </div>
      <AnchoredThreads path={props.path} anchor={anchor} comments={props.comments} />
    </div>
  )
}

export const CommentCountBadge = (props: { readonly count: number }): ReactNode =>
  props.count === 0 ? null : (
    <span className="dshx:inline-flex dshx:items-center dshx:gap-0.5 dshx:text-[10px] dshx:text-muted-foreground" data-review-comment-count={props.count}>
      <MessageSquare className="dshx:size-3" aria-hidden />
      {props.count}
    </span>
  )

/** A small expand control shared by the file headers and the surface toolbar. */
export const DisclosureGlyph = (props: { readonly open: boolean }): ReactNode => (
  <ChevronDown className={cn('dshx:size-3.5 dshx:transition-transform', !props.open && 'dshx:-rotate-90')} aria-hidden />
)
