import { useApi } from '@dshfiles/dshx/client'
import { ImageLightbox } from '@dshfiles/plugin-ui/components/image-lightbox'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import {
  ArrowUpIcon,
  CheckIcon,
  FolderIcon,
  HashIcon,
  FileIcon,
  PaperclipIcon,
  SquareIcon,
  LinkIcon,
  ListIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  MicIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { z } from 'zod'

import { backlogApi, BacklogViews } from './api.js'
import { CaptureProject } from './capture-project.js'
import { fileInput, readComposerFile, type ComposerFile } from './composer-files.js'
import type { AgentChoice } from './agent-dispatch.js'
import { useAgentDispatch } from './agent-dispatch-context.js'
import { audioBase64, startVoiceCapture, type VoiceCapture } from './composer-audio.js'
import { InlineCompletion } from './inline-completion.js'
import { BacklogItems, type BacklogKind, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogProjectCommand } from './project-command.js'
import { BacklogProjects, ProjectPicker } from './project-picker.js'
import { useBacklogActions } from './use-backlog-actions.js'

export interface ComposerThread {
  readonly id: string
  readonly title: string
  readonly running: boolean
  readonly cwd?: string
}

type Suggestion = { readonly key: string; readonly insert: string; readonly label: ReactNode; readonly hint: string; readonly project?: string }
type ReferenceMode = 'item' | 'thread'

const draftsSchema = z.record(z.string(), z.string().max(20_000))
const noDrafts: z.infer<typeof draftsSchema> = {}
const drafts = createStoredValue({ key: 'dshfiles.backlog.draft.v1', schema: draftsSchema, fallback: noDrafts })
const captureProject = createStoredValue({
  key: 'dshfiles.backlog.capture-project.v1',
  schema: z.string().max(BacklogItems.maxTargetChars).nullable(),
  fallback: null,
})

const chipClass =
  'dshx:inline-flex dshx:h-5 dshx:max-w-56 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:truncate dshx:rounded-full dshx:border dshx:border-border dshx:px-2 dshx:text-[11px] dshx:text-muted-foreground'

const iconButtonClass =
  'dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground dshx:disabled:opacity-40'

const sizeLabel = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`

const propertyClass =
  'dshx:inline-flex dshx:h-6 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:px-1.5 dshx:text-[11px] dshx:text-muted-foreground dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground'

const ChoiceChip = <Value extends string>(props: {
  readonly label: string
  readonly value: Value
  readonly values: readonly Value[]
  readonly render: (value: Value) => ReactNode
  readonly renderTrigger: (value: Value) => ReactNode
  readonly onPick: (value: Value) => void
}): JSX.Element => (
  <DropdownMenu>
    <DropdownMenuTrigger aria-label={props.label} className={propertyClass}>
      {props.renderTrigger(props.value)}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" className="dshx-root dshx:min-w-40">
      {props.values.map(value => (
        <DropdownMenuItem key={value} onSelect={() => props.onPick(value)} className="dshx:gap-2 dshx:text-[13px]">
          {props.render(value)}
          {value === props.value ? <CheckIcon aria-hidden className="dshx:ml-auto dshx:size-3.5" /> : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)

/** The one search surface behind `+`: items, threads and projects, ranked by the same Host search the panel uses. */
const ReferenceDialog = (props: {
  readonly mode: ReferenceMode | null
  readonly threads: readonly ComposerThread[]
  readonly onClose: () => void
  readonly onPickItem: (item: { readonly id: number; readonly title: string }) => void
  readonly onPickThread: (thread: ComposerThread) => void
}): JSX.Element => {
  const api = useApi(backlogApi)
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue({ value: query, delayMs: 120 })
  const open = props.mode !== null
  useEffect(() => {
    if (open) setQuery('')
  }, [open])
  const items = useQuery({
    queryKey: ['dshfiles-backlog-composer-items', debounced],
    queryFn: async ({ signal }) => BacklogViews.list(await api.list({ query: debounced, freshness: 'all', limit: 8 }, { signal })),
    enabled: open && props.mode === 'item',
  })
  const title = props.mode === 'item' ? 'Link a backlog item' : 'Link a thread'
  return (
    <CommandDialog open={open} onOpenChange={next => (next ? undefined : props.onClose())} title={title} description="Search by name">
      <CommandInput
        placeholder="Search by title…"
        value={query}
        onValueChange={setQuery}
        onKeyDown={event => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          props.onClose()
        }}
      />
      <CommandList>
        <CommandEmpty>{props.mode === 'item' ? 'No backlog item matches.' : 'No thread matches.'}</CommandEmpty>
        {props.mode === 'thread' ? (
          <CommandGroup heading="Threads">
            {props.threads
              .filter(thread => thread.title.toLowerCase().includes(query.trim().toLowerCase()))
              .slice(0, 8)
              .map(thread => (
                <CommandItem key={thread.id} value={`${thread.title} ${thread.id}`} onSelect={() => props.onPickThread(thread)}>
                  <MessageSquareIcon aria-hidden />
                  <span className="dshx:truncate">{thread.title}</span>
                  {thread.running ? <span className="dshx:ml-auto dshx:text-[11px] dshx:text-info">running</span> : null}
                </CommandItem>
              ))}
          </CommandGroup>
        ) : null}
        {props.mode === 'item' ? (
          <CommandGroup heading="Backlog items">
            {(items.data?.items ?? []).map(item => (
              <CommandItem key={item.id} value={`${item.title} b:${String(item.id)}`} onSelect={() => props.onPickItem(item)}>
                <ItemGlyphs.StatusIcon status={item.status} />
                <span className="dshx:truncate">{item.title}</span>
                <span className="dshx:ml-auto dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground">b:{item.id}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}

/**
 * The capture box: type like a chat message, Enter sends. It never waits on triage: the text clears at once, the item
 * appears from the Host's answer, and a failure puts the text back with a retry. The draft survives reloads.
 */
export const Composer = (props: {
  readonly draftKey: string
  readonly placeholder: string
  readonly tags: readonly string[]
  readonly threads: readonly ComposerThread[]
  readonly projects: readonly string[]
  readonly projectFilter?: string | null
  readonly reuseProject?: boolean
  readonly status?: BacklogStatus | null
  readonly onClearStatus?: () => void
  readonly inputRef?: RefObject<HTMLTextAreaElement>
  readonly variant: 'chat' | 'compact'
  readonly autoFocus?: boolean
}): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useBacklogActions()
  const agentPort = useAgentDispatch()
  const speech = useQuery({
    queryKey: ['dshfiles-backlog-speech'],
    queryFn: ({ signal }) => api.speechStatus(undefined, { signal }),
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
  const storedDrafts = drafts.useValue()
  const storedProject = captureProject.useValue()
  const reuseProject = props.reuseProject ?? true
  const [text, setTextState] = useState(() => storedDrafts[props.draftKey] ?? '')
  const [caret, setCaret] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [navigated, setNavigated] = useState(false)
  const [itemSuggestions, setItemSuggestions] = useState<readonly Suggestion[]>([])
  const [agentChoices, setAgentChoices] = useState<readonly AgentChoice[]>([])
  const [files, setFiles] = useState<readonly ComposerFile[]>([])
  const [status, setStatus] = useState<BacklogStatus>(props.status ?? 'inbox')
  const [statusTouched, setStatusTouched] = useState(false)
  const [kind, setKind] = useState<BacklogKind | null>(null)
  const [project, setProject] = useState<string | null>(() =>
    CaptureProject.initial({ filter: props.projectFilter ?? null, remembered: storedProject, reuse: reuseProject }),
  )
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [referenceMode, setReferenceMode] = useState<ReferenceMode | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const closePreview = useCallback(() => setPreviewId(null), [])
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const captureRef = useRef<VoiceCapture | null>(null)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const input = props.inputRef ?? ownRef

  const setText = (value: string): void => {
    setTextState(value)
    const next = { ...drafts.get() }
    if (value === '') delete next[props.draftKey]
    else next[props.draftKey] = value
    drafts.set(next)
  }

  const appendText = (chunk: string): void => {
    setTextState(current => {
      const next = current === '' || current.endsWith(' ') ? `${current}${chunk}` : `${current} ${chunk}`
      drafts.set({ ...drafts.get(), [props.draftKey]: next })
      return next
    })
  }

  useEffect(() => {
    if (props.status !== undefined && props.status !== null) setStatus(props.status)
  }, [props.status])

  useEffect(() => {
    if (props.projectFilter === undefined) return
    setProject(CaptureProject.initial({ filter: props.projectFilter, remembered: captureProject.get(), reuse: reuseProject }))
  }, [props.projectFilter, reuseProject])

  useEffect(
    () => () => {
      if (stopTimerRef.current !== null) clearTimeout(stopTimerRef.current)
      void captureRef.current?.cancel()
    },
    [],
  )

  const token = InlineCompletion.tokenAt(text, caret)
  const projectCommand = BacklogProjectCommand.at(text, caret)
  useEffect(() => {
    if (token?.trigger !== '@' || agentPort === null) return
    let live = true
    void agentPort
      .choices()
      .then(choices => {
        if (live) setAgentChoices(choices)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [agentPort, token?.trigger])
  useEffect(() => {
    if (token?.trigger !== '@' || token.scope !== null) {
      setItemSuggestions([])
      return
    }
    const controller = new AbortController()
    void api
      .list({ query: token.query, freshness: 'all', limit: 5 }, { signal: controller.signal })
      .then(result =>
        setItemSuggestions(
          result.items.map(item => ({
            key: `b:${String(item.id)}`,
            insert: `b:${String(item.id)} `,
            label: (
              <>
                <ItemGlyphs.StatusIcon status={item.status} />
                <span className="dshx:truncate">{item.title}</span>
              </>
            ),
            hint: `b:${String(item.id)}`,
          })),
        ),
      )
      .catch(() => undefined)
    return () => controller.abort()
  }, [api, token?.scope, token?.trigger, token?.query])

  const suggestions = useMemo((): readonly Suggestion[] => {
    if (token !== null && token.scope !== null) return []
    if (projectCommand !== null) {
      const query = projectCommand.query.trim().toLowerCase()
      return props.projects
        .filter(path => path.toLowerCase().includes(query))
        .slice(0, 8)
        .map(path => ({
          key: path,
          insert: '',
          project: path,
          label: (
            <>
              <ItemGlyphs.ProjectDot project={path} />
              <span className="dshx:truncate">{ItemGlyphs.projectName(path)}</span>
              <span className="dshx:ml-auto dshx:max-w-40 dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{path}</span>
            </>
          ),
          hint: 'project',
        }))
    }
    if (token === null) return []
    const query = token.query.toLowerCase()
    if (token.trigger === '#') {
      const known = props.tags.filter(tag => tag.startsWith(query)).slice(0, 6)
      const rows = known.map(tag => ({ key: `#${tag}`, insert: `#${tag} `, label: <span>#{tag}</span>, hint: 'tag' }))
      return query !== '' && !known.includes(query)
        ? [...rows, { key: `#${query}+`, insert: `#${query} `, label: <span>#{query}</span>, hint: 'new tag' }]
        : rows
    }
    const threads = props.threads
      .filter(thread => thread.title.toLowerCase().includes(query))
      .slice(0, 4)
      .map(thread => ({
        key: thread.id,
        insert: `${thread.id} `,
        label: (
          <>
            <MessagesSquareIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
            <span className="dshx:truncate">{thread.title}</span>
          </>
        ),
        hint: 'thread',
      }))
    const agentRows = InlineCompletion.agents(token, agentChoices).map(row => {
      const agent = agentChoices.find(choice => choice.handle === row.handle)
      return {
        key: `@${row.handle}`,
        insert: row.insert,
        label: (
          <>
            <span aria-hidden>{agent?.glyph ?? '🤖'}</span>
            <span className="dshx:truncate">{agent?.name ?? row.handle}</span>
          </>
        ),
        hint: `@${row.handle}`,
      }
    })
    return [...agentRows, ...itemSuggestions, ...threads]
  }, [projectCommand, token, props.tags, props.threads, props.projects, itemSuggestions, agentChoices])

  useEffect(() => {
    setHighlight(0)
    setNavigated(false)
  }, [token?.trigger, token?.query, projectCommand?.query])

  const pick = (suggestion: Suggestion): void => {
    if (suggestion.project !== undefined) {
      if (projectCommand === null) return
      const next = BacklogProjectCommand.strip(text, projectCommand)
      setNavigated(false)
      setText(next)
      setProject(suggestion.project)
      requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.setSelectionRange(next.length, next.length)
        setCaret(next.length)
      })
      return
    }
    if (token === null) return
    const next = `${text.slice(0, token.start)}${suggestion.insert}${text.slice(caret)}`
    const position = token.start + suggestion.insert.length
    setNavigated(false)
    setText(next)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(position, position)
      setCaret(position)
    })
  }

  const insert = (value: string): void => {
    const element = input.current
    const start = element?.selectionStart ?? text.length
    const end = element?.selectionEnd ?? text.length
    const next = `${text.slice(0, start)}${value}${text.slice(end)}`
    setText(next)
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + value.length, start + value.length)
      setCaret(start + value.length)
    })
  }

  const addFiles = async (dropped: readonly File[]): Promise<void> => {
    if (dropped.length === 0) return
    setFailed(null)
    try {
      const next: ComposerFile[] = []
      for (const file of dropped.slice(0, Math.max(0, BacklogItems.maxAttachments - files.length))) next.push(await readComposerFile(file))
      setFiles(current => [...current, ...next].slice(0, BacklogItems.maxAttachments))
    } catch (error) {
      setFailed(errorMessage(error, 'That file could not be read.'))
    }
  }

  const stopVoice = async (): Promise<void> => {
    const capture = captureRef.current
    if (capture === null) return
    captureRef.current = null
    if (stopTimerRef.current !== null) clearTimeout(stopTimerRef.current)
    stopTimerRef.current = null
    setRecording(false)
    setTranscribing(true)
    try {
      const audio = await capture.stop()
      const result = await api.transcribeSpeech({ audioBase64: audioBase64(audio) })
      if (!result.ok) {
        setFailed(result.reason)
        return
      }
      if (result.text.trim() === '') {
        setFailed('No speech was recognized.')
        return
      }
      appendText(`${result.text.trim()} `)
    } catch (error) {
      setFailed(errorMessage(error, 'The recording could not be transcribed.'))
    } finally {
      setTranscribing(false)
    }
  }

  const startVoice = async (): Promise<void> => {
    const status = speech.data
    if (status === undefined || !status.available) {
      setFailed(status?.reason ?? 'The voice-input bundle is not loaded.')
      return
    }
    if (!status.ready) {
      setFailed(status.reason ?? 'Open Plugins → Voice input to prepare the recognizer.')
      return
    }
    try {
      const capture = await startVoiceCapture()
      captureRef.current = capture
      setRecording(true)
      setFailed(null)
      stopTimerRef.current = setTimeout(() => {
        void stopVoice()
      }, 120_000)
    } catch (error) {
      setFailed(errorMessage(error, 'Microphone access was refused.'))
    }
  }

  const toggleVoice = (): void => {
    if (recording) void stopVoice()
    else void startVoice()
  }

  const submit = (): void => {
    if (text.trim() === '' && files.length === 0) return
    const submitted = { text, files, status, kind, project }
    setText('')
    setFiles([])
    setKind(null)
    setProject(CaptureProject.next({ sent: project, filter: props.projectFilter ?? null, reuse: reuseProject }))
    setStatusTouched(false)
    setStatus('inbox')
    setFailed(null)
    props.onClearStatus?.()
    const payload: Parameters<typeof api.capture>[0] = { text: text.trim() === '' ? (files[0]?.name ?? 'File capture') : text }
    if (statusTouched || (props.status !== undefined && props.status !== null)) payload.status = status
    if (kind !== null) payload.kind = kind
    if (project !== null) payload.project = project
    if (files.length > 0) payload.files = files.map(fileInput)
    actions.capture.mutate(payload, {
      onSuccess: () => captureProject.set(CaptureProject.remembered({ sent: submitted.project, reuse: reuseProject })),
      onError: error => {
        setFailed(errorMessage(error, 'The item was not saved.'))
        setTextState((current: string) => (current === '' ? submitted.text : current))
        setFiles(current => (current.length === 0 ? submitted.files : current))
        setStatus(submitted.status)
        setKind(submitted.kind)
        setProject(submitted.project)
      },
    })
  }

  const preview = useMemo(() => (text.trim() === '' ? null : BacklogItems.triage(text)), [text])
  const images = useMemo(() => files.filter(file => file.kind === 'image'), [files])
  const lightboxImages = useMemo(() => images.map(file => ({ src: file.dataUrl, alt: file.name })), [images])
  const previewIndex = images.findIndex(file => file.id === previewId)
  const chat = props.variant === 'chat'
  const speechReason = speech.data?.reason ?? 'The voice-input bundle is not loaded.'
  const voiceAvailable = speech.data?.available === true
  const voiceTitle = (() => {
    if (transcribing) return 'Transcribing…'
    if (recording) return 'Stop recording'
    return voiceAvailable ? speechReason : 'Voice input is not available'
  })()
  const effectiveKind = kind ?? preview?.kind ?? 'task'

  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        submit()
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={event => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        setDragging(false)
      }}
      onDrop={event => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(false)
        void addFiles([...event.dataTransfer.files])
      }}
      className={cn(
        'dshx:relative dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:bg-card dshx:transition-[border-color,box-shadow] dshx:focus-within:border-input dshx:focus-within:shadow-sm',
        failed === null ? 'dshx:border-border' : 'dshx:border-destructive/60',
        dragging && 'dshx:border-primary/60 dshx:ring-2 dshx:ring-primary/15',
        chat ? 'dshx:px-3 dshx:pt-2.5 dshx:pb-2' : 'dshx:px-2.5 dshx:py-1.5',
      )}
    >
      {suggestions.length === 0 ? null : (
        <ul
          role="listbox"
          aria-label="Suggestions"
          className="dshx:absolute dshx:bottom-full dshx:left-2 dshx:z-30 dshx:mb-1.5 dshx:w-80 dshx:max-w-[calc(100%-1rem)] dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-popover dshx:p-1 dshx:shadow-lg dshx:animate-in dshx:fade-in-0 dshx:slide-in-from-bottom-1"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.key}
              role="option"
              aria-selected={index === highlight}
              onMouseDown={event => {
                event.preventDefault()
                pick(suggestion)
              }}
              onMouseEnter={() => setHighlight(index)}
              className={cn(
                'dshx:flex dshx:h-8 dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-[13px]',
                index === highlight && 'dshx:bg-accent',
              )}
            >
              {suggestion.label}
              <span className="dshx:ml-auto dshx:shrink-0 dshx:text-[11px] dshx:text-muted-foreground">{suggestion.hint}</span>
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 ? null : (
        <div aria-label="Attachments" className="dshx:flex dshx:flex-wrap dshx:gap-2">
          {files.map(file =>
            file.kind === 'image' ? (
              <figure
                key={file.id}
                className="dshx:group/image dshx:relative dshx:size-16 dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted"
              >
                <button
                  type="button"
                  aria-label={`Open ${file.name}`}
                  onClick={() => setPreviewId(file.id)}
                  className="dshx:block dshx:size-full dshx:cursor-zoom-in"
                >
                  <img src={file.dataUrl} alt={file.name} className="dshx:size-full dshx:object-cover" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles(current => current.filter(candidate => candidate.id !== file.id))}
                  className="dshx:absolute dshx:top-1 dshx:right-1 dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-background/90 dshx:text-foreground dshx:opacity-0 dshx:shadow-sm dshx:transition-opacity dshx:group-hover/image:opacity-100"
                >
                  <XIcon className="dshx:size-3" />
                </button>
              </figure>
            ) : (
              <div
                key={file.id}
                className="dshx:group/file dshx:relative dshx:flex dshx:h-16 dshx:w-52 dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/40 dshx:px-2"
              >
                <FileIcon aria-hidden className="dshx:size-5 dshx:shrink-0 dshx:text-muted-foreground" />
                <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                  <span className="dshx:truncate dshx:text-[12px] dshx:text-foreground">{file.name}</span>
                  <span className="dshx:text-[11px] dshx:text-muted-foreground">{sizeLabel(file.bytes)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles(current => current.filter(candidate => candidate.id !== file.id))}
                  className="dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
                >
                  <XIcon className="dshx:size-3" />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {previewIndex === -1 ? null : <ImageLightbox images={lightboxImages} initialIndex={previewIndex} onClose={closePreview} />}

      <textarea
        ref={input}
        aria-label="Capture"
        rows={3}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        value={text}
        onPaste={event => {
          const pasted = [...event.clipboardData.files]
          if (pasted.length === 0) return
          event.preventDefault()
          void addFiles(pasted)
        }}
        onChange={event => {
          setText(event.currentTarget.value)
          setCaret(event.currentTarget.selectionStart)
        }}
        onSelect={event => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={event => {
          if (suggestions.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setNavigated(true)
              setHighlight(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
              return
            }
            // Tab completes a suggestion; Enter still adds the item, so a line ending in `#tag` sends on the first press.
            if (event.key === 'Tab' || (event.key === 'Enter' && navigated)) {
              const chosen = suggestions[highlight]
              if (chosen !== undefined) {
                event.preventDefault()
                pick(chosen)
                return
              }
            }
          }
          if (event.key === 'Escape') {
            event.currentTarget.blur()
            return
          }
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          submit()
        }}
        className={cn(
          'dshx:field-sizing-content dshx:w-full dshx:resize-none dshx:rounded-md dshx:bg-transparent dshx:leading-relaxed dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground',
          chat ? 'dshx:min-h-20 dshx:max-h-72 dshx:text-sm' : 'dshx:min-h-16 dshx:max-h-48 dshx:text-[13px]',
        )}
      />

      {failed !== null ? (
        <p role="alert" className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive">
          {failed}
          <button type="submit" className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:font-medium dshx:hover:underline">
            <RotateCcwIcon className="dshx:size-3" /> Retry
          </button>
        </p>
      ) : null}

      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1 dshx:border-t dshx:border-border/60 dshx:pt-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Add a file or a reference" className={iconButtonClass}>
            <PlusIcon className="dshx:size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="dshx-root dshx:w-52">
            <DropdownMenuItem onSelect={() => fileInputRef.current?.click()} className="dshx:gap-2 dshx:text-[13px]">
              <PaperclipIcon aria-hidden /> Add image or file
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setReferenceMode('item')} className="dshx:gap-2 dshx:text-[13px]">
              <ListIcon aria-hidden /> Link a backlog item
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setReferenceMode('thread')} className="dshx:gap-2 dshx:text-[13px]">
              <MessageSquareIcon aria-hidden /> Link a thread
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setProjectPickerOpen(true)} className="dshx:gap-2 dshx:text-[13px]">
              <FolderIcon aria-hidden /> Set a project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={event => {
            void addFiles([...(event.currentTarget.files ?? [])])
            event.currentTarget.value = ''
          }}
        />

        <ChoiceChip
          label="Status"
          value={status}
          values={BacklogItems.statuses}
          onPick={value => {
            setStatus(value)
            setStatusTouched(true)
          }}
          renderTrigger={value => (
            <>
              <ItemGlyphs.StatusIcon status={value} className="dshx:size-3" />
              {ItemGlyphs.statusLabels[value]}
            </>
          )}
          render={value => (
            <>
              <ItemGlyphs.StatusIcon status={value} />
              {ItemGlyphs.statusLabels[value]}
            </>
          )}
        />

        <ChoiceChip
          label="Kind"
          value={effectiveKind}
          values={BacklogItems.kinds}
          onPick={setKind}
          renderTrigger={value => (
            <>
              <ItemGlyphs.KindIcon kind={value} className="dshx:size-3" />
              {ItemGlyphs.kindLabels[value]}
            </>
          )}
          render={value => (
            <>
              <ItemGlyphs.KindIcon kind={value} />
              {ItemGlyphs.kindLabels[value]}
            </>
          )}
        />

        <ProjectPicker
          label="Project of the new item"
          value={project ?? BacklogProjects.none}
          projects={props.projects}
          side="top"
          open={projectPickerOpen}
          onOpenChange={setProjectPickerOpen}
          onPick={value => setProject(value === BacklogProjects.none ? null : value)}
          triggerClassName={cn(propertyClass, 'dshx:max-w-48', project === null && 'dshx:text-muted-foreground')}
          trigger={
            project === null ? (
              <>
                <FolderIcon aria-hidden className="dshx:size-3" />
                <span>Project</span>
              </>
            ) : (
              <>
                <ItemGlyphs.ProjectDot project={project} className="dshx:size-2" />
                <span className="dshx:max-w-40 dshx:truncate">{ItemGlyphs.projectName(project)}</span>
              </>
            )
          }
        />

        {preview === null ? null : (
          <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
            {preview.tags.map(tag => (
              <span key={tag} className={chipClass}>
                #{tag}
              </span>
            ))}
            {preview.links.map(link => (
              <span key={`${link.type}:${link.target}`} className={chipClass}>
                <LinkIcon aria-hidden className="dshx:size-3 dshx:shrink-0" />
                <span className="dshx:truncate">{link.type === 'item' ? `b:${link.target}` : link.target}</span>
              </span>
            ))}
          </span>
        )}

        <span className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1">
          {recording ? <span className="dshx:text-[11px] dshx:text-destructive">Recording…</span> : null}
          {transcribing ? <span className="dshx:text-[11px] dshx:text-muted-foreground">Transcribing…</span> : null}
          <button
            type="button"
            aria-label={recording ? 'Stop recording' : 'Dictate'}
            aria-pressed={recording}
            title={voiceTitle}
            disabled={!voiceAvailable || transcribing}
            onClick={toggleVoice}
            className={cn(iconButtonClass, recording && 'dshx:bg-destructive/10 dshx:text-destructive')}
          >
            {recording ? (
              <SquareIcon className="dshx:size-3.5 dshx:fill-current" />
            ) : transcribing ? (
              <LoaderCircleIcon className="dshx:size-4 dshx:animate-spin" />
            ) : (
              <MicIcon className="dshx:size-4" />
            )}
          </button>
          <button
            type="submit"
            aria-label="Add"
            disabled={text.trim() === '' && files.length === 0}
            className={cn(
              'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:transition-[background-color,opacity,transform] dshx:duration-100 dshx:active:scale-95',
              chat ? 'dshx:size-7' : 'dshx:size-6',
              text.trim() === '' && files.length === 0
                ? 'dshx:bg-muted dshx:text-muted-foreground dshx:opacity-60'
                : 'dshx:bg-primary dshx:text-primary-foreground',
            )}
          >
            <ArrowUpIcon className="dshx:size-3.5" />
          </button>
        </span>
      </div>

      {chat ? (
        <p className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-1 dshx:text-[11px] dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
          <span>
            <Kbd>↵</Kbd> add · <Kbd>⇧↵</Kbd> new line · <Kbd>Tab</Kbd> complete
          </span>
          <span>
            <code>bug:</code> <code>idea:</code> <code>note:</code> set the kind
          </span>
          <span>
            <HashIcon aria-hidden className="dshx:inline dshx:size-3" /> tags · <code>@</code> items and threads · <code>/project</code> · paste or drop a file
          </span>
        </p>
      ) : null}

      <ReferenceDialog
        mode={referenceMode}
        threads={props.threads}
        onClose={() => setReferenceMode(null)}
        onPickItem={item => {
          setReferenceMode(null)
          insert(`b:${String(item.id)} `)
        }}
        onPickThread={thread => {
          setReferenceMode(null)
          insert(`${thread.id} `)
        }}
      />
    </form>
  )
}
