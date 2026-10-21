import { MarkdownText, writeClipboard, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import {
  ArrowUpRightIcon,
  CopyIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { memoryApi, type MemoryCitation, type PanelNote, type PanelThread } from './api.ts'
import { PanelFormat } from './panel-format.ts'

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

type ThreadStatusFilter = 'all' | 'digested' | 'undigested'
type ThreadSourceFilter = '' | 'trail' | 'model'
type ThreadSort = 'activity' | 'digested' | 'cited'

const threadStatusOf = (value: string): ThreadStatusFilter => (value === 'digested' || value === 'undigested' || value === 'all' ? value : 'all')
const threadSourceOf = (value: string): ThreadSourceFilter => (value === 'trail' || value === 'model' || value === '' ? value : '')
const threadSortOf = (value: string): ThreadSort => (value === 'digested' || value === 'cited' || value === 'activity' ? value : 'activity')

const filterTrigger =
  'dshx:h-7 dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-transparent dshx:px-2.5 dshx:text-xs dshx:font-normal dshx:shadow-none'

const ThreadRow = (props: { readonly thread: PanelThread; readonly selected: boolean; readonly onOpen: () => void }): JSX.Element => {
  const thread = props.thread
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={props.selected ? 'true' : undefined}
      onClick={props.onOpen}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onOpen()
        }
      }}
      className={cn(
        'dshx:flex dshx:cursor-pointer dshx:items-start dshx:gap-3 dshx:px-4 dshx:py-3 dshx:outline-none',
        'dshx:hover:bg-accent/40 dshx:focus-visible:bg-accent/50',
        props.selected && 'dshx:bg-accent/55 dshx:hover:bg-accent/60',
      )}
    >
      <span className="dshx:mt-0.5 dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl dshx:bg-muted dshx:text-muted-foreground">
        <MessageSquareIcon className="dshx:size-[18px]" />
      </span>
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
        <span className="dshx:line-clamp-1 dshx:text-[13px] dshx:font-medium">{thread.title}</span>
        <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{PanelFormat.threadSubtitle(thread)}</span>
        <span className="dshx:line-clamp-1 dshx:text-xs dshx:text-muted-foreground">{thread.digested ? thread.decision : 'Waiting to be digested…'}</span>
      </span>
      <span className="dshx:flex dshx:w-28 dshx:shrink-0 dshx:flex-col dshx:items-end dshx:gap-1 dshx:text-[11px] dshx:text-muted-foreground">
        <span className="dshx:tabular-nums">{PanelFormat.formatDay(thread.updatedAt)}</span>
        <Badge
          variant="outline"
          className={cn(
            'dshx:h-4 dshx:border-transparent dshx:px-1.5 dshx:text-[10px]',
            thread.digested ? 'dshx:bg-info/10 dshx:text-info' : 'dshx:bg-warning/10 dshx:text-warning',
          )}
        >
          {thread.digested ? 'Digested' : 'Not digested'}
        </Badge>
        {thread.citations > 0 ? <span>{thread.citations} cited</span> : null}
      </span>
    </div>
  )
}

const CitationRow = (props: { readonly citation: MemoryCitation; readonly openThread: (id: string) => void }): JSX.Element => {
  const api = useApi(memoryApi)
  const queryClient = useQueryClient()
  const citation = props.citation
  const rate = useMutation({
    mutationFn: (rating: 'up' | 'down' | null) => api.rateCitation({ id: citation.id, rating }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['dshfiles-memory'] }),
  })
  const toggle = (rating: 'up' | 'down'): void => rate.mutate(citation.rating === rating ? null : rating)
  return (
    <li className="dshx:flex dshx:flex-col dshx:gap-1 dshx:py-2">
      <div className="dshx:flex dshx:items-start dshx:gap-2 dshx:text-xs">
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <span className="dshx:line-clamp-2">{citation.target ?? `${citation.ref} (no longer in memory)`}</span>
          <span className="dshx:text-[11px] dshx:text-muted-foreground">
            {citation.ref} · cited in {PanelFormat.formatStamp(citation.at)}
          </span>
        </span>
        <Button
          size="icon-xs"
          variant={citation.rating === 'up' ? 'secondary' : 'ghost'}
          aria-label="Useful"
          aria-pressed={citation.rating === 'up'}
          onClick={() => toggle('up')}
        >
          <ThumbsUpIcon />
        </Button>
        <Button
          size="icon-xs"
          variant={citation.rating === 'down' ? 'secondary' : 'ghost'}
          aria-label="Not useful"
          aria-pressed={citation.rating === 'down'}
          onClick={() => toggle('down')}
        >
          <ThumbsDownIcon />
        </Button>
      </div>
      {citation.agentCorrected || citation.userCorrected ? (
        <div className="dshx:flex dshx:gap-1">
          {citation.agentCorrected ? <Badge variant="secondary">agent revised</Badge> : null}
          {citation.userCorrected ? <Badge variant="secondary">user corrected</Badge> : null}
        </div>
      ) : null}
      <button
        type="button"
        className="dshx:w-fit dshx:text-[11px] dshx:text-muted-foreground dshx:hover:underline"
        onClick={() => props.openThread(citation.thread)}
      >
        Open citing thread {PanelFormat.threadRef(citation.thread)}
      </button>
    </li>
  )
}

