import { MarkdownText, writeClipboard, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  CopyIcon,
  LayoutGridIcon,
  ListIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  QuoteIcon,
  SearchIcon,
  SquareCheckBigIcon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { memoryApi, type MemoryNoteType, type PanelNote } from './api.ts'
import { noteStatusBadge, noteStatusLabels, originLabels, originShortLabels, PanelFormat } from './panel-format.ts'
import { NoteSelectionModel } from './note-selection.js'
import { useNoteEditor } from './use-note-editor.js'

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

const noteTypeOptions: readonly { readonly value: MemoryNoteType | ''; readonly label: string }[] = [
  { value: '', label: 'All types' },
  ...PanelFormat.noteToneList().map(tone => ({ value: tone.value, label: tone.label })),
]

export type NoteTypeFilter = MemoryNoteType | ''
export type NoteStatusFilter = 'all' | PanelNote['status']
export type NoteOriginFilter = '' | PanelNote['origin']
export type NoteSort = 'newest' | 'oldest' | 'cited'

const noteTypeOf = (value: string): NoteTypeFilter => PanelFormat.noteToneList().find(tone => tone.value === value)?.value ?? ''
const noteStatusOf = (value: string): NoteStatusFilter =>
  value === 'superseded' || value === 'forgotten' || value === 'valid' || value === 'all' ? value : 'all'
const noteOriginOf = (value: string): NoteOriginFilter => (value === 'user-requested' || value === 'agent' || value === 'panel' || value === '' ? value : '')
const noteSortOf = (value: string): NoteSort => (value === 'oldest' || value === 'cited' || value === 'newest' ? value : 'newest')

const filterTrigger =
  'dshx:h-7 dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-transparent dshx:px-2.5 dshx:text-xs dshx:font-normal dshx:shadow-none'

const filterSelect = (props: {
  readonly label: string
  readonly value: string
  readonly display?: string
  readonly onChange: (value: string) => void
  readonly children: ReactNode
}): JSX.Element => (
  <Select value={props.value} onValueChange={props.onChange}>
    <SelectTrigger aria-label={props.label} className={filterTrigger} size="sm">
      <SelectValue>{props.display}</SelectValue>
      <ChevronDownIcon className="dshx:size-3 dshx:opacity-60" />
    </SelectTrigger>
    <SelectContent align="start">{props.children}</SelectContent>
  </Select>
)

const NoteRow = (props: {
  readonly note: PanelNote
  readonly selected: boolean
  readonly selectMode: boolean
  readonly checked: boolean
  readonly onOpen: () => void
  readonly onToggle: (event: React.MouseEvent) => void
  readonly onRange: (event: React.MouseEvent) => void
}): JSX.Element => {
  const tone = PanelFormat.noteToneOf(props.note.type)
  const { title, body } = PanelFormat.splitNoteText(props.note.text)
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
        'dshx:group dshx:flex dshx:cursor-pointer dshx:items-start dshx:gap-3 dshx:px-4 dshx:py-3 dshx:outline-none',
        'dshx:hover:bg-accent/40 dshx:focus-visible:bg-accent/50',
        props.selected && 'dshx:bg-accent/55 dshx:hover:bg-accent/60',
      )}
    >
      {props.selectMode ? (
        <input
          type="checkbox"
          aria-label={`Select n:${props.note.id}`}
          checked={props.checked}
          onClick={event => {
            event.stopPropagation()
            if (event.shiftKey) props.onRange(event)
            else props.onToggle(event)
          }}
          onChange={() => undefined}
          className="dshx:mt-2 dshx:size-3.5 dshx:shrink-0 dshx:accent-[var(--color-info)]"
        />
      ) : null}
      <span className={cn('dshx:mt-0.5 dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl', tone.iconTile)}>
        <tone.Icon className="dshx:size-[18px]" />
      </span>
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
        <span className="dshx:line-clamp-2 dshx:text-[13px] dshx:font-medium dshx:leading-snug">{title}</span>
        {body.length === 0 ? null : <span className="dshx:line-clamp-2 dshx:text-xs dshx:leading-snug dshx:text-muted-foreground">{body}</span>}
      </span>
      <span className="dshx:flex dshx:w-24 dshx:shrink-0 dshx:flex-col dshx:items-end dshx:gap-0.5 dshx:text-[11px] dshx:text-muted-foreground">
        <span className={cn('dshx:font-medium', tone.accent)}>{tone.label}</span>
        <span title={props.note.project}>{PanelFormat.projectName(props.note.project)}</span>
        <span className="dshx:tabular-nums">{PanelFormat.formatDay(props.note.updatedAt)}</span>
        <span className="dshx:flex dshx:items-center dshx:gap-0.5">
          <QuoteIcon className="dshx:size-2.5" />
          {props.note.citations}
        </span>
        {props.note.status === 'valid' ? null : (
          <span className={cn('dshx:mt-0.5 dshx:rounded-full dshx:px-1.5 dshx:py-px dshx:text-[10px]', noteStatusBadge[props.note.status])}>
            {noteStatusLabels[props.note.status]}
          </span>
        )}
      </span>
    </div>
  )
}

