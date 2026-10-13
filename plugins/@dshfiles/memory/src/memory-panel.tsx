import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'

import { memoryApi, type MemoryNoteType, type MemoryUsage, type PanelNote, type PanelThread } from './api.ts'

const noteTypes: readonly { readonly value: MemoryNoteType; readonly label: string; readonly hint: string }[] = [
  { value: 'feedback', label: 'Feedback', hint: 'Corrections and confirmed approaches' },
  { value: 'project', label: 'Project', hint: 'Decisions and context not in the code' },
  { value: 'user', label: 'User', hint: 'Who the user is and what they prefer' },
  { value: 'reference', label: 'Reference', hint: 'Pointers to external resources' },
]

const originLabels = {
  'user-requested': 'user asked to remember',
  agent: 'agent note',
  panel: 'edited in this panel',
} satisfies Record<PanelNote['origin'], string>

/** The note type a `<select>` value names, or undefined for "all types". */
const noteTypeOf = (value: string): MemoryNoteType | undefined => noteTypes.find(item => item.value === value)?.value

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

const selectClass =
  'dshx:h-8 dshx:max-w-72 dshx:truncate dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-sm dshx:text-foreground'

const projectName = (project: string): string => project.split('/').filter(Boolean).at(-1) ?? project
const stamp = (time: number): string => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const shortThread = (id: string): string => id.replace(/^session-/, '').slice(0, 8)

type OpenThread = (sessionId: string) => void

const Empty = (props: { readonly children: ReactNode }): JSX.Element => (
  <p className="dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">{props.children}</p>
)

const ThreadLink = (props: { readonly id: string; readonly seq?: number | null | undefined; readonly openThread: OpenThread }): JSX.Element => (
  <Button variant="link" size="xs" className="dshx:h-auto dshx:p-0 dshx:font-mono" title="Open the thread" onClick={() => props.openThread(props.id)}>
    t:{shortThread(props.id)}
    {props.seq === null || props.seq === undefined ? '' : ` #${props.seq}`}
  </Button>
)

/** Where a note came from and when, shown on every entry. */
const NoteSource = (props: { readonly note: PanelNote; readonly openThread: OpenThread }): JSX.Element => {
  const note = props.note
  return (
    <dl className="dshx:grid dshx:grid-cols-[auto_1fr] dshx:gap-x-3 dshx:gap-y-0.5 dshx:text-xs" aria-label={`Source of n:${note.id}`}>
      <dt className="dshx:text-muted-foreground">Project</dt>
      <dd title={note.project}>{projectName(note.project)}</dd>
      <dt className="dshx:text-muted-foreground">From</dt>
      <dd className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
        {note.sourceThread === null ? <span>no thread</span> : <ThreadLink id={note.sourceThread} seq={note.sourceSeq} openThread={props.openThread} />}
        <span className="dshx:text-muted-foreground">· {originLabels[note.origin]}</span>
      </dd>
      <dt className="dshx:text-muted-foreground">Created</dt>
      <dd>{stamp(note.createdAt)}</dd>
      {note.updatedAt !== note.createdAt ? (
        <>
          <dt className="dshx:text-muted-foreground">Updated</dt>
          <dd>{stamp(note.updatedAt)}</dd>
        </>
      ) : null}
    </dl>
  )
}

