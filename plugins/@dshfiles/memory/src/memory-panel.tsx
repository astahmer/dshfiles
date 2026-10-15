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

import { memoryApi, type MemoryCitation, type MemoryNoteType, type MemoryUsage, type PanelNote, type PanelThread } from './api.ts'
import { useNoteEditor } from './use-note-editor.js'

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
  const note = props.note
  const { snapshot, send } = useNoteEditor(note)
  const mode =
    snapshot.matches('editing') || snapshot.matches('saving')
      ? 'edit'
      : snapshot.matches('forgetting') || snapshot.matches('forgettingPending')
        ? 'forget'
        : 'view'
  const { draft, preview, failure } = snapshot.context
  const { text, type, scope, reason } = draft
  const pending = snapshot.matches('saving') || snapshot.matches('forgettingPending')
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
              onChange={event => send({ type: 'type.change', value: noteTypeOf(event.currentTarget.value) ?? note.type })}
            >
              {noteTypes.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <Input
              aria-label="Edit note scope"
              value={scope}
              onChange={event => send({ type: 'scope.change', value: event.currentTarget.value })}
              className="dshx:h-8 dshx:max-w-48"
            />
            <Button size="xs" variant="ghost" aria-pressed={preview} onClick={() => send({ type: 'preview.toggle' })}>
              {preview ? 'Edit text' : 'Preview'}
            </Button>
          </div>
          {preview ? (
            <MarkdownText text={text} labels={markdownLabels} variant="compact" />
          ) : (
            <Textarea aria-label="Note text" value={text} onChange={event => send({ type: 'text.change', value: event.currentTarget.value })} rows={4} />
          )}
        </div>
      ) : (
        <MarkdownText text={note.text} labels={markdownLabels} variant="compact" />
      )}
      {note.reason !== null && note.status !== 'valid' ? <p className="dshx:text-xs dshx:text-muted-foreground">Reason: {note.reason}</p> : null}
      {mode === 'view' ? (
        note.status === 'valid' ? (
          <div className="dshx:flex dshx:gap-1">
            <Button size="xs" variant="outline" onClick={() => send({ type: 'edit' })}>
              Edit
            </Button>
            <Button size="xs" variant="outline" onClick={() => send({ type: 'forget' })}>
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
            onChange={event => send({ type: 'reason.change', value: event.currentTarget.value })}
            className="dshx:h-8 dshx:max-w-80"
          />
          <Button
            size="xs"
            variant={mode === 'forget' ? 'destructive' : 'default'}
            disabled={(mode === 'edit' && text.trim().length === 0) || pending}
            onClick={() => send({ type: mode === 'edit' ? 'save' : 'forget.confirm' })}
          >
            {mode === 'edit' ? 'Save note' : 'Forget note'}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => send({ type: 'cancel' })}>
            Cancel
          </Button>
        </div>
      )}
      {failure ? <p className="dshx:text-xs dshx:text-destructive">{failure}</p> : null}
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

const usd = (value: number | null): string => (value === null ? 'unpriced' : `$${value.toFixed(value < 0.01 ? 4 : 2)}`)
const count = (value: number): string => new Intl.NumberFormat().format(value)

const Section = (props: { readonly title: string; readonly note?: string; readonly children: ReactNode }): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:rounded-lg dshx:border dshx:border-border dshx:px-4 dshx:py-2">
    <h3 className="dshx:pt-1 dshx:text-sm dshx:font-semibold">{props.title}</h3>
    {props.note ? <p className="dshx:text-xs dshx:text-muted-foreground">{props.note}</p> : null}
    <div className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">{props.children}</div>
  </section>
)