const NoteGridCard = (props: { readonly note: PanelNote; readonly selected: boolean; readonly onOpen: () => void }): JSX.Element => {
  const tone = PanelFormat.noteToneOf(props.note.type)
  const { title, body } = PanelFormat.splitNoteText(props.note.text)
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className={cn(
        'dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:p-3 dshx:text-left dshx:transition-colors',
        'dshx:hover:border-foreground/20 dshx:hover:bg-accent/30',
        props.selected && 'dshx:border-info/40 dshx:bg-accent/50',
      )}
    >
      <span className="dshx:flex dshx:items-center dshx:gap-2">
        <span className={cn('dshx:flex dshx:size-7 dshx:items-center dshx:justify-center dshx:rounded-lg', tone.iconTile)}>
          <tone.Icon className="dshx:size-4" />
        </span>
        <span className={cn('dshx:text-[11px] dshx:font-medium', tone.accent)}>{tone.label}</span>
        <span className="dshx:ml-auto dshx:text-[11px] dshx:text-muted-foreground">{PanelFormat.formatDay(props.note.updatedAt)}</span>
      </span>
      <span className="dshx:line-clamp-2 dshx:text-[13px] dshx:font-medium dshx:leading-snug">{title}</span>
      {body.length === 0 ? null : <span className="dshx:line-clamp-3 dshx:text-xs dshx:leading-snug dshx:text-muted-foreground">{body}</span>}
      <span className="dshx:mt-auto dshx:flex dshx:items-center dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
        <span>{PanelFormat.projectName(props.note.project)}</span>
        <span>·</span>
        <span className="dshx:flex dshx:items-center dshx:gap-0.5">
          <QuoteIcon className="dshx:size-2.5" />
          {props.note.citations}
        </span>
      </span>
    </button>
  )
}

const NoteEditorForm = (props: { readonly note: PanelNote; readonly editor: ReturnType<typeof useNoteEditor> }): JSX.Element | null => {
  const { snapshot, send } = props.editor
  const editing = snapshot.matches('editing') || snapshot.matches('saving')
  const forgetting = snapshot.matches('forgetting') || snapshot.matches('forgettingPending')
  if (!editing && !forgetting) return null
  const { draft, preview, failure } = snapshot.context
  const pending = snapshot.matches('saving') || snapshot.matches('forgettingPending')
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:p-3">
      <div className="dshx:flex dshx:flex-wrap items-center dshx:gap-2">
        <Combobox
          label="Edit note type"
          matchTriggerWidth
          onValueChange={value => send({ type: 'type.change', value: noteTypeOf(value) || 'project' })}
          options={PanelFormat.noteToneList().map(tone => ({ value: tone.value, label: tone.label }))}
          value={draft.type}
        />
        <Input
          aria-label="Edit note scope"
          value={draft.scope}
          onChange={event => send({ type: 'scope.change', value: event.currentTarget.value })}
          className="dshx:h-8 dshx:max-w-48"
        />
        <Button size="xs" variant="ghost" aria-pressed={preview} onClick={() => send({ type: 'preview.toggle' })}>
          {preview ? 'Edit text' : 'Preview'}
        </Button>
      </div>
      {preview ? (
        <MarkdownText text={draft.text} labels={markdownLabels} variant="compact" />
      ) : (
        <Textarea aria-label="Note text" value={draft.text} onChange={event => send({ type: 'text.change', value: event.currentTarget.value })} rows={4} />
      )}
      {forgetting ? (
        <Input
          aria-label="Reason"
          placeholder="Reason (optional)"
          value={draft.reason}
          onChange={event => send({ type: 'reason.change', value: event.currentTarget.value })}
          className="dshx:h-8"
        />
      ) : null}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Button
          size="xs"
          variant={forgetting ? 'destructive' : 'default'}
          disabled={pending || (editing && draft.text.trim().length === 0)}
          onClick={() => send({ type: editing ? 'save' : 'forget.confirm' })}
        >
          {editing ? 'Save note' : 'Forget note'}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => send({ type: 'cancel' })}>
          Cancel
        </Button>
      </div>
      {failure ? <p className="dshx:text-xs dshx:text-destructive">{failure}</p> : null}
    </div>
  )
}