/** One note, editable in place: text with an edit/preview toggle, type and scope; forget with an optional reason. */
const NoteEditor = (props: { readonly note: PanelNote; readonly openThread: OpenThread; readonly onSelect?: () => void }): JSX.Element => {
  const api = useApi(memoryApi)
  const client = useQueryClient()
  const note = props.note
  const [mode, setMode] = useState<'view' | 'edit' | 'forget'>('view')
  const [preview, setPreview] = useState(false)
  const [text, setText] = useState(note.text)
  const [type, setType] = useState<MemoryNoteType>(note.type)
  const [scope, setScope] = useState(note.scope)
  const [reason, setReason] = useState('')
  const refresh = (): void => void client.invalidateQueries({ queryKey: ['dshfiles-memory'] })
  const save = useMutation({
    mutationFn: () => api.editNote({ id: note.id, text, type, scope, reason }),
    onSuccess: () => (setMode('view'), refresh()),
  })
  const forget = useMutation({
    mutationFn: () => api.forgetNote({ id: note.id, reason }),
    onSuccess: () => (setMode('view'), refresh()),
  })
  const startEdit = (): void => {
    setText(note.text)
    setType(note.type)
    setScope(note.scope)
    setReason('')
    setPreview(false)
    setMode('edit')
  }
  const failure = save.error ?? forget.error
  return (
    <article className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3" aria-label={`Note n:${note.id}`}>
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs">
        <button
          type="button"
          className="dshx:font-mono dshx:text-muted-foreground dshx:hover:underline"
          onClick={props.onSelect}
          disabled={props.onSelect === undefined}
        >
          n:{note.id}
        </button>
        <Badge variant="outline">{note.type}</Badge>
        <Badge variant="outline">{note.scope}</Badge>
        {note.confidence === 'inferred' ? <Badge variant="outline">inferred</Badge> : null}
        {note.status !== 'valid' ? <Badge variant="secondary">{note.status}</Badge> : null}
        <span className="dshx:text-muted-foreground">
          {note.citations} citation{note.citations === 1 ? '' : 's'}
        </span>
      </header>
      <NoteSource note={note} openThread={props.openThread} />
      {mode === 'edit' ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <select
              aria-label="Edit note type"
              className={selectClass}
              value={type}
              onChange={event => setType(noteTypeOf(event.currentTarget.value) ?? note.type)}
            >
              {noteTypes.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <Input aria-label="Edit note scope" value={scope} onChange={event => setScope(event.currentTarget.value)} className="dshx:h-8 dshx:max-w-48" />
            <Button size="xs" variant="ghost" aria-pressed={preview} onClick={() => setPreview(!preview)}>
              {preview ? 'Edit text' : 'Preview'}
            </Button>
          </div>
          {preview ? (
            <MarkdownText text={text} labels={markdownLabels} variant="compact" />
          ) : (
            <Textarea aria-label="Note text" value={text} onChange={event => setText(event.currentTarget.value)} rows={4} />
          )}
        </div>
      ) : (
        <MarkdownText text={note.text} labels={markdownLabels} variant="compact" />
      )}
      {note.reason !== null && note.status !== 'valid' ? <p className="dshx:text-xs dshx:text-muted-foreground">Reason: {note.reason}</p> : null}
      {mode === 'view' ? (
        note.status === 'valid' ? (
          <div className="dshx:flex dshx:gap-1">
            <Button size="xs" variant="outline" onClick={startEdit}>
              Edit
            </Button>
            <Button size="xs" variant="outline" onClick={() => (setReason(''), setMode('forget'))}>
              Forget
            </Button>
          </div>
        ) : null
      ) : (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <Input
            aria-label="Reason"
            placeholder="Reason (optional)"
            value={reason}
            onChange={event => setReason(event.currentTarget.value)}
            className="dshx:h-8 dshx:max-w-80"
          />
          <Button
            size="xs"
            variant={mode === 'forget' ? 'destructive' : 'default'}
            disabled={(mode === 'edit' && text.trim().length === 0) || save.isPending || forget.isPending}
            onClick={() => (mode === 'edit' ? save.mutate() : forget.mutate())}
          >
            {mode === 'edit' ? 'Save note' : 'Forget note'}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setMode('view')}>
            Cancel
          </Button>
        </div>
      )}
      {failure ? <p className="dshx:text-xs dshx:text-destructive">{errorMessage(failure, 'The change failed.')}</p> : null}
    </article>
  )
}

