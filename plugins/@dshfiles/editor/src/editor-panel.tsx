import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ExternalLinkIcon, FileQuestionIcon, FolderOpenIcon, FolderTreeIcon, RefreshCwIcon, SaveIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { editorApi } from './api.js'
import type { CodeEditorEngine, CodeEditorHandle } from './code-editor.js'
import type { EditorStore, OpenDocument } from './editor-store.js'
import { FileTree } from './file-tree.js'

export interface EditorPanelProps {
  readonly store: EditorStore
  readonly remote: Pick<ClientRemote, 'workspaceFiles' | 'session'>
  readonly sessionId: SessionId | undefined
  readonly loadEngine: () => Promise<CodeEditorEngine>
}

type Dialog = { readonly kind: 'approve' | 'conflict' | 'discard'; readonly document: OpenDocument } | null

const subscribeToDarkTheme = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => observer.disconnect()
}
const isDarkTheme = (): boolean => document.body.hasAttribute('data-ds-dark-theme')

const DIALOG_COPY = {
  approve: {
    title: 'Write this file to disk?',
    description: 'The editor writes inside the session workspace only. Later saves of this tab will not ask again.',
    action: 'Save',
  },
  conflict: {
    title: 'File changed on disk',
    description: 'Someone (often an agent turn) changed this file after you opened it. Overwrite it with your buffer, or cancel and reload.',
    action: 'Overwrite',
  },
  discard: { title: 'Discard unsaved changes?', description: 'Closing this tab drops the edits that are not saved.', action: 'Discard' },
} as const

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Image and binary files: shown here, never handed to the editor engine. Open/reveal only when the Host has a desktop. */
const FilePreview = (props: { readonly document: OpenDocument; readonly remote: Pick<ClientRemote, 'session'> }): JSX.Element | null => {
  const content = props.document.content
  const absolutePath = props.document.absolutePath
  const desktop = useQuery({
    queryKey: ['dshfiles-editor', 'can-open-externally'],
    queryFn: async () => {
      const result = await props.remote.session.canOpenWorkspacePath()
      return result.ok && result.value
    },
    staleTime: Infinity,
  })
  const openExternally = useMutation({
    mutationFn: async (action: 'default' | 'reveal') => {
      if (absolutePath === null) throw new Error('The file has no Host path yet.')
      const result = await props.remote.session.openWorkspacePath(action === 'reveal' ? { path: absolutePath, action } : { path: absolutePath })
      if (!result.ok) throw new Error(result.error.message)
    },
  })
  if (content.kind === 'text') return null
  const actions = desktop.data === true && absolutePath !== null && (
    <div className="dshx:flex dshx:items-center dshx:gap-1">
      <Button disabled={openExternally.isPending} onClick={() => openExternally.mutate('default')} size="xs" variant="outline">
        <ExternalLinkIcon /> Open
      </Button>
      <Button disabled={openExternally.isPending} onClick={() => openExternally.mutate('reveal')} size="xs" variant="ghost">
        <FolderOpenIcon /> Show file location
      </Button>
    </div>
  )
  return (
    <div
      className="dshx:absolute dshx:inset-0 dshx:flex dshx:flex-col dshx:items-center dshx:justify-center dshx:gap-3 dshx:overflow-auto dshx:p-4"
      data-file-preview={content.kind}
    >
      {content.kind === 'image' ? (
        <img alt={props.document.name} className="dshx:max-h-[70%] dshx:max-w-full dshx:object-contain" src={content.url} />
      ) : (
        <FileQuestionIcon className="dshx:size-10 dshx:text-muted-foreground" />
      )}
      <p className="dshx:text-xs dshx:text-muted-foreground">
        {content.kind === 'image' ? 'Image' : 'Binary file'}
        {content.bytes === null ? '' : ` · ${formatBytes(content.bytes)}`}
      </p>
      {actions}
      {openExternally.isError && <p className="dshx:text-xs dshx:text-destructive">{errorMessage(openExternally.error, 'Could not open the file.')}</p>}
    </div>
  )
}