const RelatedNotes = (props: {
  readonly note: PanelNote
  readonly notes: readonly PanelNote[]
  readonly onSelect: (id: number) => void
}): JSX.Element | null => {
  const related = useMemo(() => {
    const linked = new Set<number>([props.note.supersedes, props.note.supersededBy].filter((id): id is number => id !== null))
    const wordsOf = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{3,}/gu) ?? [])
    const ownWords = wordsOf(props.note.text)
    const scored = props.notes
      .filter(candidate => candidate.id !== props.note.id)
      .map(candidate => {
        if (linked.has(candidate.id)) return { candidate, score: 3, overlap: 99 }
        if (props.note.sourceThread !== null && candidate.sourceThread === props.note.sourceThread) return { candidate, score: 2, overlap: 99 }
        const shared = [...wordsOf(candidate.text)].filter(word => ownWords.has(word))
        const overlap = shared.filter(
          word => !['that', 'this', 'with', 'from', 'when', 'into', 'your', 'they', 'them', 'then', 'than', 'must', 'only', 'each'].includes(word),
        ).length
        return { candidate, score: overlap >= 2 ? 1 : 0, overlap }
      })
      .filter(entry => entry.score > 0)
      .sort((left, right) => right.score - left.score || right.overlap - left.overlap || right.candidate.updatedAt - left.candidate.updatedAt)
    return scored.slice(0, 3).map(entry => entry.candidate)
  }, [props.note, props.notes])
  if (related.length === 0) return null
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Related memories">
      <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">Related memories</h4>
      <ul className="dshx:flex dshx:flex-col dshx:gap-1">
        {related.map(note => {
          const tone = PanelFormat.noteToneOf(note.type)
          return (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => props.onSelect(note.id)}
                className="dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:px-1.5 dshx:py-1.5 dshx:text-left dshx:hover:bg-accent/40"
              >
                <span className={cn('dshx:flex dshx:size-6 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md', tone.iconTile)}>
                  <tone.Icon className="dshx:size-3.5" />
                </span>
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-xs">{PanelFormat.noteExcerpt(note.text, 90)}</span>
                <span className={cn('dshx:shrink-0 dshx:rounded-full dshx:px-1.5 dshx:py-px dshx:text-[10px]', tone.badge)}>{tone.label}</span>
                <span className="dshx:shrink-0 dshx:text-[10px] dshx:text-muted-foreground">{PanelFormat.formatDay(note.updatedAt)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const NoteDetail = (props: {
  readonly note: PanelNote
  readonly openThread: (id: string) => void
  readonly close: () => void
  readonly onSelectNote: (id: number) => void
}): JSX.Element => {
  const api = useApi(memoryApi)
  const note = props.note
  const tone = PanelFormat.noteToneOf(note.type)
  const { title, body } = PanelFormat.splitNoteText(note.text)
  const history = useQuery({
    queryKey: ['dshfiles-memory', 'history', note.id],
    queryFn: ({ signal }) => api.noteHistory({ id: note.id }, { signal }),
  })
  const related = useQuery({
    queryKey: ['dshfiles-memory', 'related-notes', note.project],
    queryFn: ({ signal }) => api.notes({ project: note.project, scope: '', type: '', query: '', thread: '', includeInvalid: true }, { signal }),
  })
  const versions = history.data ?? []
  const { snapshot, send } = useNoteEditor(note)
  const mode =
    snapshot.matches('editing') || snapshot.matches('saving')
      ? 'edit'
      : snapshot.matches('forgetting') || snapshot.matches('forgettingPending')
        ? 'forget'
        : 'view'
  return (
    <aside aria-label="Note detail" className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:overflow-hidden">
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-5 dshx:py-3">
        <Badge variant="outline" className={cn('dshx:gap-1 dshx:border-transparent', tone.badge)}>
          <tone.Icon className="dshx:size-3" />
          {tone.label}
        </Badge>
        <Badge variant="outline" className={cn('dshx:border-transparent', noteStatusBadge[note.status])}>
          {noteStatusLabels[note.status]}
        </Badge>
        {note.confidence === 'inferred' ? (
          <Badge variant="outline" className="dshx:border-transparent dshx:bg-muted dshx:text-muted-foreground">
            inferred
          </Badge>
        ) : null}
        <span className="dshx:flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Note actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="dshx:w-48">
            <DropdownMenuLabel>n:{note.id}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void writeClipboard(`n:${String(note.id)}`)}>
              <CopyIcon /> Copy note id
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void writeClipboard(note.text)}>
              <CopyIcon /> Copy text
            </DropdownMenuItem>
            {note.sourceThread === null ? null : (
              <DropdownMenuItem onSelect={() => props.openThread(note.sourceThread ?? '')}>
                <MessageSquareIcon /> Open source thread
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" aria-label="Close note detail" onClick={props.close}>
          <XIcon />
        </Button>
      </div>
      <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-5 dshx:overflow-auto dshx:p-5">
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <h2 className="dshx:text-lg dshx:font-semibold dshx:leading-snug">{title}</h2>
          {body.length === 0 ? null : <MarkdownText text={body} labels={markdownLabels} variant="compact" />}
          {note.status === 'valid' ? null : (
            <p className="dshx:text-xs dshx:text-muted-foreground">
              {noteStatusLabels[note.status]}
              {note.reason === null ? '' : `: ${note.reason}`}
            </p>
          )}
        </div>

        {note.type === 'feedback' ? (
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
          <div className="dshx:flex dshx:items-center dshx:justify-between">
            <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">Source &amp; evidence</h4>
            <span className="dshx:text-[11px] dshx:text-muted-foreground">
              {note.citations} citation{note.citations === 1 ? '' : 's'}
            </span>
          </div>
          {note.sourceThread === null ? (
            <p className="dshx:rounded-xl dshx:border dshx:border-dashed dshx:border-border dshx:p-3 dshx:text-xs dshx:text-muted-foreground">
              No source thread: {originLabels[note.origin]}.
            </p>
          ) : (
            <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:p-2.5">
              <span className="dshx:flex dshx:size-8 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:bg-muted dshx:text-muted-foreground">
                <MessageSquareIcon className="dshx:size-4" />
              </span>
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                <span className="dshx:text-[10px] dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">Thread</span>
                <span className="dshx:truncate dshx:text-xs">{note.sourceThread}</span>
              </div>
              <Button size="xs" variant="outline" onClick={() => props.openThread(note.sourceThread ?? '')}>
                Open thread <ArrowUpRightIcon />
              </Button>
            </div>
          )}
          <p className="dshx:text-[11px] dshx:text-muted-foreground">
            {originLabels[note.origin]} · {PanelFormat.formatStamp(note.createdAt)}
            {note.sourceSeq === null ? '' : ` · message #${String(note.sourceSeq)}`}
          </p>
        </section>

        <section className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Metadata">
          <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">Metadata</h4>
          <dl className="dshx:grid dshx:grid-cols-2 dshx:gap-x-4 dshx:gap-y-2 dshx:text-xs">
            <div className="dshx:flex dshx:flex-col">
              <dt className="dshx:text-[11px] dshx:text-muted-foreground">Project</dt>
              <dd className="dshx:truncate" title={note.project}>
                {PanelFormat.projectName(note.project)}
              </dd>
            </div>
            <div className="dshx:flex dshx:flex-col">
              <dt className="dshx:text-[11px] dshx:text-muted-foreground">Type</dt>
              <dd>{tone.label}</dd>
            </div>
            <div className="dshx:flex dshx:flex-col">
              <dt className="dshx:text-[11px] dshx:text-muted-foreground">Status</dt>
              <dd>{noteStatusLabels[note.status]}</dd>
            </div>
            <div className="dshx:flex dshx:flex-col">
              <dt className="dshx:text-[11px] dshx:text-muted-foreground">Scope</dt>
              <dd className="dshx:truncate">{note.scope}</dd>
            </div>
            <div className="dshx:flex dshx:flex-col">
              <dt className="dshx:text-[11px] dshx:text-muted-foreground">Created</dt>
              <dd>{PanelFormat.formatStamp(note.createdAt)}</dd>
            </div>
            <div className="dshx:flex dshx:flex-col">
              <dt className="dshx:text-[11px] dshx:text-muted-foreground">Updated</dt>
              <dd>{PanelFormat.formatStamp(note.updatedAt)}</dd>
            </div>
          </dl>
          {note.status === 'valid' ? (
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
              <Button size="sm" variant="outline" onClick={() => send({ type: 'edit' })} disabled={mode !== 'view'}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="dshx:text-destructive dshx:hover:text-destructive"
                onClick={() => send({ type: 'forget' })}
                disabled={mode !== 'view'}
              >
                Forget
              </Button>
            </div>
          ) : null}
        </section>

        {mode === 'view' ? null : <NoteEditorForm note={note} editor={{ snapshot, send }} key={`${note.id}:${note.updatedAt}`} />}

        <RelatedNotes note={note} notes={related.data ?? []} onSelect={props.onSelectNote} />

        <section className="dshx:flex dshx:flex-col dshx:gap-2" aria-label="Note history">
          <div className="dshx:flex dshx:items-center dshx:justify-between">
            <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">History</h4>
            <span className="dshx:text-[11px] dshx:text-muted-foreground">
              {versions.length} version{versions.length === 1 ? '' : 's'}
            </span>
          </div>
          {versions.length <= 1 ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">No earlier versions.</p>
          ) : (
            <ol aria-label="Note history" className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-l dshx:border-border dshx:pl-3">
              {versions.map(version => (
                <li key={version.id} className="dshx:flex dshx:flex-col dshx:gap-0.5">
                  <button
                    type="button"
                    onClick={() => props.onSelectNote(version.id)}
                    className={cn(
                      'dshx:w-fit dshx:text-left dshx:text-xs dshx:font-mono dshx:hover:underline',
                      version.id === note.id ? 'dshx:font-semibold' : 'dshx:text-muted-foreground',
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
        </section>
      </div>
    </aside>
  )
}

export const NotesTab = (props: {
  readonly project: string | undefined
  readonly openThread: (id: string) => void
  readonly focusNoteId: number | undefined
  readonly selectedId: number | null
  readonly onSelect: (id: number | null) => void
}): JSX.Element => {
  const api = useApi(memoryApi)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<NoteTypeFilter>('')
  const [status, setStatus] = useState<NoteStatusFilter>('valid')
  const [origin, setOrigin] = useState<NoteOriginFilter>('')
  const [sort, setSort] = useState<NoteSort>('newest')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [selectMode, setSelectMode] = useState(false)
  const [selection, setSelection] = useState<ListSelection<number>>(() => ListSelectionModel.empty())
  const [confirmingForget, setConfirmingForget] = useState(false)
  const [forgetReason, setForgetReason] = useState('')
  const [forgetFailure, setForgetFailure] = useState<string | null>(null)
  const [forgetPending, setForgetPending] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const focusNoteId = props.focusNoteId
  const selectNote = props.onSelect
  const debounced = useDebouncedValue({ value: search, delayMs: 250 })
  const includeInvalid = status !== 'valid'
  const notes = useQuery({
    queryKey: ['dshfiles-memory', 'notes', props.project ?? '', debounced, type, includeInvalid],
    queryFn: ({ signal }) => api.notes({ project: props.project ?? '', scope: '', type, query: debounced, thread: '', includeInvalid }, { signal }),
  })
  const counts = useQuery({
    queryKey: ['dshfiles-memory', 'note-counts', props.project ?? ''],
    queryFn: ({ signal }) => api.noteCounts({ project: props.project ?? '' }, { signal }),
    staleTime: 10_000,
  })
  useEffect(() => {
    if (focusNoteId !== undefined) {
      setStatus('all')
      selectNote(focusNoteId)
    }
  }, [focusNoteId, selectNote])
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
  useEffect(() => {
    const query = (notes.data ?? []).filter(note => (origin === '' ? true : note.origin === origin))
    const timeout = window.setTimeout(() => {
      const visibleIds = query.filter(note => note.status === 'valid').map(note => note.id)
      setSelection(current => {
        const next = ListSelectionModel.prune({ state: current, visibleIds })
        return next.ids.length === current.ids.length && next.anchorId === current.anchorId ? current : next
      })
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [notes.data, origin])

  const visibleNotes = useMemo(() => {
    const filtered = (notes.data ?? [])
      .filter(note => (status === 'all' ? true : note.status === status))
      .filter(note => (origin === '' ? true : note.origin === origin))
    return [...filtered].sort((left, right) => {
      if (sort === 'oldest') return left.updatedAt - right.updatedAt
      if (sort === 'cited') return right.citations - left.citations || right.updatedAt - left.updatedAt
      return right.updatedAt - left.updatedAt
    })
  }, [notes.data, origin, sort, status])
  const orderedIds = useMemo(() => visibleNotes.filter(note => note.status === 'valid').map(note => note.id), [visibleNotes])
  const selectedMissing = props.selectedId !== null && !visibleNotes.some(note => note.id === props.selectedId)
  const selectedFallback = useQuery({
    queryKey: ['dshfiles-memory', 'history', 'selected', props.selectedId ?? 0],
    queryFn: ({ signal }) => api.noteHistory({ id: props.selectedId ?? 0 }, { signal }),
    enabled: selectedMissing,
  })
  const selected = visibleNotes.find(note => note.id === props.selectedId) ?? (selectedFallback.data ?? []).find(note => note.id === props.selectedId)
  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids])
  const toggleNote = (id: number): void => setSelection(current => ListSelectionModel.toggle({ state: current, id }))
  const extendNote = (id: number): void => setSelection(current => ListSelectionModel.extend({ state: current, orderedIds, id }))
  const forgetSelected = async (): Promise<void> => {
    setForgetPending(true)
    setForgetFailure(null)
    try {
      const outcome = await NoteSelectionModel.forget({
        ids: selection.ids,
        reason: forgetReason,
        forget: async ({ id, reason }) => {
          await api.forgetNote({ id, reason })
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['dshfiles-memory'] })
      if (outcome.failed.length > 0) {
        setSelection({ ids: outcome.failed, anchorId: outcome.failed[0] })
        setForgetFailure(`${String(outcome.forgotten.length)} forgotten; ${String(outcome.failed.length)} could not be forgotten.`)
        return
      }
      setConfirmingForget(false)
      setSelection(ListSelectionModel.empty())
    } catch (error) {
      setForgetFailure(errorMessage(error, 'The selected notes could not be forgotten.'))
    } finally {
      setForgetPending(false)
    }
  }
  const filtered = search.trim().length > 0 || type !== '' || status !== 'valid' || origin !== ''
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:gap-4 dshx:overflow-hidden dshx:px-5 dshx:pb-5 dshx:@max-pane-compact:flex-col dshx:@max-pane-compact:overflow-auto dshx:@max-[64rem]:flex-col dshx:@max-[64rem]:overflow-auto">
      <section className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card/40 dshx:@max-[64rem]:h-[28rem] dshx:@max-[64rem]:flex-none">
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-b dshx:border-border dshx:p-3">
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            <div className="dshx:flex dshx:h-9 dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:px-2.5">
              <SearchIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
              <input
                ref={searchRef}
                aria-label="Search memories"
                placeholder='Search memories (e.g. "jj workspace", "e2e tests", "plugin architecture")'
                value={search}
                onChange={event => setSearch(event.currentTarget.value)}
                className="dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:bg-transparent dshx:text-sm dshx:outline-none dshx:placeholder:text-muted-foreground"
              />
              <kbd className="dshx:rounded dshx:border dshx:border-border dshx:px-1 dshx:text-[10px] dshx:text-muted-foreground">/</kbd>
            </div>
            <div className="dshx:flex dshx:items-center dshx:gap-0.5">
              <Button
                variant={view === 'list' ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-label="List view"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <ListIcon />
              </Button>
              <Button
                variant={view === 'grid' ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
              >
                <LayoutGridIcon />
              </Button>
            </div>
          </div>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
            {filterSelect({
              label: 'Filter by type',
              value: type === '' ? 'all' : type,
              display: type === '' ? 'Type' : PanelFormat.noteToneOf(type).label,
              onChange: value => setType(noteTypeOf(value)),
              children: noteTypeOptions.map(option => (
                <SelectItem key={option.value === '' ? 'all' : option.value} value={option.value === '' ? 'all' : option.value}>
                  {option.label}
                </SelectItem>
              )),
            })}
            {filterSelect({
              label: 'Filter by status',
              value: status,
              display: status === 'valid' ? 'Status' : status === 'all' ? 'All statuses' : noteStatusLabels[status],
              onChange: value => setStatus(noteStatusOf(value)),
              children: [
                <SelectItem key="all" value="all">
                  All statuses
                </SelectItem>,
                ...(['valid', 'superseded', 'forgotten'] as const).map(value => (
                  <SelectItem key={value} value={value}>
                    {noteStatusLabels[value]}
                  </SelectItem>
                )),
              ],
            })}
            {filterSelect({
              label: 'Filter by source',
              value: origin === '' ? 'all' : origin,
              display: origin === '' ? 'Source' : originShortLabels[origin],
              onChange: value => setOrigin(noteOriginOf(value)),
              children: [
                <SelectItem key="all" value="all">
                  All sources
                </SelectItem>,
                ...(['user-requested', 'agent', 'panel'] as const).map(value => (
                  <SelectItem key={value} value={value}>
                    {originShortLabels[value]}
                  </SelectItem>
                )),
              ],
            })}
            {filterSelect({
              label: 'Sort notes',
              value: sort,
              display: sort === 'newest' ? 'Newest' : sort === 'oldest' ? 'Oldest' : 'Most cited',
              onChange: value => setSort(noteSortOf(value)),
              children: [
                <SelectItem key="newest" value="newest">
                  Newest
                </SelectItem>,
                <SelectItem key="oldest" value="oldest">
                  Oldest
                </SelectItem>,
                <SelectItem key="cited" value="cited">
                  Most cited
                </SelectItem>,
              ],
            })}
            <span className="dshx:flex-1" />
            <Button
              variant={selectMode ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Select notes"
              aria-pressed={selectMode}
              title="Select notes"
              onClick={() => {
                setSelectMode(!selectMode)
                if (selectMode) setSelection(ListSelectionModel.empty())
              }}
            >
              <SquareCheckBigIcon />
            </Button>
          </div>
          <div className="dshx:flex dshx:flex-wrap dshx:items-baseline dshx:gap-2 dshx:pt-0.5">
            <span className="dshx:text-[13px] dshx:font-semibold">{PanelFormat.formatCount(visibleNotes.length)} memories</span>
            <span className="dshx:flex-1" />
            <span className="dshx:text-[11px] dshx:text-muted-foreground">
              Active {PanelFormat.formatCount(counts.data?.active ?? 0)} · Superseded {PanelFormat.formatCount(counts.data?.superseded ?? 0)} · Forgotten{' '}
              {PanelFormat.formatCount(counts.data?.forgotten ?? 0)}
            </span>
          </div>
        </div>
        {selectMode && orderedIds.length > 0 ? (
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4 dshx:py-1.5 dshx:text-xs">
            <input
              type="checkbox"
              aria-label="Select all visible notes"
              checked={ListSelectionModel.isComplete({ state: selection, orderedIds })}
              onChange={() => setSelection(current => ListSelectionModel.toggleAllVisible({ state: current, orderedIds }))}
              className="dshx:size-3.5 dshx:accent-[var(--color-info)]"
            />
            <span className="dshx:text-muted-foreground">Select all visible notes</span>
          </div>
        ) : null}
        {notes.isError ? <p className="dshx:p-4 dshx:text-xs dshx:text-destructive">{errorMessage(notes.error, 'Notes are unavailable.')}</p> : null}
        {notes.isSuccess && visibleNotes.length === 0 ? (
          <p className="dshx:p-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">
            {filtered ? 'No notes match these filters.' : 'No notes yet. Agents add them with memory_note when you correct or decide something.'}
          </p>
        ) : null}
        <div
          className={cn(
            'dshx:min-h-0 dshx:flex-1 dshx:overflow-auto',
            view === 'list' ? 'dshx:divide-y dshx:divide-border' : 'dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:p-3',
          )}
        >
          {view === 'list'
            ? visibleNotes.map(note => (
                <NoteRow
                  key={`${note.id}:${note.updatedAt}`}
                  note={note}
                  selected={note.id === props.selectedId}
                  selectMode={selectMode}
                  checked={selectedIds.has(note.id)}
                  onOpen={() => props.onSelect(note.id)}
                  onToggle={() => toggleNote(note.id)}
                  onRange={() => extendNote(note.id)}
                />
              ))
            : visibleNotes.map(note => (
                <NoteGridCard key={`${note.id}:${note.updatedAt}`} note={note} selected={note.id === props.selectedId} onOpen={() => props.onSelect(note.id)} />
              ))}
        </div>
        {selection.ids.length === 0 ? null : (
          <div className="dshx:sticky dshx:bottom-0 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:border-border dshx:bg-popover dshx:p-2 dshx:pl-3 dshx:text-[13px]">
            <span className="dshx:mr-2 dshx:tabular-nums">{selection.ids.length} selected</span>
            <Button
              size="xs"
              variant="destructive"
              onClick={() => {
                setForgetReason('')
                setForgetFailure(null)
                setConfirmingForget(true)
              }}
            >
              Forget selected
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setSelection(ListSelectionModel.empty())}>
              Clear
            </Button>
          </div>
        )}
      </section>
      {selected === undefined ? (
        <aside
          aria-label="Note detail"
          className="dshx:flex dshx:w-80 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl dshx:border dshx:border-dashed dshx:border-border dshx:p-6 dshx:text-center dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:hidden dshx:@max-[64rem]:hidden"
        >
          Select a memory to see where it came from, edit it, or forget it.
        </aside>
      ) : (
        <section className="dshx:flex dshx:min-h-0 dshx:w-[26rem] dshx:shrink-0 dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card/40 dshx:@max-pane-compact:w-full dshx:@max-[64rem]:h-[34rem] dshx:@max-[64rem]:w-full dshx:@max-[64rem]:flex-none">
          <NoteDetail
            key={selected.id}
            note={selected}
            openThread={props.openThread}
            close={() => props.onSelect(null)}
            onSelectNote={id => props.onSelect(id)}
          />
        </section>
      )}
      <AlertDialog
        open={confirmingForget}
        onOpenChange={open => {
          if (!open && !forgetPending) setConfirmingForget(false)
        }}
      >
        <AlertDialogContent className="dshx-root" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="dshx:text-sm">Forget {selection.ids.length} selected notes?</AlertDialogTitle>
            <AlertDialogDescription>Each note stays in its history as forgotten, with the reason below.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Reason for forgetting"
            placeholder="Reason (optional)"
            value={forgetReason}
            onChange={event => setForgetReason(event.currentTarget.value)}
            className="dshx:h-8"
          />
          {forgetFailure === null ? null : <p className="dshx:text-xs dshx:text-destructive">{forgetFailure}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={forgetPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={forgetPending || selection.ids.length === 0}
              onClick={event => {
                event.preventDefault()
                void forgetSelected()
              }}
            >
              {forgetPending ? 'Forgetting…' : `Forget ${String(selection.ids.length)} notes`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
