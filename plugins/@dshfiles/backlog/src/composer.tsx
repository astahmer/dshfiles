import { useApi } from '@dshfiles/dshx/client'
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
  PaperclipIcon,
  SquareIcon,
  LinkIcon,
  ListIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MicIcon,
  PlusIcon,
  RotateCcwIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { z } from 'zod'

import { backlogApi, BacklogViews } from './api.js'
import { CaptureProject } from './capture-project.js'
import { AttachmentTray, pasteFiles, useComposerFiles, useFileDrop } from './composer-attachments.js'
import { fileInput } from './composer-files.js'
import { audioBase64, startVoiceCapture, type VoiceCapture } from './composer-audio.js'
import { MentionMenu, useMentionCompletion } from './mention-completion.js'
import { BacklogItems, type BacklogKind, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogProjectCommand } from './project-command.js'
import { continueMarkdownList } from './list-continuation.js'
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
  const attachments = useComposerFiles({ onError: setFailed })
  const [status, setStatus] = useState<BacklogStatus>(props.status ?? 'inbox')
  const [statusTouched, setStatusTouched] = useState(false)
  const [kind, setKind] = useState<BacklogKind | null>(null)
  const [project, setProject] = useState<string | null>(() =>
    CaptureProject.initial({ filter: props.projectFilter ?? null, remembered: storedProject, reuse: reuseProject }),
  )
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [referenceMode, setReferenceMode] = useState<ReferenceMode | null>(null)
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

  const projectCommand = BacklogProjectCommand.at(text, caret)
  const mention = useMentionCompletion({ text, caret, threads: props.threads, projects: props.projects, tags: props.tags })
  const suggestions = useMemo((): readonly Suggestion[] => {
    if (projectCommand === null) return mention.suggestions
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
  }, [mention.suggestions, projectCommand, props.projects])

  useEffect(() => {
    setHighlight(0)
    setNavigated(false)
  }, [mention.token?.trigger, mention.token?.query, projectCommand?.query])

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
    if (mention.token === null) return
    const next = `${text.slice(0, mention.token.start)}${suggestion.insert}${text.slice(caret)}`
    const position = mention.token.start + suggestion.insert.length
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

  const drop = useFileDrop({ onFiles: files => void attachments.add(files) })
  const addFromPicker = (): void => fileInputRef.current?.click()

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
    if (text.trim() === '' && attachments.files.length === 0) return
    const submitted = { text, files: attachments.files, status, kind, project }
    setText('')
    attachments.clear()
    setKind(null)
    setProject(CaptureProject.next({ sent: project, filter: props.projectFilter ?? null, reuse: reuseProject }))
    setStatusTouched(false)
    setStatus('inbox')
    setFailed(null)
    props.onClearStatus?.()
    const payload: Parameters<typeof api.capture>[0] = { text: text.trim() === '' ? (submitted.files[0]?.name ?? 'File capture') : text }
    if (statusTouched || (props.status !== undefined && props.status !== null)) payload.status = status
    if (kind !== null) payload.kind = kind
    if (project !== null) payload.project = project
    if (submitted.files.length > 0) payload.files = submitted.files.map(fileInput)
    actions.capture.mutate(payload, {
      onSuccess: () => captureProject.set(CaptureProject.remembered({ sent: submitted.project, reuse: reuseProject })),
      onError: error => {
        setFailed(errorMessage(error, 'The item was not saved.'))
        setTextState((current: string) => (current === '' ? submitted.text : current))
        attachments.restore(submitted.files)
        setStatus(submitted.status)
        setKind(submitted.kind)
        setProject(submitted.project)
      },
    })
  }

  const preview = useMemo(() => (text.trim() === '' ? null : BacklogItems.triage(text)), [text])
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
      {...drop.dragProps}
      className={cn(
        'dshx:relative dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:bg-card dshx:transition-[border-color,box-shadow] dshx:focus-within:border-input dshx:focus-within:shadow-sm',
        failed === null ? 'dshx:border-border' : 'dshx:border-destructive/60',
        drop.dragging && 'dshx:border-primary/60 dshx:ring-2 dshx:ring-primary/15',
        chat ? 'dshx:px-3 dshx:pt-2.5 dshx:pb-2' : 'dshx:px-2.5 dshx:py-1.5',
      )}
    >
      <MentionMenu suggestions={suggestions} highlight={highlight} label="Suggestions" onPick={pick} onHover={setHighlight} />

      <AttachmentTray files={attachments.files} onRemove={attachments.remove} />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={event => {
          void attachments.add([...(event.currentTarget.files ?? [])])
          event.currentTarget.value = ''
        }}
      />

      <textarea
        ref={input}
        aria-label="Capture"
        rows={3}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        value={text}
        onPaste={event => pasteFiles(event, files => void attachments.add(files))}
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
            // Project suggestions are the command's direct result, so Enter picks the highlighted project without first navigating.
            // Other inline suggestions keep Enter-to-send unless the user has moved the highlight.
            if (event.key === 'Tab' || (event.key === 'Enter' && BacklogProjectCommand.picksOnEnter(projectCommand, navigated))) {
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
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          if (event.shiftKey) {
            const continuation = continueMarkdownList({
              text,
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            })
            if (continuation === null) return
            event.preventDefault()
            setText(continuation.value)
            requestAnimationFrame(() => {
              input.current?.setSelectionRange(continuation.caret, continuation.caret)
              setCaret(continuation.caret)
            })
            return
          }
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
            <DropdownMenuItem onSelect={() => void addFromPicker()} className="dshx:gap-2 dshx:text-[13px]">
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
            disabled={text.trim() === '' && attachments.files.length === 0}
            className={cn(
              'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:transition-[background-color,opacity,transform] dshx:duration-100 dshx:active:scale-95',
              chat ? 'dshx:size-7' : 'dshx:size-6',
              text.trim() === '' && attachments.files.length === 0
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
            <HashIcon aria-hidden className="dshx:inline dshx:size-3" /> tags · <code>@</code> items, threads and projects · <code>/project</code> · paste or
            drop a file
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
