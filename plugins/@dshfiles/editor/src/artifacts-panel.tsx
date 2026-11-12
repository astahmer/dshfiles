import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useApi } from '@dshfiles/dshx/client'
import { EmptyState, Page } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ChevronLeftIcon, EllipsisIcon, FileCodeIcon, FileTextIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
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
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import { editorArtifactsApi } from './artifacts-api.js'
import type { CodeEditorEngine, CodeEditorHandle } from './code-editor.js'
import { createArtifactDrafts, type ArtifactDraftSource } from './artifact-drafts.js'

const ArtifactEditor = (props: {
  readonly sessionId: string
  readonly artifact: ArtifactDraftSource
  readonly drafts: ReturnType<typeof createArtifactDrafts>
  readonly occurrence: string
  readonly loadEngine: () => Promise<CodeEditorEngine>
  readonly onClose: () => void
  /** Below the narrow-pane width the list and the editor stack; Back returns to the list. */
  readonly onBack?: () => void
}): JSX.Element => {
  const api = useApi(editorArtifactsApi)
  const queryClient = useQueryClient()
  const initial = props.drafts.get(props.artifact.id)
  const [artifact, setArtifact] = useState(initial?.artifact ?? props.artifact)
  const [title, setTitle] = useState(initial?.title ?? props.artifact.title)
  const [dirty, setDirty] = useState(initial !== undefined && initial.content !== initial.artifact.content)
  const restoredDirty = useRef(initial !== undefined && initial.content !== initial.artifact.content)
  const titleRef = useRef(title)
  titleRef.current = title
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReload, setConfirmReload] = useState(false)
  const [engineError, setEngineError] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const handle = useRef<CodeEditorHandle | null>(null)
  const saveRef = useRef<() => void>(() => undefined)
  const modelId = `${props.occurrence}:${props.sessionId}:${props.artifact.id}`
  const listKey = ['dshfiles-editor', 'artifacts', props.sessionId]
  // The mount effect owns one buffer per artifact id; later draft/save updates must not remount it.
  const mount = useRef({ content: initial?.content ?? props.artifact.content, artifact: props.artifact, drafts: props.drafts })
  mount.current.drafts = props.drafts
  useEffect(() => {
    const { content, artifact, drafts } = mount.current
    const loadEngine = props.loadEngine
    let cancelled = false
    void loadEngine()
      .then(engine => {
        if (cancelled || container.current === null) return
        const editor = engine.create(container.current, {
          dark: document.body.hasAttribute('data-ds-dark-theme'),
          onDirtyChange: (_id, value) => setDirty(restoredDirty.current || value),
          onSave: () => saveRef.current(),
        })
        handle.current = editor
        editor.show({ id: modelId, path: `/${artifact.title}`, text: content })
        editor.focus()
      })
      .catch(() => {
        if (!cancelled) setEngineError(true)
      })
    return () => {
      cancelled = true
      const buffer = handle.current?.snapshot(modelId)
      drafts.capture(artifact.id, titleRef.current, buffer?.text ?? content)
      handle.current?.dispose()
      handle.current = null
    }
  }, [modelId, props.loadEngine])
  const save = useMutation({
    mutationFn: async () => {
      const buffer = handle.current?.snapshot(modelId)
      if (buffer === undefined) throw new Error('Editor is not ready. Reopen the artifact and try again.')
      const result = await api.update({ sessionId: props.sessionId, id: artifact.id, expectedRevision: artifact.revision, title, content: buffer.text })
      if ('status' in result) throw new Error(`Artifact changed elsewhere (revision ${result.currentRevision}). Copy your edits, then use Reload.`)
      return { artifact: result.artifact, version: buffer.version }
    },
    onSuccess: result => {
      props.drafts.saved(result.artifact)
      setArtifact(result.artifact)
      restoredDirty.current = false
      handle.current?.markSaved(modelId, result.version)
      setDirty(handle.current?.isDirty(modelId) ?? false)
      void queryClient.invalidateQueries({ queryKey: listKey })
    },
  })
  saveRef.current = () => {
    if (!save.isPending && !reload.isPending && !remove.isPending && title.trim() !== '') save.mutate()
  }
  const reload = useMutation({
    mutationFn: () => api.read({ sessionId: props.sessionId, id: artifact.id }),
    onSuccess: result => {
      props.drafts.reload(result.artifact)
      restoredDirty.current = false
      setDirty(false)
      setArtifact(result.artifact)
      setTitle(result.artifact.title)
      handle.current?.reset({ id: modelId, path: `/${result.artifact.title}`, text: result.artifact.content })
      save.reset()
    },
  })
  const remove = useMutation({
    mutationFn: async () => {
      const result = await api.delete({ sessionId: props.sessionId, id: artifact.id, expectedRevision: artifact.revision, confirm: true })
      if ('status' in result) throw new Error(`Artifact changed elsewhere (revision ${result.currentRevision}). Use Reload before deleting.`)
    },
    onSuccess: () => {
      props.drafts.delete(artifact.id)
      void queryClient.invalidateQueries({ queryKey: listKey })
      props.onClose()
    },
  })
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:p-2">
        {props.onBack === undefined ? null : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back to artifacts"
            className="dshx:hidden dshx:@max-pane-narrow:inline-flex dshx:pointer-coarse:size-11"
            onClick={props.onBack}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
        )}
        <Input aria-label="Artifact title" className="dshx:h-8 dshx:min-w-0 dshx:flex-1" value={title} onChange={event => setTitle(event.target.value)} />
        <Button
          size="sm"
          disabled={save.isPending || reload.isPending || remove.isPending || title.trim() === '' || (!dirty && title === artifact.title)}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More artifact actions" disabled={save.isPending || reload.isPending || remove.isPending}>
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="dshx-root">
            <DropdownMenuItem onSelect={() => setConfirmReload(true)}>
              <RefreshCwIcon aria-hidden />
              Reload
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <Trash2Icon aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {(save.isError || reload.isError || remove.isError || engineError) && (
        <p role="alert" className="dshx:p-2 dshx:text-xs dshx:text-destructive">
          {engineError
            ? 'Editor could not load. Reopen the view to retry.'
            : errorMessage(save.error ?? reload.error ?? remove.error, 'Action failed. Try again.')}
        </p>
      )}
      <div aria-label="Artifact content" className="dshx:min-h-0 dshx:flex-1" ref={container} />
      <AlertDialog open={confirmReload} onOpenChange={setConfirmReload}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reload artifact?</AlertDialogTitle>
            <AlertDialogDescription>Reloading discards unsaved changes in this view.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => reload.mutate()}>Reload</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete artifact?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes the artifact and its saved content.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const ThreadArtifacts = (props: {
  readonly sessionId: string
  readonly occurrence: string
  readonly active: boolean
  readonly loadEngine: () => Promise<CodeEditorEngine>
}): JSX.Element => {
  const api = useApi(editorArtifactsApi)
  const queryClient = useQueryClient()
  const listKey = ['dshfiles-editor', 'artifacts', props.sessionId]
  const list = useQuery({ queryKey: listKey, queryFn: ({ signal }) => api.list({ sessionId: props.sessionId }, { signal }) })
  const [selected, setSelected] = useState<string | null>(null)
  const [opened, setOpened] = useState<readonly ArtifactDraftSource[]>([])
  const [drafts] = useState(createArtifactDrafts)
  const read = useMutation({
    mutationFn: (id: string) => api.read({ sessionId: props.sessionId, id }),
    onSuccess: result => {
      drafts.open(result.artifact)
      setOpened(current => (current.some(item => item.id === result.artifact.id) ? current : [...current, result.artifact]))
      setSelected(result.artifact.id)
    },
  })
  const create = useMutation({
    mutationFn: (kind: 'markdown' | 'html') =>
      api.create({
        sessionId: props.sessionId,
        title: kind === 'html' ? 'Untitled.html' : 'Untitled.md',
        mimeType: kind === 'html' ? 'text/html' : 'text/markdown',
        content: '',
      }),
    onSuccess: result => {
      drafts.open(result.artifact)
      setOpened(current => [...current, result.artifact])
      setSelected(result.artifact.id)
      void queryClient.invalidateQueries({ queryKey: listKey })
    },
  })
  const failure = list.error ?? read.error ?? create.error
  const artifacts = list.data?.artifacts ?? []
  const editing = opened.some(item => item.id === selected)
  return (
    <Page
      fill
      heading="Artifacts"
      {...(list.data === undefined ? {} : { count: artifacts.length })}
      bodyClassName="dshx:gap-0"
      // One primary (b:ysaj): the kinds are a menu, not three stacked buttons.
      primaryAction={{
        id: 'new',
        label: 'New',
        icon: <PlusIcon aria-hidden />,
        pending: create.isPending,
        onSelect: () => undefined,
        items: [
          { id: 'new-markdown', label: 'Markdown', icon: <FileTextIcon aria-hidden />, onSelect: () => create.mutate('markdown') },
          { id: 'new-html', label: 'HTML', icon: <FileCodeIcon aria-hidden />, onSelect: () => create.mutate('html') },
        ],
      }}
      actions={[
        {
          id: 'refresh',
          label: 'Refresh',
          icon: <RefreshCwIcon aria-hidden />,
          pending: list.isFetching,
          placement: 'overflow',
          onSelect: () => void list.refetch(),
        },
      ]}
    >
      <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border">
        <nav
          aria-label="Artifacts"
          className={cn(
            'dshx:flex dshx:w-56 dshx:shrink-0 dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:border-r dshx:border-border dshx:p-1.5 dshx:@max-pane-narrow:w-full dshx:@max-pane-narrow:border-r-0',
            editing && 'dshx:@max-pane-narrow:hidden',
          )}
        >
          {list.isPending ? (
            <div className="dshx:flex dshx:justify-center dshx:py-6">
              <Spinner />
            </div>
          ) : null}
          {list.data !== undefined && artifacts.length === 0 ? <EmptyState>No artifacts in this thread yet. New makes one.</EmptyState> : null}
          {artifacts.map(item => (
            <Button
              className="dshx:w-full dshx:min-w-0 dshx:shrink dshx:justify-start dshx:pointer-coarse:h-11"
              key={item.id}
              size="sm"
              variant={selected === item.id ? 'secondary' : 'ghost'}
              aria-current={selected === item.id ? 'true' : undefined}
              onClick={() => {
                if (opened.some(open => open.id === item.id)) setSelected(item.id)
                else read.mutate(item.id)
              }}
            >
              <span className="dshx:min-w-0 dshx:truncate">{item.title}</span>
            </Button>
          ))}
          {failure === null ? null : (
            <div role="alert" className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-2 dshx:p-2 dshx:text-xs dshx:text-destructive">
              {errorMessage(failure, 'Could not load artifacts. Try again.')}
              {list.isError ? (
                <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
                  Retry
                </Button>
              ) : null}
            </div>
          )}
        </nav>
        <div className={cn('dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1', !editing && 'dshx:@max-pane-narrow:hidden')}>
          {editing ? null : (
            <p className="dshx:m-auto dshx:max-w-[40ch] dshx:p-4 dshx:text-center dshx:text-sm dshx:text-muted-foreground">Choose an artifact to edit it.</p>
          )}
          {opened
            .filter(item => props.active && selected === item.id)
            .map(item => (
              <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1" key={item.id}>
                <ArtifactEditor
                  artifact={item}
                  drafts={drafts}
                  sessionId={props.sessionId}
                  occurrence={props.occurrence}
                  loadEngine={props.loadEngine}
                  onBack={() => setSelected(null)}
                  onClose={() => {
                    setOpened(current => current.filter(open => open.id !== item.id))
                    setSelected(null)
                  }}
                />
              </div>
            ))}
        </div>
      </div>
    </Page>
  )
}

export const ArtifactsPanel = (props: { readonly sessionId: string | undefined; readonly loadEngine: () => Promise<CodeEditorEngine> }): JSX.Element => {
  const [occurrence] = useState(() => randomUUID())
  const [sessions, setSessions] = useState<readonly string[]>([])
  useEffect(() => {
    if (props.sessionId !== undefined) setSessions(current => (current.includes(props.sessionId ?? '') ? current : [...current, props.sessionId ?? '']))
  }, [props.sessionId])
  return (
    <div className="dshx-root dshx:h-full dshx:min-h-0 dshx:bg-background dshx:text-foreground">
      {props.sessionId === undefined && (
        <Page heading="Artifacts">
          <EmptyState>Open a thread to see its artifacts.</EmptyState>
        </Page>
      )}
      {sessions.map(sessionId => (
        <div key={sessionId} className="dshx:h-full" style={{ display: sessionId === props.sessionId ? 'block' : 'none' }}>
          <ThreadArtifacts sessionId={sessionId} occurrence={occurrence} active={sessionId === props.sessionId} loadEngine={props.loadEngine} />
        </div>
      ))}
    </div>
  )
}
