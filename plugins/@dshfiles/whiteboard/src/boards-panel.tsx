import { isApiOwnerMissing } from '@dshfiles/dshx/api'
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
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { InlineTitleEditor } from '@dshfiles/plugin-ui/components/ui/inline-title-editor'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { PageHeader } from '@dshfiles/plugin-ui/components/ui/page-header'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { PencilIcon, PlusIcon, PresentationIcon, RotateCcwIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient, type UseQueryResult } from '@dshfiles/plugin-ui/query'
import { useState, type JSX } from 'react'
import type { BoardSummary } from './model.js'
import { type ProjectChoice, type WhiteboardClient, WhiteboardUi } from './ui-model.js'

const LIST_POLL_MS = 5_000

function NewBoardDialog(props: {
  readonly open: boolean
  readonly busy: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onCreate: (title: string) => void
}): JSX.Element {
  const [title, setTitle] = useState('Untitled board')
  const trimmed = title.trim()
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="dshx-root dshx:sm:max-w-md">
        <form
          className="dshx:flex dshx:flex-col dshx:gap-4"
          onSubmit={event => {
            event.preventDefault()
            if (trimmed !== '') props.onCreate(trimmed)
          }}
        >
          <DialogHeader>
            <DialogTitle>New whiteboard</DialogTitle>
            <DialogDescription>The board is saved on this DSH Host under the selected project.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Board title" autoFocus maxLength={120} value={title} onChange={event => setTitle(event.currentTarget.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed === '' || props.busy}>
              {props.busy ? <Spinner /> : <PlusIcon />} Create board
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BoardRow(props: {
  readonly board: BoardSummary
  /** When the list was last fetched, so relative times are stable within one render. */
  readonly now: number
  readonly onOpen: () => void
  readonly onRename: (title: string) => void
  readonly onDelete: () => void
}): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const { board } = props
  return (
    <li className="dshx:flex dshx:items-center dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2">
      <PresentationIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
        {renaming ? (
          <InlineTitleEditor
            value={board.title}
            label={`Rename ${board.title}`}
            maxLength={120}
            onCommit={title => {
              setRenaming(false)
              props.onRename(title)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <button type="button" className="dshx:min-w-0 dshx:truncate dshx:text-left dshx:text-sm dshx:font-medium dshx:hover:underline" onClick={props.onOpen}>
            {board.title}
          </button>
        )}
        <span className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground">
          {board.elementCount === 1 ? '1 element' : `${String(board.elementCount)} elements`} · edited {WhiteboardUi.editedAgo(board.updatedAt, props.now)}
        </span>
      </div>
      {board.pending === null ? null : (
        <Badge variant="secondary" className="dshx:@max-pane-narrow:hidden">
          {WhiteboardUi.pendingLabel(board.pending)}
        </Badge>
      )}
      <Button variant="ghost" size="icon" className="dshx:size-8" aria-label={`Rename ${board.title}`} onClick={() => setRenaming(true)}>
        <PencilIcon />
      </Button>
      <Button variant="ghost" size="icon" className="dshx:size-8" aria-label={`Delete ${board.title}`} onClick={props.onDelete}>
        <Trash2Icon />
      </Button>
    </li>
  )
}

/** The list region in its one current state: no project, Host missing, failed, loading, empty, or the boards. */
function BoardsBody(props: {
  readonly hasProject: boolean
  readonly list: UseQueryResult<{ readonly boards: readonly BoardSummary[] }, unknown>
  readonly boards: readonly BoardSummary[]
  readonly onCreate: () => void
  readonly onOpen: (board: BoardSummary) => void
  readonly onRename: (board: BoardSummary, title: string) => void
  readonly onDelete: (board: BoardSummary) => void
}): JSX.Element {
  const { list } = props
  if (!props.hasProject)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No project yet</EmptyTitle>
          <EmptyDescription>Whiteboards belong to a project. Add a project folder to DSH, then come back here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  if (isApiOwnerMissing(list.error instanceof Error ? list.error : null))
    return (
      <Alert variant="warning">
        <AlertTitle>The whiteboard Host plugin is not running</AlertTitle>
        <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          Retry once DSH is back; if it keeps failing, restart DSH so the updated @dshfiles/whiteboard Host bundle loads, then reload this page.
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  if (list.isError)
    return (
      <Alert variant="destructive">
        <AlertTitle>Whiteboards could not be listed</AlertTitle>
        <AlertDescription className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          {errorMessage(list.error, 'The Host did not answer.')}
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  if (list.isPending)
    return (
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
        <Spinner /> Loading whiteboards…
      </div>
    )
  if (props.boards.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PresentationIcon />
          </EmptyMedia>
          <EmptyTitle>No whiteboards yet</EmptyTitle>
          <EmptyDescription>Sketch an idea yourself, or ask an agent to draw one with whiteboard_write.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={props.onCreate}>
            <PlusIcon /> New board
          </Button>
        </EmptyContent>
      </Empty>
    )
  return (
    <ul aria-label="Whiteboards" className="dshx:flex dshx:flex-col dshx:gap-2">
      {props.boards.map(board => (
        <BoardRow
          key={board.id}
          board={board}
          now={list.dataUpdatedAt}
          onOpen={() => props.onOpen(board)}
          onRename={title => props.onRename(board, title)}
          onDelete={() => props.onDelete(board)}
        />
      ))}
    </ul>
  )
}

/** The Whiteboards page: one project's boards, with create, open, rename, delete and Recently deleted. */
export function BoardsPanel(props: {
  readonly api: WhiteboardClient
  readonly projects: readonly ProjectChoice[]
  readonly project: string | null
  readonly onProjectChange: (project: string) => void
  readonly onOpen: (board: BoardSummary) => void
}): JSX.Element {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<BoardSummary | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const project = props.project
  const list = useQuery({
    queryKey: WhiteboardUi.keys.list(project),
    // No abort signal: a poll is tiny, and cancelling it when the page closes would only leave an aborted request.
    queryFn: () => props.api.list(project === null ? { includeDeleted: true } : { project, includeDeleted: true }),
    enabled: project !== null,
    retry: false,
    refetchInterval: WhiteboardUi.pollingInterval(LIST_POLL_MS),
    refetchOnWindowFocus: true,
  })
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: WhiteboardUi.keys.all })
  const failed = (fallback: string) => (error: unknown) => setNotice(errorMessage(error, fallback))
  const create = useMutation({
    mutationFn: (title: string) => {
      if (project === null) throw new Error('Choose a project before creating a whiteboard.')
      return props.api.write({ project, title })
    },
    onSuccess: board => {
      setCreating(false)
      void refresh()
      props.onOpen(board)
    },
    onError: failed('The whiteboard could not be created. Try again.'),
  })
  const rename = useMutation({
    mutationFn: (input: { readonly board: BoardSummary; readonly title: string }) =>
      props.api.rename({ boardId: input.board.id, expectedRevision: input.board.revision, title: input.title }),
    onSuccess: () => void refresh(),
    onError: failed('The whiteboard could not be renamed. Reload the list and try again.'),
  })
  const remove = useMutation({
    mutationFn: (board: BoardSummary) => props.api.delete({ boardId: board.id, confirm: true }),
    onSuccess: board => {
      setDeleting(null)
      setNotice(`Moved “${board.title}” to Recently deleted. Restore it there to bring it back.`)
      void refresh()
    },
    onError: failed('The whiteboard could not be deleted. Try again.'),
  })
  const restore = useMutation({
    mutationFn: (board: BoardSummary) => props.api.restore({ boardId: board.id }),
    onSuccess: () => {
      setNotice(null)
      void refresh()
    },
    onError: failed('The whiteboard could not be restored. Try again.'),
  })

  const boards = list.data?.boards ?? []
  const live = boards.filter(board => board.deletedAt === null)
  const deleted = boards.filter(board => board.deletedAt !== null)
  const projectTitle = props.projects.find(choice => choice.path === project)?.title ?? 'this project'

  return (
    <main className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-4 dshx:overflow-y-auto dshx:p-5 dshx:@max-pane-narrow:p-3">
      <PageHeader heading="Whiteboards" description={`Excalidraw boards saved for ${projectTitle}. Agents can list, read and draw on them.`}>
        {props.projects.length > 1 ? (
          <Select {...(project === null ? {} : { value: project })} onValueChange={props.onProjectChange}>
            <SelectTrigger aria-label="Project" size="sm" className="dshx:max-w-56">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {props.projects.map(choice => (
                <SelectItem key={choice.path} value={choice.path}>
                  {choice.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button size="sm" disabled={project === null} onClick={() => setCreating(true)}>
          <PlusIcon /> New board
        </Button>
      </PageHeader>

      {notice === null ? null : (
        <Alert>
          <AlertDescription className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
            <span className="dshx:min-w-0">{notice}</span>
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <BoardsBody
        hasProject={project !== null}
        list={list}
        boards={live}
        onCreate={() => setCreating(true)}
        onOpen={props.onOpen}
        onRename={(board, title) => rename.mutate({ board, title })}
        onDelete={setDeleting}
      />

      {deleted.length === 0 ? null : (
        <section aria-label="Recently deleted" className="dshx:flex dshx:flex-col dshx:gap-2">
          <h2 className="dshx:text-sm dshx:font-medium dshx:text-muted-foreground">Recently deleted</h2>
          <ul className="dshx:flex dshx:flex-col dshx:gap-1">
            {deleted.map(board => (
              <li key={board.id} className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-3 dshx:py-1.5 dshx:text-sm">
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-muted-foreground">{board.title}</span>
                <Button variant="outline" size="sm" className="dshx:shrink" disabled={restore.isPending} onClick={() => restore.mutate(board)}>
                  <RotateCcwIcon /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NewBoardDialog open={creating} busy={create.isPending} onOpenChange={setCreating} onCreate={title => create.mutate(title)} />
      <AlertDialog open={deleting !== null} onOpenChange={open => (open ? undefined : setDeleting(null))}>
        <AlertDialogContent className="dshx-root">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>The board moves to Recently deleted with its drawing intact; you can restore it from there.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={event => {
                event.preventDefault()
                if (deleting !== null) remove.mutate(deleting)
              }}
            >
              Delete board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
