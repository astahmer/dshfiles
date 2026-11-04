import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InlineTitleEditor } from '@dshfiles/plugin-ui/components/ui/inline-title-editor'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ArrowLeftIcon } from '@dshfiles/plugin-ui/icons'
import { useMachine, waitFor } from '@dshfiles/plugin-ui/machine'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import { boardSyncMachine } from './board-sync-machine.js'
import type { EditorHandle, EditorModule } from './editor-contract.js'
import { loadEditor } from './editor-loader.js'
import type { Board, PendingSource } from './model.js'
import { type WhiteboardClient, WhiteboardUi } from './ui-model.js'

const REMOTE_POLL_MS = 4_000

const darkTheme = {
  subscribe: (listener: () => void): (() => void) => {
    const observer = new MutationObserver(listener)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  },
  read: (): 'light' | 'dark' => (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'),
}

const statusText = (state: string): string => {
  if (state === 'saving') return 'Saving…'
  if (state === 'dirty') return 'Unsaved changes'
  if (state === 'failed') return 'Not saved'
  if (state === 'conflict') return 'Changed elsewhere'
  return 'Saved'
}

/** The open board: Excalidraw (loaded on demand), autosave, agent-queued conversion and remote updates. */
function BoardEditor(props: {
  readonly api: WhiteboardClient
  readonly editor: EditorModule
  readonly board: Board
  readonly onBack: () => void
}): JSX.Element {
  const { api, editor, board } = props
  const queryClient = useQueryClient()
  const theme = useSyncExternalStore(darkTheme.subscribe, darkTheme.read, darkTheme.read)
  const [snapshot, send, actor] = useMachine(boardSyncMachine, {
    input: { boardId: board.board.id, revision: board.board.revision, save: WhiteboardUi.saveWith(api) },
  })
  const [handle, setHandle] = useState<EditorHandle | null>(null)
  const [title, setTitle] = useState(board.board.title)
  const [renaming, setRenaming] = useState(false)
  const [conversionError, setConversionError] = useState<string | null>(null)
  const converting = useRef<PendingSource | null>(null)
  const state = String(snapshot.value)

  useEffect(() => {
    const subscription = actor.on('saved', () => void queryClient.invalidateQueries({ queryKey: WhiteboardUi.keys.list(board.board.project) }))
    return () => subscription.unsubscribe()
  }, [actor, board.board.project, queryClient])

  /** Agent-queued source converts once per board version, after the editor is ready. */
  const convert = (pending: PendingSource, target: EditorHandle): void => {
    if (converting.current === pending) return
    converting.current = pending
    setConversionError(null)
    editor.convertPending(pending).then(
      converted => send({ type: 'CONVERTED', scene: target.appendElements(converted) }),
      (cause: unknown) => setConversionError(errorMessage(cause, 'The queued diagram could not be converted.')),
    )
  }
  // The latest `convert`, so the effects below re-run on data changes only, not on every render's new closure.
  const convertLatest = useRef(convert)
  convertLatest.current = convert
  useEffect(() => {
    if (handle !== null && board.pending !== null) convertLatest.current(board.pending, handle)
  }, [handle, board.pending])

  // A write by an agent or another tab: adopt it while nothing local is unsaved, else the next save reports a conflict.
  const summary = useQuery({
    queryKey: WhiteboardUi.keys.list(board.board.project),
    // No abort signal: a poll is tiny, and cancelling it when the board closes would only leave an aborted request.
    queryFn: () => api.list({ project: board.board.project, includeDeleted: true }),
    retry: false,
    refetchInterval: WhiteboardUi.pollingInterval(REMOTE_POLL_MS),
  })
  const boardId = board.board.id
  const remoteRevision = summary.data?.boards.find(candidate => candidate.id === boardId)?.revision
  const revision = snapshot.context.revision
  useEffect(() => {
    if (handle === null || remoteRevision === undefined || remoteRevision <= revision || state !== 'clean') return
    let current = true
    void api.read({ boardId }).then(
      next => {
        if (!current || actor.getSnapshot().value !== 'clean') return
        handle.replaceScene(next.scene)
        setTitle(next.board.title)
        send({ type: 'SYNCED', revision: next.board.revision })
        if (next.pending !== null) convertLatest.current(next.pending, handle)
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [actor, api, boardId, handle, remoteRevision, revision, send, state])

  // Leaving the board saves what is still waiting for the debounce. The actor stops with this component, so the
  // last save runs outside it, unaborted.
  useEffect(
    () => () => {
      const last = actor.getSnapshot()
      if (last.value !== 'dirty' || last.context.scene === null) return
      const request = {
        boardId: last.context.boardId,
        expectedRevision: last.context.revision,
        scene: last.context.scene,
        clearPending: last.context.clearPending,
      }
      void WhiteboardUi.saveWith(api)(request, new AbortController().signal).then(
        () => queryClient.invalidateQueries({ queryKey: WhiteboardUi.keys.all }),
        () => undefined,
      )
    },
    [actor, api, queryClient],
  )

  const rename = useMutation({
    mutationFn: (next: string) => api.rename({ boardId: board.board.id, expectedRevision: revision, title: next }),
    onSuccess: renamed => {
      setTitle(renamed.title)
      send({ type: 'SYNCED', revision: renamed.revision })
      void queryClient.invalidateQueries({ queryKey: WhiteboardUi.keys.list(board.board.project) })
    },
  })

  /** Back to the list only once the drawing is saved; a failed or conflicting save keeps the board open with its alert. */
  const leave = (): void => {
    if (actor.getSnapshot().value === 'clean') return props.onBack()
    actor.send({ type: 'FLUSH' })
    void waitFor(actor, current => current.value === 'clean' || current.value === 'failed' || current.value === 'conflict', { timeout: 30_000 }).then(
      settled => (settled.value === 'clean' ? props.onBack() : undefined),
      () => undefined,
    )
  }

  const reloadTheirs = (): void => {
    void api.read({ boardId: board.board.id }).then(next => {
      handle?.replaceScene(next.scene)
      setTitle(next.board.title)
      send({ type: 'SYNCED', revision: next.board.revision })
    })
  }

  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col">
      <header className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-3 dshx:py-2">
        <Button variant="ghost" size="sm" className="dshx:shrink" onClick={leave}>
          <ArrowLeftIcon /> <span className="dshx:@max-pane-narrow:sr-only">Boards</span>
        </Button>
        <div className="dshx:min-w-0 dshx:flex-1">
          {renaming ? (
            <InlineTitleEditor
              value={title}
              label="Board title"
              maxLength={120}
              onCommit={next => {
                setRenaming(false)
                rename.mutate(next)
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <button
              type="button"
              className="dshx:block dshx:max-w-full dshx:truncate dshx:text-left dshx:text-sm dshx:font-medium dshx:disabled:cursor-default"
              aria-label={`Rename ${title}`}
              disabled={state !== 'clean'}
              onClick={() => setRenaming(true)}
            >
              <h1 className="dshx:truncate">{title}</h1>
            </button>
          )}
        </div>
        <span role="status" className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">
          {statusText(state)}
        </span>
        {state === 'failed' ? (
          <Button variant="outline" size="sm" onClick={() => send({ type: 'RETRY' })}>
            Retry
          </Button>
        ) : null}
      </header>

      {state === 'conflict' ? (
        <Alert variant="warning" className="dshx:rounded-none dshx:border-x-0 dshx:border-t-0">
          <AlertTitle>This board was changed elsewhere</AlertTitle>
          <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            An agent or another tab saved a newer version. Load theirs (your unsaved strokes are discarded) or keep yours (it replaces theirs).
            <Button size="sm" variant="outline" onClick={reloadTheirs}>
              Load newer version
            </Button>
            <Button size="sm" onClick={() => send({ type: 'OVERWRITE' })}>
              Keep mine
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === 'failed' ? (
        <Alert variant="destructive" className="dshx:rounded-none dshx:border-x-0 dshx:border-t-0">
          <AlertDescription>
            {snapshot.context.error ?? 'The whiteboard could not be saved.'} Your drawing is still on screen; Retry saves it again.
          </AlertDescription>
        </Alert>
      ) : null}
      {rename.isError ? (
        <Alert variant="destructive" className="dshx:rounded-none dshx:border-x-0 dshx:border-t-0">
          <AlertDescription>{errorMessage(rename.error, 'The board could not be renamed.')} Wait for “Saved”, then rename again.</AlertDescription>
        </Alert>
      ) : null}
      {conversionError === null ? null : (
        <Alert variant="warning" className="dshx:rounded-none dshx:border-x-0 dshx:border-t-0">
          <AlertTitle>The queued diagram could not be drawn</AlertTitle>
          <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            {conversionError} Ask the agent to fix the source with whiteboard_write, or discard it.
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (handle === null) return
                setConversionError(null)
                send({ type: 'CONVERTED', scene: handle.scene() })
              }}
            >
              Discard queued diagram
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="dshx:relative dshx:min-h-0 dshx:flex-1" data-testid="whiteboard-canvas">
        <editor.WhiteboardCanvas initialScene={board.scene} theme={theme} onChange={scene => send({ type: 'EDIT', scene })} onReady={setHandle} />
      </div>
    </div>
  )
}

/** Loads the board and, in parallel, the editor bundle; either failure offers a retry. */
export function BoardView(props: { readonly api: WhiteboardClient; readonly boardId: string; readonly onBack: () => void }): JSX.Element {
  const board = useQuery({
    queryKey: WhiteboardUi.keys.board(props.boardId),
    queryFn: ({ signal }) => props.api.read({ boardId: props.boardId }, { signal }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const editor = useQuery({ queryKey: WhiteboardUi.keys.editor, queryFn: () => loadEditor(), retry: false, staleTime: Number.POSITIVE_INFINITY })
  const failure = board.error ?? editor.error
  if (failure !== null) {
    return (
      <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-3 dshx:p-5">
        <Button variant="ghost" size="sm" className="dshx:self-start" onClick={props.onBack}>
          <ArrowLeftIcon /> Boards
        </Button>
        <Alert variant="destructive">
          <AlertTitle>{board.isError ? 'This whiteboard could not be opened' : 'The whiteboard editor could not be loaded'}</AlertTitle>
          <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            {errorMessage(failure, 'The Host did not answer.')}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (board.isError) void board.refetch()
                if (editor.isError) void editor.refetch()
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  if (board.data === undefined || editor.data === undefined) {
    return (
      <div className="dshx-root dshx:flex dshx:items-center dshx:gap-2 dshx:p-5 dshx:text-sm dshx:text-muted-foreground">
        <Spinner /> {board.data === undefined ? 'Opening whiteboard…' : 'Loading the editor…'}
      </div>
    )
  }
  return <BoardEditor key={props.boardId} api={props.api} editor={editor.data} board={board.data} onBack={props.onBack} />
}