const DayTable = (props: { readonly label: string; readonly headings: readonly string[]; readonly rows: readonly (readonly string[])[] }): JSX.Element => (
  <table className="dshx:w-full dshx:text-sm" aria-label={props.label}>
    <thead className="dshx:text-xs dshx:text-muted-foreground">
      <tr>
        {props.headings.map(heading => (
          <th key={heading} className="dshx:py-1 dshx:text-left dshx:font-medium">
            {heading}
          </th>
        ))}
      </tr>
    </thead>
    <tbody className="dshx:font-mono dshx:tabular-nums">
      {props.rows.map(row => (
        <tr key={row[0]} className="dshx:border-t dshx:border-border">
          {row.map((cell, index) => (
            <td key={props.headings[index]} className="dshx:py-1">
              {cell}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
)

const CitationRow = (props: { readonly citation: MemoryCitation; readonly openThread: OpenThread }): JSX.Element => {
  const api = useApi(memoryApi)
  const client = useQueryClient()
  const citation = props.citation
  const rate = useMutation({
    mutationFn: (rating: 'up' | 'down' | null) => api.rateCitation({ id: citation.id, rating }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['dshfiles-memory'] }),
  })
  const toggle = (rating: 'up' | 'down'): void => rate.mutate(citation.rating === rating ? null : rating)
  return (
    <li className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:py-1.5 dshx:text-xs">
      <span className="dshx:font-mono">{citation.ref.replace(/^t:session-/, 't:').slice(0, 10)}</span>
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{citation.target ?? 'no longer in memory'}</span>
      <span className="dshx:text-muted-foreground">cited in</span>
      <ThreadLink id={citation.thread} openThread={props.openThread} />
      <span className="dshx:text-muted-foreground">{stamp(citation.at)}</span>
      {citation.agentCorrected ? <Badge variant="secondary">agent revised (heuristic)</Badge> : null}
      {citation.userCorrected ? <Badge variant="secondary">user corrected (heuristic)</Badge> : null}
      <Button
        size="xs"
        variant={citation.rating === 'up' ? 'default' : 'ghost'}
        aria-pressed={citation.rating === 'up'}
        aria-label="Useful"
        onClick={() => toggle('up')}
      >
        👍
      </Button>
      <Button
        size="xs"
        variant={citation.rating === 'down' ? 'default' : 'ghost'}
        aria-pressed={citation.rating === 'down'}
        aria-label="Not useful"
        onClick={() => toggle('down')}
      >
        👎
      </Button>
    </li>
  )
}

const UsageTab = (props: { readonly usage: MemoryUsage | undefined; readonly openThread: OpenThread }): JSX.Element => {
  const api = useApi(memoryApi)
  const citations = useQuery({ queryKey: ['dshfiles-memory', 'citations'], queryFn: ({ signal }) => api.citations(undefined, { signal }) })
  const usage = props.usage
  if (usage === undefined) return <Empty>Loading usage…</Empty>
  const tool = (name: string) => usage.tools.find(item => item.tool === name) ?? { calls: 0, withResults: 0, empty: 0, used: 0 }
  const search = tool('memory_search')
  const read = tool('memory_read')
  const total = usage.costs.total
  const effectiveness = usage.effectiveness
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-4">
      {usage.state !== 'ready' ? (
        <p className="dshx:text-xs dshx:text-warning">
          Memory is {usage.state}
          {usage.failure ? `: ${usage.failure}` : ''}.
        </p>
      ) : null}
      <Section
        title="Cost"
        note="Memory's own calls at list price (digests on the thread's cheap route, Jev at $0.042 per million input tokens). Last 30 days."
      >
        <Stat
          label="Digest calls"
          value={count(total.digest.calls)}
          hint={`${count(total.digest.input)} input, ${count(total.digest.cacheRead)} cached, ${count(total.digest.output)} output tokens`}
        />
        <Stat label="Digest cost" value={usd(total.digest.usd)} />
        <Stat label="Jev calls" value={count(total.jev.calls)} hint={`${count(total.jev.input)} input tokens · ${usd(total.jev.usd)}`} />
        <DayTable
          label="Memory cost per day"
          headings={['Day', 'Digests', 'Digest $', 'Jev', 'Jev $']}
          rows={usage.costs.days.map(day => [day.day, count(day.digest.calls), usd(day.digest.usd), count(day.jev.calls), usd(day.jev.usd)])}
        />
      </Section>
      <Section title="Start block">
        <Stat
          label="Threads that started with a block"
          value={count(effectiveness.block.threads)}
          hint={`${count(usage.blocksServed)} blocks frozen in total, empty ones included`}
        />
        <Stat label="Block size" value={`${count(effectiveness.block.meanBytes)} B`} hint={`mean; largest ${count(effectiveness.block.maxBytes)} B`} />
        <Stat label="Model requests that carried it" value={count(effectiveness.block.requests)} />
      </Section>
      <Section title="Recall" note="A call counts as used when a reply cites one of its ids (memory: <id>).">
        <Stat
          label="memory_search"
          value={`${count(search.calls)} calls`}
          hint={`${count(search.withResults)} with hits, ${count(search.empty)} empty, ${count(search.used)} cited`}
        />
        <Stat
          label="memory_read"
          value={`${count(read.calls)} calls`}
          hint={`${count(read.withResults)} found, ${count(read.empty)} missing, ${count(read.used)} cited`}
        />
        <Stat label="Citations" value={count(usage.citations)} />
      </Section>
      <Section
        title="Correctness"
        note="Heuristics: a later reply in the same thread revises itself (agent), or the user's next message is a correction (user), within 30 minutes of a citation. Ratings are yours."
      >
        <Stat label="Cited memories" value={count(effectiveness.citations.total)} />
        <Stat label="Revised by the agent (heuristic)" value={count(effectiveness.citations.agentCorrected)} />
        <Stat label="Corrected by the user (heuristic)" value={count(effectiveness.citations.userCorrected)} />
        <Stat label="Rated" value={`👍 ${count(effectiveness.citations.up)} · 👎 ${count(effectiveness.citations.down)}`} />
        {(citations.data ?? []).length === 0 ? null : (
          <ul className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border" aria-label="Recent citations">
            {(citations.data ?? []).map(citation => (
              <CitationRow key={citation.id} citation={citation} openThread={props.openThread} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Activity per day">
        <DayTable
          label="Memory usage per day"
          headings={['Day', 'Searches', 'Reads', 'Note writes', 'Cited calls', 'Citations']}
          rows={usage.daily.map(day => [day.day, count(day.searches), count(day.reads), count(day.notes), count(day.cited), count(day.citations)])}
        />
        {usage.daily.length === 0 ? <Empty>No memory activity in the last 30 days.</Empty> : null}
      </Section>
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
          {usage.data === undefined ? null : (
            <Badge variant="outline" title={usage.data.retrieval.reason ?? undefined}>
              {usage.data.retrieval.active === 'hybrid'
                ? `Retrieval: hybrid (${usage.data.retrieval.model ?? 'embeddings'})`
                : usage.data.retrieval.requested === 'hybrid'
                  ? 'Retrieval: BM25 (hybrid unavailable)'
                  : 'Retrieval: BM25'}
            </Badge>
          )}
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
            <UsageTab usage={usage.data} openThread={props.openThread} />
          </TabsContent>
        </div>
      </Tabs>
    </main>
  )
}