const NoteDetail = (props: { readonly note: PanelNote; readonly openThread: OpenThread; readonly close: () => void }): JSX.Element => {
  const api = useApi(memoryApi)
  const history = useQuery({
    queryKey: ['dshfiles-memory', 'history', props.note.id],
    queryFn: ({ signal }) => api.noteHistory({ id: props.note.id }, { signal }),
  })
  const versions = history.data ?? []
  return (
    <aside className="dshx:flex dshx:flex-col dshx:gap-3" aria-label="Note detail">
      <div className="dshx:flex dshx:items-center dshx:justify-between">
        <h3 className="dshx:text-sm dshx:font-semibold">Note n:{props.note.id}</h3>
        <Button size="xs" variant="ghost" onClick={props.close}>
          Close
        </Button>
      </div>
      <NoteEditor note={props.note} openThread={props.openThread} />
      <section className="dshx:flex dshx:flex-col dshx:gap-2">
        <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">History</h4>
        {versions.length <= 1 ? <p className="dshx:text-xs dshx:text-muted-foreground">No earlier versions.</p> : null}
        <ol className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-l dshx:border-border dshx:pl-3" aria-label="Note history">
          {versions.length <= 1
            ? null
            : versions.map(version => (
                <li
                  key={version.id}
                  className={cn(
                    'dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs',
                    version.id === props.note.id ? 'dshx:font-medium' : 'dshx:text-muted-foreground',
                  )}
                >
                  <span>
                    <span className="dshx:font-mono">n:{version.id}</span> · {stamp(version.updatedAt)} · {version.status} · {originLabels[version.origin]}
                    {version.reason !== null ? ` · ${version.reason}` : ''}
                  </span>
                  <MarkdownText text={version.text} labels={markdownLabels} variant="compact" />
                </li>
              ))}
        </ol>
      </section>
    </aside>
  )
}