/** File tree, tabs and one editor surface for the session on screen. Usable as a right-pane tab or a docked panel. */
export const EditorPanel = (props: EditorPanelProps): JSX.Element => {
  const api = useApi(editorApi)
  const queryClient = useQueryClient()
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const dark = useSyncExternalStore(subscribeToDarkTheme, isDarkTheme, () => false)
  const sessionDocuments = state.documents.filter(document => document.sessionId === props.sessionId)
  const activeId = props.sessionId === undefined ? undefined : state.activeBySession[props.sessionId]
  const active = sessionDocuments.find(document => document.id === activeId)
  const [showTree, setShowTree] = useState(true)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [engineStatus, setEngineStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<CodeEditorHandle | null>(null)
  const appliedText = useRef(new Map<string, string>())
  const revealed = useRef(new Map<string, number>())
  const approved = useRef(new Set<string>())
  const requestSaveRef = useRef<() => void>(() => undefined)

  const save = useMutation({
    mutationFn: async (variables: { readonly document: OpenDocument; readonly overwrite: boolean }) => {
      const snapshot = handleRef.current?.snapshot(variables.document.id)
      if (snapshot === undefined) throw new Error('Nothing to save.')
      const result = await api.write({
        sessionId: variables.document.sessionId,
        path: variables.document.path,
        text: snapshot.text,
        expectedSha256: variables.document.sha256,
        overwrite: variables.overwrite,
      })
      if (result.status === 'conflict') {
        setDialog({ kind: 'conflict', document: variables.document })
        return
      }
      handleRef.current?.markSaved(variables.document.id, snapshot.version)
      props.store.saved(variables.document.id, result.sha256)
    },
  })

  requestSaveRef.current = () => {
    if (active === undefined || active.status !== 'ready' || active.content.kind !== 'text' || save.isPending) return
    // Host approval (`ctx.approval`) only answers for an Agent with an open turn; a user save has none, so the
    // panel asks once per open tab instead.
    if (!approved.current.has(active.id)) {
      setDialog({ kind: 'approve', document: active })
      return
    }
    save.mutate({ document: active, overwrite: false })
  }

  const editable = active?.status === 'ready' && active.content.kind === 'text'
  useEffect(() => {
    if (!editable || engineStatus !== 'idle') return
    setEngineStatus('loading')
    const started = performance.now()
    props.loadEngine().then(
      engine => {
        const container = containerRef.current
        if (container === null) return
        handleRef.current = engine.create(container, {
          dark: isDarkTheme(),
          onDirtyChange: (documentId, dirty) => props.store.setDirty(documentId, dirty),
          onSave: () => requestSaveRef.current(),
        })
        container.dataset.firstOpenMs = String(Math.round(performance.now() - started))
        setEngineStatus('ready')
      },
      () => setEngineStatus('error'),
    )
  }, [editable, engineStatus, props])

  useEffect(
    () => () => {
      handleRef.current?.dispose()
      handleRef.current = null
    },
    [],
  )

  useEffect(() => handleRef.current?.setDark(dark), [dark, engineStatus])

  useEffect(() => {
    const handle = handleRef.current
    if (handle === null) return
    const open = new Set(state.documents.map(document => document.id))
    for (const id of appliedText.current.keys()) {
      if (open.has(id)) continue
      handle.close(id)
      appliedText.current.delete(id)
    }
    if (active === undefined || active.status !== 'ready' || active.content.kind !== 'text') return
    const editorDocument = { id: active.id, path: active.path, text: active.text }
    const applied = appliedText.current.get(active.id)
    handle.show(editorDocument)
    if (applied !== undefined && applied !== active.text && handle.snapshot(active.id)?.text !== active.text) handle.reset(editorDocument)
    appliedText.current.set(active.id, active.text)
    if (active.reveal !== null && revealed.current.get(active.id) !== active.reveal.request) {
      revealed.current.set(active.id, active.reveal.request)
      handle.reveal(active.id, active.reveal.line)
    }
  }, [state.documents, active, engineStatus])

  if (props.sessionId === undefined) {
    return <p className="dshx-root dshx:p-3 dshx:text-xs dshx:text-muted-foreground">Open a session to browse and edit its files.</p>
  }
  const sessionId = props.sessionId

  const closeDocument = (document: OpenDocument): void => {
    if (document.dirty) setDialog({ kind: 'discard', document })
    else props.store.close(document.id)
  }

  const confirmDialog = (): void => {
    if (dialog === null) return
    if (dialog.kind === 'approve') {
      approved.current.add(dialog.document.id)
      save.mutate({ document: dialog.document, overwrite: false })
    }
    if (dialog.kind === 'conflict') save.mutate({ document: dialog.document, overwrite: true })
    if (dialog.kind === 'discard') props.store.close(dialog.document.id)
    setDialog(null)
  }

  return (
    <div
      className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background dshx:text-foreground"
      onKeyDownCapture={event => {
        if (event.key !== 's' || !(event.metaKey || event.ctrlKey)) return
        event.preventDefault()
        requestSaveRef.current()
      }}
    >
      <div className="dshx:flex dshx:h-8 dshx:flex-none dshx:items-center dshx:gap-1 dshx:border-b dshx:px-1">
        <Button aria-label="Toggle file tree" aria-pressed={showTree} onClick={() => setShowTree(value => !value)} size="icon-xs" variant="ghost">
          <FolderTreeIcon />
        </Button>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-0.5 dshx:overflow-x-auto" role="tablist">
          {sessionDocuments.map(document => (
            <div
              className={cn(
                'dshx:group/tab dshx:flex dshx:h-6 dshx:max-w-48 dshx:flex-none dshx:items-center dshx:gap-1 dshx:rounded-sm dshx:pr-0.5 dshx:pl-2 dshx:text-xs',
                document.id === activeId ? 'dshx:bg-accent dshx:font-medium' : 'dshx:text-muted-foreground dshx:hover:bg-accent/60',
              )}
              key={document.id}
            >
              <button
                aria-selected={document.id === activeId}
                className="dshx:min-w-0 dshx:truncate dshx:outline-none"
                onClick={() => props.store.activate(sessionId, document.id)}
                role="tab"
                title={document.path}
                type="button"
              >
                {document.name}
              </button>
              {document.dirty && <span aria-label="Unsaved changes" className="dshx:size-1.5 dshx:flex-none dshx:rounded-full dshx:bg-warning" />}
              <button
                aria-label={`Close ${document.name}`}
                className="dshx:flex dshx:size-4 dshx:flex-none dshx:items-center dshx:justify-center dshx:rounded-sm dshx:opacity-60 dshx:hover:bg-background dshx:hover:opacity-100"
                onClick={() => closeDocument(document)}
                type="button"
              >
                <XIcon className="dshx:size-3" />
              </button>
            </div>
          ))}
        </div>
        <Button
          aria-label="Save"
          disabled={!editable || save.isPending}
          onClick={() => requestSaveRef.current()}
          size="icon-xs"
          title="Save (⌘S)"
          variant="ghost"
        >
          <SaveIcon />
        </Button>
      </div>
      {showTree && (
        <div className="dshx:max-h-[40%] dshx:min-h-24 dshx:flex-none dshx:overflow-auto dshx:border-b">
          <div className="dshx:flex dshx:items-center dshx:justify-between dshx:px-2 dshx:pt-1 dshx:text-[11px] dshx:font-semibold dshx:tracking-wide dshx:text-muted-foreground dshx:uppercase">
            Files
            <Button
              aria-label="Refresh files"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['dshfiles-editor', 'list', sessionId] })}
              size="icon-xs"
              variant="ghost"
            >
              <RefreshCwIcon />
            </Button>
          </div>
          <FileTree activePath={active?.path ?? null} onOpen={path => props.store.open(sessionId, { path })} remote={props.remote} sessionId={sessionId} />
        </div>
      )}
      {active?.diskChanged === true && (
        <div className="dshx:flex dshx:flex-none dshx:items-center dshx:gap-2 dshx:border-b dshx:bg-warning/10 dshx:px-2 dshx:py-1 dshx:text-xs" role="status">
          <span className="dshx:min-w-0 dshx:flex-1">Changed on disk while you were editing.</span>
          <Button onClick={() => void props.store.reload(active.id)} size="xs" variant="outline">
            Reload
          </Button>
          <Button onClick={() => props.store.keepMine(active.id)} size="xs" variant="ghost">
            Keep mine
          </Button>
        </div>
      )}
      <div className="dshx:relative dshx:min-h-0 dshx:flex-1">
        <div className={cn('dshx:absolute dshx:inset-0', !editable && 'dshx:invisible')} data-editor-surface="" ref={containerRef} />
        {active?.status === 'ready' && <FilePreview document={active} remote={props.remote} />}
        {active === undefined && <p className="dshx:p-3 dshx:text-xs dshx:text-muted-foreground">Pick a file in the tree, or open one from another panel.</p>}
        {active?.status === 'loading' && <p className="dshx:p-3 dshx:text-xs dshx:text-muted-foreground">Loading {active.name}…</p>}
        {active?.status === 'error' && <p className="dshx:p-3 dshx:text-xs dshx:text-destructive">{active.error}</p>}
        {engineStatus === 'error' && <p className="dshx:p-3 dshx:text-xs dshx:text-destructive">The editor could not start.</p>}
      </div>
      <div className="dshx:flex dshx:h-6 dshx:flex-none dshx:items-center dshx:gap-2 dshx:border-t dshx:px-2 dshx:text-[11px] dshx:text-muted-foreground">
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate" title={active?.path}>
          {active?.path ?? ''}
        </span>
        {save.isPending && <span>Saving…</span>}
        {save.isError && <span className="dshx:text-destructive">{errorMessage(save.error, 'Save failed.')}</span>}
        {active !== undefined && !save.isPending && (
          <span>
            {active.content.kind !== 'text'
              ? 'Read-only'
              : active.dirty
                ? 'Unsaved'
                : active.sha256 === null && active.status === 'ready'
                  ? 'New file'
                  : 'Saved'}
          </span>
        )}
      </div>
      <AlertDialog onOpenChange={open => !open && setDialog(null)} open={dialog !== null}>
        {dialog !== null && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{DIALOG_COPY[dialog.kind].title}</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="dshx:block dshx:font-mono dshx:text-xs dshx:break-all">{dialog.document.path}</span>
                {DIALOG_COPY[dialog.kind].description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {dialog.kind === 'conflict' && (
                <Button
                  onClick={() => {
                    void props.store.reload(dialog.document.id)
                    setDialog(null)
                  }}
                  variant="outline"
                >
                  Reload from disk
                </Button>
              )}
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDialog}>{DIALOG_COPY[dialog.kind].action}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  )
}