const DigestedThreadDetail = (props: {
  readonly thread: PanelThread
  readonly notes: readonly PanelNote[]
  readonly citations: readonly MemoryCitation[]
  readonly createdAt: number
  readonly openThread: (id: string) => void
  readonly openNote: (id: number) => void
  readonly redigest: () => void
  readonly redigesting: boolean
}): JSX.Element => {
  const api = useApi(memoryApi)
  const [tab, setTab] = useState('digest')
  const thread = props.thread
  const digestLines = thread.digest.split('\n')
  const digestBody = digestLines.length > 1 ? digestLines.slice(1).join('\n').trim() : thread.digest
  const [raw, setRaw] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [rawText, setRawText] = useState<string>('')
  useEffect(() => {
    if (tab !== 'raw' || raw !== 'idle') return
    setRaw('loading')
    void api
      .preview({ id: `t:${thread.id}` })
      .then(result => {
        setRawText(result.summary)
        setRaw('ready')
      })
      .catch(() => setRaw('failed'))
  }, [api, raw, tab, thread.id])
  const timeline = useMemo(() => {
    const entries: { readonly at: number; readonly title: string; readonly detail?: string }[] = [
      { at: props.createdAt, title: 'Thread created' },
      ...(thread.digestedAt === null ? [] : [{ at: thread.digestedAt, title: `Digested (${thread.source === 'model' ? 'cheap model' : 'BM25'})` }]),
      ...props.notes.map(note => ({ at: note.createdAt, title: 'Memory created', detail: PanelFormat.noteExcerpt(note.text, 120) })),
      ...props.citations.map(citation => ({
        at: citation.at,
        title: 'Memory cited',
        detail: citation.target === null ? citation.ref : `${citation.ref} · ${citation.target}`,
      })),
    ]
    return entries.sort((left, right) => left.at - right.at)
  }, [props.citations, props.createdAt, props.notes, thread])
  return (
    <Tabs value={tab} onValueChange={setTab} className="dshx:flex dshx:flex-col dshx:gap-3">
      <TabsList aria-label="Thread detail views" className="dshx:h-8 dshx:w-fit dshx:bg-muted/60">
        <TabsTrigger value="digest" className="dshx:text-xs">
          Digest
        </TabsTrigger>
        <TabsTrigger value="memories" className="dshx:text-xs">
          Memories ({props.notes.length})
        </TabsTrigger>
        <TabsTrigger value="citations" className="dshx:text-xs">
          Citations ({props.citations.length})
        </TabsTrigger>
        <TabsTrigger value="timeline" className="dshx:text-xs">
          Timeline
        </TabsTrigger>
        <TabsTrigger value="raw" className="dshx:text-xs">
          Raw content
        </TabsTrigger>
      </TabsList>
      <TabsContent value="digest" className="dshx:flex dshx:flex-col dshx:gap-4">
        <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:p-3">
          <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
            <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">Thread digest</h4>
            <Button size="xs" variant="outline" onClick={props.redigest} disabled={props.redigesting}>
              <RefreshCwIcon className={props.redigesting ? 'dshx:animate-spin' : undefined} /> Regenerate
            </Button>
          </div>
          <p className="dshx:text-sm dshx:font-medium">{thread.decision}</p>
          <div className="dshx:text-xs">
            <MarkdownText text={digestBody} labels={markdownLabels} variant="compact" />
          </div>
          <p className="dshx:text-[11px] dshx:text-muted-foreground">
            {thread.source === 'model' ? 'Written by a cheap model from the thread transcript.' : 'Built from the thread record without a model call.'}
          </p>
        </section>
        <section className="dshx:flex dshx:flex-col dshx:gap-2">
          <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">Created / updated memories ({props.notes.length})</h4>
          {props.notes.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">No memory was written from this thread.</p> : null}
          <ul className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
            {props.notes.map(note => {
              const tone = PanelFormat.noteToneOf(note.type)
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => props.openNote(note.id)}
                    className="dshx:flex dshx:w-full dshx:items-start dshx:gap-2 dshx:py-2 dshx:text-left dshx:hover:bg-accent/30"
                  >
                    <span
                      className={cn('dshx:mt-0.5 dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg', tone.iconTile)}
                    >
                      <tone.Icon className="dshx:size-4" />
                    </span>
                    <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
                      <span className="dshx:line-clamp-2 dshx:text-xs">{note.text}</span>
                      <span className="dshx:text-[11px] dshx:text-muted-foreground">{PanelFormat.formatStamp(note.createdAt)}</span>
                    </span>
                    <span className={cn('dshx:shrink-0 dshx:rounded-full dshx:px-1.5 dshx:py-px dshx:text-[10px]', tone.badge)}>{tone.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </TabsContent>
      <TabsContent value="memories">
        {props.notes.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">No memory was written from this thread.</p> : null}
        <ul className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
          {props.notes.map(note => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => props.openNote(note.id)}
                className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-0.5 dshx:py-2 dshx:text-left dshx:hover:bg-accent/30"
              >
                <span className="dshx:text-xs">{note.text}</span>
                <span className="dshx:text-[11px] dshx:text-muted-foreground">
                  {PanelFormat.noteToneOf(note.type).label} · {PanelFormat.formatStamp(note.createdAt)} · {note.citations} citations
                </span>
              </button>
            </li>
          ))}
        </ul>
      </TabsContent>
      <TabsContent value="citations">
        {props.citations.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">No agent cited memory in this thread.</p> : null}
        <ul className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
          {props.citations.map(citation => (
            <CitationRow key={citation.id} citation={citation} openThread={props.openThread} />
          ))}
        </ul>
      </TabsContent>
      <TabsContent value="timeline">
        <ol className="dshx:flex dshx:flex-col dshx:gap-3 dshx:border-l dshx:border-border dshx:pl-3">
          {timeline.map((entry, index) => (
            <li key={`${entry.at}:${String(index)}`} className="dshx:flex dshx:flex-col dshx:gap-0.5">
              <span className="dshx:text-xs dshx:font-medium">{entry.title}</span>
              {entry.detail === undefined ? null : <span className="dshx:text-[11px] dshx:text-muted-foreground">{entry.detail}</span>}
              <span className="dshx:text-[11px] dshx:text-muted-foreground">{PanelFormat.formatStamp(entry.at)}</span>
            </li>
          ))}
        </ol>
      </TabsContent>
      <TabsContent value="raw">
        {raw === 'loading' ? <p className="dshx:text-xs dshx:text-muted-foreground">Reading the thread excerpt…</p> : null}
        {raw === 'failed' ? <p className="dshx:text-xs dshx:text-destructive">The thread excerpt could not be read.</p> : null}
        {raw === 'ready' ? (
          <pre className="dshx:max-h-96 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:rounded-lg dshx:bg-muted/50 dshx:p-3 dshx:font-mono! dshx:text-[11px]">
            {rawText}
          </pre>
        ) : null}
      </TabsContent>
    </Tabs>
  )
}

export const ThreadsTab = (props: {
  readonly project: string | undefined
  readonly openThread: (id: string) => void
  readonly focusThreadId: string | undefined
  readonly selectedId: string | null
  readonly onSelect: (id: string | null) => void
  readonly openNote: (id: number) => void
}): JSX.Element => {
  const api = useApi(memoryApi)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ThreadStatusFilter>('all')
  const [source, setSource] = useState<ThreadSourceFilter>('')
  const [sort, setSort] = useState<ThreadSort>('activity')
  const focusThreadId = props.focusThreadId
  const selectThread = props.onSelect
  const debounced = useDebouncedValue({ value: search, delayMs: 250 })
  const threads = useQuery({
    queryKey: ['dshfiles-memory', 'threads', props.project ?? '', 'all'],
    queryFn: ({ signal }) => api.threads({ project: props.project ?? '', includeUndigested: true }, { signal }),
    staleTime: 15_000,
  })
  useEffect(() => {
    if (focusThreadId !== undefined) selectThread(focusThreadId)
  }, [focusThreadId, selectThread])
  const list = useMemo(() => threads.data ?? [], [threads.data])
  const visible = useMemo(() => {
    const needle = debounced.trim().toLowerCase()
    return list
      .filter(thread => (status === 'all' ? true : status === 'digested' ? thread.digested : !thread.digested))
      .filter(thread => (source === '' ? true : thread.source === source))
      .filter(
        thread => needle.length === 0 || `${thread.title} ${thread.decision} ${thread.digest} ${thread.project} ${thread.id}`.toLowerCase().includes(needle),
      )
      .sort((left, right) => {
        if (sort === 'digested') return Number(right.digested) - Number(left.digested) || right.updatedAt - left.updatedAt
        if (sort === 'cited') return right.citations - left.citations || right.updatedAt - left.updatedAt
        return right.updatedAt - left.updatedAt
      })
  }, [debounced, list, sort, source, status])
  const selected = list.find(thread => thread.id === props.selectedId)
  const diagnosed = list.filter(thread => thread.digested).length
  const citing = list.filter(thread => thread.citations > 0).length
  const notes = useQuery({
    queryKey: ['dshfiles-memory', 'thread-notes', props.selectedId ?? ''],
    queryFn: ({ signal }) =>
      api.notes({ project: selected?.project ?? '', scope: '', type: '', query: '', thread: props.selectedId ?? '', includeInvalid: false }, { signal }),
    enabled: selected !== undefined,
  })
  const citations = useQuery({
    queryKey: ['dshfiles-memory', 'thread-citations', props.selectedId ?? ''],
    queryFn: ({ signal }) => api.citations({ thread: props.selectedId ?? '' }, { signal }),
    enabled: selected !== undefined,
  })
  const detail = useQuery({
    queryKey: ['dshfiles-memory', 'thread-detail', props.selectedId ?? ''],
    queryFn: ({ signal }) => api.threadDetail({ id: props.selectedId ?? '' }, { signal }),
    enabled: selected !== undefined,
    retry: false,
  })
  const redigest = useMutation({
    mutationFn: (id: string) => api.redigest({ id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['dshfiles-memory'] }),
  })
  const searchRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:gap-4 dshx:overflow-hidden dshx:px-5 dshx:pb-5 dshx:@max-pane-compact:flex-col dshx:@max-pane-compact:overflow-auto dshx:@max-[64rem]:flex-col dshx:@max-[64rem]:overflow-auto">
      <section className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card/40 dshx:@max-[64rem]:h-[28rem] dshx:@max-[64rem]:flex-none">
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-b dshx:border-border dshx:p-3">
          <div className="dshx:flex dshx:h-9 dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:px-2.5">
            <SearchIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
            <input
              ref={searchRef}
              aria-label="Search threads"
              placeholder="Search threads (title, content, digest…)"
              value={search}
              onChange={event => setSearch(event.currentTarget.value)}
              className="dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:bg-transparent dshx:text-sm dshx:outline-none"
            />
            <kbd className="dshx:rounded dshx:border dshx:border-border dshx:px-1 dshx:text-[10px] dshx:text-muted-foreground">/</kbd>
          </div>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
            <Combobox
              label="Filter by digest status"
              onValueChange={value => setStatus(threadStatusOf(value))}
              options={[
                { value: 'all', label: 'All statuses' },
                { value: 'digested', label: 'Digested' },
                { value: 'undigested', label: 'Not digested' },
              ]}
              triggerClassName={cn(filterTrigger, 'dshx:w-auto')}
              value={status}
            />
            <Combobox
              label="Filter by source"
              onValueChange={value => setSource(threadSourceOf(value))}
              options={[
                { value: '', label: 'All sources' },
                { value: 'trail', label: 'Thread record' },
                { value: 'model', label: 'Cheap model' },
              ]}
              triggerClassName={cn(filterTrigger, 'dshx:w-auto')}
              value={source}
            />
            <Combobox
              label="Sort threads"
              onValueChange={value => setSort(threadSortOf(value))}
              options={[
                { value: 'activity', label: 'Last activity' },
                { value: 'digested', label: 'Digested first' },
                { value: 'cited', label: 'Most cited' },
              ]}
              triggerClassName={cn(filterTrigger, 'dshx:w-auto')}
              value={sort}
            />
          </div>
          <div className="dshx:flex dshx:flex-wrap dshx:items-baseline dshx:gap-2 dshx:pt-0.5">
            <span className="dshx:text-[13px] dshx:font-semibold">{PanelFormat.formatCount(visible.length)} threads</span>
            <span className="dshx:flex-1" />
            <span className="dshx:text-[11px] dshx:text-muted-foreground">
              {PanelFormat.formatCount(diagnosed)} digested · {PanelFormat.formatCount(list.length - diagnosed)} not digested ·{' '}
              {PanelFormat.formatCount(citing)} cite memories
            </span>
          </div>
        </div>
        {threads.isError ? <p className="dshx:p-4 dshx:text-xs dshx:text-destructive">{errorMessage(threads.error, 'Threads are unavailable.')}</p> : null}
        {threads.isSuccess && visible.length === 0 ? (
          <p className="dshx:p-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">
            {debounced.length > 0 || status !== 'all' || source !== ''
              ? 'No threads match these filters.'
              : 'No thread digests yet. A thread is digested once it has been idle for a minute.'}
          </p>
        ) : null}
        <div className="dshx:min-h-0 dshx:flex-1 dshx:divide-y dshx:divide-border dshx:overflow-auto">
          {visible.map(thread => (
            <ThreadRow key={thread.id} thread={thread} selected={thread.id === props.selectedId} onOpen={() => props.onSelect(thread.id)} />
          ))}
        </div>
      </section>
      {selected === undefined ? (
        <aside
          aria-label="Thread detail"
          className="dshx:flex dshx:w-96 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl dshx:border dshx:border-dashed dshx:border-border dshx:p-6 dshx:text-center dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:hidden dshx:@max-[64rem]:hidden"
        >
          Select a thread to read its digest, the memories it created, and the citations it produced.
        </aside>
      ) : (
        <aside
          aria-label="Thread detail"
          className="dshx:flex dshx:min-h-0 dshx:w-[30rem] dshx:shrink-0 dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card/40 dshx:@max-pane-compact:w-full dshx:@max-[64rem]:h-[34rem] dshx:@max-[64rem]:w-full dshx:@max-[64rem]:flex-none"
        >
          <div className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:overflow-hidden">
            <div className="dshx:flex dshx:items-start dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3">
              <span className="dshx:mt-0.5 dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl dshx:bg-muted dshx:text-muted-foreground">
                <MessageSquareIcon className="dshx:size-[18px]" />
              </span>
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
                <h2 className="dshx:line-clamp-2 dshx:text-sm dshx:font-semibold dshx:leading-snug">{selected.title}</h2>
                <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{PanelFormat.threadSubtitle(selected)}</span>
              </div>
              <Button size="xs" variant="outline" onClick={() => props.openThread(selected.id)}>
                Open thread <ArrowUpRightIcon />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Thread actions">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="dshx:w-48">
                  <DropdownMenuLabel>{PanelFormat.threadRef(selected.id)}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void writeClipboard(selected.id)}>
                    <CopyIcon /> Copy Session id
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void writeClipboard(selected.digest)} disabled={!selected.digested}>
                    <CopyIcon /> Copy digest
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon-sm" aria-label="Close thread detail" onClick={() => props.onSelect(null)}>
                <XIcon />
              </Button>
            </div>
            <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-3 dshx:overflow-auto dshx:p-4">
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-1 dshx:text-[11px] dshx:text-muted-foreground">
                <span>{PanelFormat.formatStamp(detail.data?.createdAt ?? selected.createdAt)}</span>
                <span>·</span>
                <span>Agent</span>
                <span>·</span>
                <span>{selected.digested ? `Digested (${selected.source === 'model' ? 'cheap model' : 'BM25'})` : 'Not digested'}</span>
                {detail.data === undefined ? null : (
                  <>
                    <span>·</span>
                    <span>{detail.data.messages} messages</span>
                  </>
                )}
                {selected.citations > 0 ? (
                  <>
                    <span>·</span>
                    <span>{selected.citations} citations</span>
                  </>
                ) : null}
              </div>
              {selected.digested ? (
                <DigestedThreadDetail
                  thread={selected}
                  notes={notes.data ?? []}
                  citations={citations.data ?? []}
                  createdAt={detail.data?.createdAt ?? selected.createdAt}
                  openThread={props.openThread}
                  openNote={props.openNote}
                  redigest={() => redigest.mutate(selected.id)}
                  redigesting={redigest.isPending}
                />
              ) : (
                <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-dashed dshx:border-border dshx:p-4">
                  <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:font-medium">
                    <SparklesIcon className="dshx:size-4 dshx:text-warning" /> No digest yet
                  </span>
                  <p className="dshx:text-xs dshx:text-muted-foreground">
                    Memory digests a thread once it has been idle for a minute. You can write the digest now if you do not want to wait.
                  </p>
                  <Button size="sm" variant="outline" className="dshx:w-fit" onClick={() => redigest.mutate(selected.id)} disabled={redigest.isPending}>
                    <RefreshCwIcon className={redigest.isPending ? 'dshx:animate-spin' : undefined} /> Write digest now
                  </Button>
                  {redigest.isError ? <p className="dshx:text-xs dshx:text-destructive">{errorMessage(redigest.error, 'The digest failed.')}</p> : null}
                </div>
              )}
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