const NotesTab = (props: { readonly project: string | undefined; readonly openThread: OpenThread }): JSX.Element => {
  const api = useApi(memoryApi)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<MemoryNoteType | ''>('')
  const [scope, setScope] = useState('')
  const [includeInvalid, setIncludeInvalid] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const debounced = useDebouncedValue({ value: query, delayMs: 250 })
  const notes = useQuery({
    queryKey: ['dshfiles-memory', 'notes', props.project, debounced, type, scope, includeInvalid],
    queryFn: ({ signal }) => api.notes({ project: props.project ?? '', query: debounced, type, scope, includeInvalid }, { signal }),
  })
  const list = notes.data ?? []
  const selected = list.find(note => note.id === selectedId)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Input
          aria-label="Search notes"
          placeholder="Search notes"
          value={query}
          onChange={event => setQuery(event.currentTarget.value)}
          className="dshx:h-8 dshx:max-w-72"
        />
        <select aria-label="Note type" className={selectClass} value={type} onChange={event => setType(noteTypeOf(event.currentTarget.value) ?? '')}>
          <option value="">All types</option>
          {noteTypes.map(item => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select aria-label="Note scope" className={selectClass} value={scope} onChange={event => setScope(event.currentTarget.value)}>
          <option value="">All scopes</option>
          <option value="repo">repo</option>
          <option value="global">global</option>
        </select>
        <label className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
          <input type="checkbox" checked={includeInvalid} onChange={event => setIncludeInvalid(event.currentTarget.checked)} />
          Show superseded and forgotten
        </label>
      </div>
      {notes.isError ? <p className="dshx:text-xs dshx:text-destructive">{errorMessage(notes.error, 'Notes are unavailable.')}</p> : null}
      {notes.isSuccess && list.length === 0 ? <Empty>No notes yet. Agents add them with memory_note when you correct or decide something.</Empty> : null}
      <div className={cn('dshx:grid dshx:gap-4', selected === undefined ? 'dshx:grid-cols-1' : 'dshx:grid-cols-1 dshx:lg:grid-cols-2')}>
        <div className="dshx:flex dshx:flex-col dshx:gap-4">
          {noteTypes.map(item => {
            const group = list.filter(note => note.type === item.value)
            if (group.length === 0) return null
            return (
              <section key={item.value} className="dshx:flex dshx:flex-col dshx:gap-2">
                <h3 className="dshx:text-sm dshx:font-semibold">
                  {item.label} <span className="dshx:font-normal dshx:text-muted-foreground">· {item.hint}</span>
                </h3>
                {group.map(note => (
                  <NoteEditor key={`${note.id}:${note.updatedAt}`} note={note} openThread={props.openThread} onSelect={() => setSelectedId(note.id)} />
                ))}
              </section>
            )
          })}
        </div>
        {selected === undefined ? null : <NoteDetail key={selected.id} note={selected} openThread={props.openThread} close={() => setSelectedId(null)} />}
      </div>
    </div>
  )
}

const ThreadRow = (props: { readonly thread: PanelThread; readonly openThread: OpenThread }): JSX.Element => {
  const [open, setOpen] = useState(false)
  const thread = props.thread
  return (
    <li className="dshx:flex dshx:flex-col dshx:gap-1 dshx:py-2">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-sm">
        <ThreadLink id={thread.id} openThread={props.openThread} />
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{thread.title}</span>
        {thread.citations > 0 ? <Badge variant="outline">{thread.citations} cited</Badge> : null}
        <Button size="xs" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide digest' : 'Digest'}
        </Button>
      </div>
      <p className="dshx:text-xs dshx:text-muted-foreground">
        {projectName(thread.project)} · last activity {stamp(thread.updatedAt)} · digested {stamp(thread.digestedAt)} ·{' '}
        {thread.source === 'model' ? 'written by a cheap model' : 'from the thread record'}
      </p>
      <p className="dshx:text-xs">{thread.decision}</p>
      {open ? (
        <div className="dshx:rounded-md dshx:bg-muted dshx:p-2">
          <MarkdownText text={thread.digest} labels={markdownLabels} variant="compact" />
        </div>
      ) : null}
    </li>
  )
}

const ThreadsTab = (props: { readonly project: string | undefined; readonly openThread: OpenThread }): JSX.Element => {
  const api = useApi(memoryApi)
  const threads = useQuery({
    queryKey: ['dshfiles-memory', 'threads', props.project],
    queryFn: ({ signal }) => api.threads({ project: props.project ?? '' }, { signal }),
  })
  const list = threads.data ?? []
  const projects = [...new Set(list.map(thread => thread.project))]
  if (threads.isError) return <p className="dshx:text-xs dshx:text-destructive">{errorMessage(threads.error, 'Threads are unavailable.')}</p>
  if (threads.isSuccess && list.length === 0) return <Empty>No thread digests yet. A thread is digested once it has been idle for a minute.</Empty>
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-4">
      {projects.map(project => (
        <section key={project} className="dshx:flex dshx:flex-col">
          <h3 className="dshx:text-sm dshx:font-semibold" title={project}>
            {projectName(project)}
          </h3>
          <ul className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
            {list
              .filter(thread => thread.project === project)
              .map(thread => (
                <ThreadRow key={thread.id} thread={thread} openThread={props.openThread} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

const Stat = (props: { readonly label: string; readonly value: number | string; readonly hint?: string }): JSX.Element => (
  <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-4 dshx:py-2">
    <div className="dshx:flex dshx:flex-col">
      <span className="dshx:text-sm">{props.label}</span>
      {props.hint ? <span className="dshx:text-xs dshx:text-muted-foreground">{props.hint}</span> : null}
    </div>
    <span className="dshx:font-mono dshx:text-sm dshx:tabular-nums">{props.value}</span>
  </div>
)

const UsageTab = (props: { readonly usage: MemoryUsage | undefined }): JSX.Element => {
  const usage = props.usage
  if (usage === undefined) return <Empty>Loading usage…</Empty>
  const calls = usage.tools.reduce((total, tool) => total + tool.calls, 0)
  const cited = usage.tools.reduce((total, tool) => total + tool.used, 0)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-4">
      {usage.state !== 'ready' ? (
        <p className="dshx:text-xs dshx:text-warning">
          Memory is {usage.state}
          {usage.failure ? `: ${usage.failure}` : ''}.
        </p>
      ) : null}
      <section className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border dshx:rounded-lg dshx:border dshx:border-border dshx:px-4">
        <Stat
          label="Thread digests"
          value={usage.threads}
          hint={`${usage.digests.trail} from the thread record, ${usage.digests.model} by a model, ${usage.digests.trivial} trivial threads skipped`}
        />
        <Stat label="Notes" value={usage.notes} />
        <Stat label="Indexed messages" value={usage.indexedMessages} hint="Index only; the text stays in DSH's session logs." />
        <Stat label="Start blocks served" value={usage.blocksServed} />
        <Stat label="Memory tool calls" value={calls} hint={`${cited} cited in a reply (memory: <id>)`} />
        <Stat label="Citations" value={usage.citations} />
        {usage.jev.calls + usage.jev.failures > 0 ? (
          <Stat label="Jev calls" value={usage.jev.calls} hint={`${usage.jev.inputTokens} input tokens, ${usage.jev.failures} failures`} />
        ) : null}
      </section>
      <table className="dshx:w-full dshx:text-sm" aria-label="Memory usage per day">
        <thead className="dshx:text-xs dshx:text-muted-foreground">
          <tr>
            {['Day', 'Searches', 'Reads', 'Note writes', 'Cited calls', 'Citations'].map(heading => (
              <th key={heading} className="dshx:py-1 dshx:text-left dshx:font-medium">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="dshx:font-mono dshx:tabular-nums">
          {usage.daily.map(day => (
            <tr key={day.day} className="dshx:border-t dshx:border-border">
              <td className="dshx:py-1">{day.day}</td>
              <td>{day.searches}</td>
              <td>{day.reads}</td>
              <td>{day.notes}</td>
              <td>{day.cited}</td>
              <td>{day.citations}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {usage.daily.length === 0 ? <Empty>No memory activity in the last 30 days.</Empty> : null}
    </div>
  )
}

export const MemoryPanel = (props: { readonly openThread: OpenThread }): JSX.Element => {
  const api = useApi(memoryApi)
  const [project, setProject] = useState('')
  const projects = useQuery({ queryKey: ['dshfiles-memory', 'projects'], queryFn: ({ signal }) => api.projects(undefined, { signal }) })
  const usage = useQuery({
    queryKey: ['dshfiles-memory', 'usage'],
    queryFn: ({ signal }) => api.usage(undefined, { signal }),
    refetchInterval: 10_000,
    retry: false,
  })
  const selected = project === '' ? undefined : project
  return (
    <main className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background dshx:text-foreground">
      <Tabs defaultValue="notes" className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
        <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3">
          <h2 className="dshx:text-base dshx:font-semibold">Memory</h2>
          <select aria-label="Memory project" className={selectClass} value={project} onChange={event => setProject(event.currentTarget.value)}>
            <option value="">All projects</option>
            {(projects.data ?? []).map(item => (
              <option key={item.project} value={item.project}>
                {projectName(item.project)} · {item.threads} threads · {item.notes} notes
              </option>
            ))}
          </select>
          <span className="dshx:flex-1" />
          <TabsList aria-label="Memory views">
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="threads">Threads</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>
        </header>
        <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:px-4 dshx:py-3">
          <TabsContent value="notes">
            <NotesTab project={selected} openThread={props.openThread} />
          </TabsContent>
          <TabsContent value="threads">
            <ThreadsTab project={selected} openThread={props.openThread} />
          </TabsContent>
          <TabsContent value="usage">
            <UsageTab usage={usage.data} />
          </TabsContent>
        </div>
      </Tabs>
    </main>
  )
}
