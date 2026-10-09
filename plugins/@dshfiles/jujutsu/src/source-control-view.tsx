import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  FileDiffIcon,
  FilePenLineIcon,
  PencilIcon,
  PencilLineIcon,
  PlusIcon,
  RefreshCwIcon,
  ScissorsIcon,
  Undo2Icon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useMemo, useState, type ReactNode } from 'react'
import { jujutsuApi, type FileStat, type Mutation, type Revision } from './api.js'
import { ChangedFiles, FileViewToggle, type FileView } from './changed-files.js'
import { describeDraftChanged } from './graph.js'
import type { refreshQueryOptions } from './auto-refresh.js'
import { ANCESTOR_COUNT_OPTIONS } from './preferences.js'
import { sourceControlGroups } from './source-control.js'

interface SourceControlViewProps {
  readonly repoId: string
  readonly repositoryRoot: string
  readonly revisions: readonly Revision[]
  readonly ancestorCount: number
  readonly onAncestorCountChange: (count: number) => void
  readonly fileView: FileView
  readonly onFileViewChange: (view: FileView) => void
  readonly busy: boolean
  readonly onAction: (action: Mutation) => void
  readonly onOpenDiff: (revision: Revision, focusPath: string | null) => void
  readonly onRefresh: () => void
  readonly refreshOptions: ReturnType<typeof refreshQueryOptions>
}

const firstLine = (description: string): string => description.split('\n')[0] || '(no description)'

const IconAction = (props: {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly children: ReactNode
}): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        aria-label={props.label}
        className="dshx:size-5 dshx:text-muted-foreground dshx:hover:text-foreground"
        disabled={props.disabled}
        onClick={event => {
          event.stopPropagation()
          props.onClick()
        }}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {props.children}
      </Button>
    </TooltipTrigger>
    <TooltipContent className="dshx-root">{props.label}</TooltipContent>
  </Tooltip>
)

/** jj-view style Source Control: a describe box for @, then the working copy and @-1 … @-N groups. */
export const SourceControlView = (props: SourceControlViewProps): JSX.Element => {
  const api = useApi(jujutsuApi)
  const groups = useMemo(() => sourceControlGroups(props.revisions, props.ancestorCount), [props.revisions, props.ancestorCount])
  const commitIds = groups.map(group => group.revision.commitId)
  const filesQuery = useQuery({
    queryKey: ['jujutsu', props.repoId, 'revision-files', commitIds.join(',')],
    queryFn: ({ signal }) => api.revisionFiles({ repoId: props.repoId, commitIds }, { signal }),
    enabled: commitIds.length > 0,
    ...props.refreshOptions,
  })
  const filesByCommit = useMemo(() => new Map(filesQuery.data?.revisions.map(row => [row.commitId, row.files]) ?? []), [filesQuery.data])
  const workingCopy = groups[0]?.revision
  const [messageDraft, setMessageDraft] = useState<{ readonly commitId: string; readonly text: string } | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [describing, setDescribing] = useState<{ readonly commitId: string; readonly text: string } | null>(null)
  const [selection, setSelection] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [splitMessages, setSplitMessages] = useState<Readonly<Record<string, string>>>({})

  const message =
    workingCopy === undefined ? '' : messageDraft?.commitId === workingCopy.commitId ? messageDraft.text : workingCopy.description.replace(/\n+$/, '')
  const messageChanged = workingCopy !== undefined && describeDraftChanged(message, workingCopy.description)
  const commitMessage = message.trim()

  const commit = (): void => {
    if (workingCopy === undefined || commitMessage.length === 0) return
    props.onAction({ kind: 'commit', commitId: workingCopy.commitId, message })
  }

  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
      <div className="dshx:flex dshx:flex-none dshx:flex-col dshx:gap-1.5 dshx:border-b dshx:px-3 dshx:py-2">
        <div className="dshx:flex dshx:items-center dshx:gap-1">
          <span className="dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">Changes</span>
          <div className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-0.5">
            <FileViewToggle onChange={props.onFileViewChange} value={props.fileView} />
            {workingCopy !== undefined && (
              <IconAction
                disabled={props.busy}
                label="New change on top of @ (jj new)"
                onClick={() => props.onAction({ kind: 'new', commitId: workingCopy.commitId })}
              >
                <PlusIcon />
              </IconAction>
            )}
            <IconAction label="Refresh" onClick={props.onRefresh}>
              {filesQuery.isFetching ? <Spinner className="dshx:size-3" /> : <RefreshCwIcon />}
            </IconAction>
            <Select onValueChange={value => props.onAncestorCountChange(Number(value))} value={String(props.ancestorCount)}>
              <SelectTrigger aria-label="Ancestor groups" className="dshx:h-6 dshx:gap-1 dshx:px-1.5 dshx:text-[11px]" size="sm" title="Ancestor groups shown">
                <span className="dshx:text-muted-foreground">@-</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="dshx-root">
                {ANCESTOR_COUNT_OPTIONS.map(option => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {workingCopy !== undefined && (
          <>
            <Textarea
              aria-label="Working copy description"
              className="dshx:max-h-32 dshx:min-h-9 dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:md:text-xs"
              onChange={event => setMessageDraft({ commitId: workingCopy.commitId, text: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  commit()
                }
              }}
              placeholder="Message (describes @, ⌘Enter to commit)"
              rows={2}
              value={message}
            />
            <div className="dshx:flex dshx:items-center dshx:gap-1.5">
              <Button
                className="dshx:flex-1"
                disabled={props.busy || commitMessage.length === 0}
                onClick={commit}
                size="xs"
                title="jj commit: describe @ and start a new empty change"
                type="button"
              >
                <CheckIcon />
                Commit
                <Kbd className="dshx:ml-1 dshx:h-4 dshx:bg-primary-foreground/20 dshx:text-[10px] dshx:text-primary-foreground">⌘↵</Kbd>
              </Button>
              <Button
                disabled={props.busy || !messageChanged}
                onClick={() => props.onAction({ kind: 'describe', commitId: workingCopy.commitId, message })}
                size="xs"
                type="button"
                variant="outline"
              >
                <PencilLineIcon />
                Describe @
              </Button>
            </div>
          </>
        )}
      </div>
      <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:overscroll-contain dshx:pb-4">
        {filesQuery.error !== null && (
          <p className="dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-destructive">{errorMessage(filesQuery.error, 'Could not load changed files.')}</p>
        )}
        {groups.map(group => {
          const revision = group.revision
          const files: readonly FileStat[] | undefined = filesByCommit.get(revision.commitId)
          const open = !collapsed.has(revision.commitId)
          const selected = selection[revision.commitId] ?? []
          const editable = !revision.immutable
          const parent = group.parent
          const child = group.child
          const label = group.depth === 0 ? 'Working Copy' : `@-${group.depth}`
          const describeText = describing?.commitId === revision.commitId ? describing.text : null
          const splitMessage = splitMessages[revision.commitId] ?? ''
          return (
            <section aria-label={`${label} ${revision.shortestChangeId}`} key={revision.commitId}>
              <div className="dshx:group/header dshx:sticky dshx:top-0 dshx:z-10 dshx:flex dshx:h-7 dshx:items-center dshx:gap-1 dshx:bg-background dshx:pr-2 dshx:pl-1 dshx:hover:bg-accent">
                <button
                  aria-expanded={open}
                  className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1 dshx:text-left dshx:text-xs dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
                  onClick={() =>
                    setCollapsed(current => {
                      const next = new Set(current)
                      if (next.has(revision.commitId)) next.delete(revision.commitId)
                      else next.add(revision.commitId)
                      return next
                    })
                  }
                  title={revision.description || '(no description)'}
                  type="button"
                >
                  <ChevronRightIcon
                    className={cn('dshx:size-3 dshx:flex-none dshx:text-muted-foreground dshx:transition-transform', open && 'dshx:rotate-90')}
                  />
                  <span className="dshx:flex-none dshx:font-semibold">{label}</span>
                  <span className="dshx:flex-none dshx:font-mono dshx:text-info">{revision.shortestChangeId}</span>
                  <span className={cn('dshx:min-w-0 dshx:truncate dshx:text-muted-foreground', revision.description.trim().length === 0 && 'dshx:italic')}>
                    {firstLine(revision.description)}
                  </span>
                  {revision.immutable && (
                    <Badge className="dshx:h-4 dshx:rounded-sm dshx:px-1 dshx:py-0 dshx:text-[10px]" variant="outline">
                      immutable
                    </Badge>
                  )}
                </button>
                <span className="dshx:flex dshx:flex-none dshx:items-center dshx:opacity-0 dshx:group-hover/header:opacity-100 dshx:focus-within:opacity-100">
                  <IconAction label="Full diff" onClick={() => props.onOpenDiff(revision, null)}>
                    <FileDiffIcon />
                  </IconAction>
                  {editable && (
                    <IconAction label="Describe" onClick={() => setDescribing({ commitId: revision.commitId, text: revision.description.replace(/\n+$/, '') })}>
                      <PencilIcon />
                    </IconAction>
                  )}
                  {group.depth > 0 && (
                    <IconAction
                      disabled={props.busy}
                      label="New change on top (jj new)"
                      onClick={() => props.onAction({ kind: 'new', commitId: revision.commitId })}
                    >
                      <PlusIcon />
                    </IconAction>
                  )}
                  {group.depth > 0 && editable && (
                    <IconAction
                      disabled={props.busy}
                      label="Edit this change (jj edit)"
                      onClick={() => props.onAction({ kind: 'edit', commitId: revision.commitId })}
                    >
                      <ArrowUpIcon />
                    </IconAction>
                  )}
                  {editable && parent !== null && !parent.immutable && (
                    <IconAction
                      disabled={props.busy}
                      label="Squash into parent"
                      onClick={() => props.onAction({ kind: 'squash', sourceId: revision.commitId, destinationId: parent.commitId })}
                    >
                      <ArrowDownToLineIcon />
                    </IconAction>
                  )}
                </span>
                <span className="dshx:min-w-5 dshx:flex-none dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:text-center dshx:font-mono dshx:text-[10px]">
                  {files?.length ?? '…'}
                </span>
              </div>
              {describeText !== null && (
                <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-3 dshx:pb-1.5 dshx:pl-6">
                  <Textarea
                    aria-label={`Description for ${label}`}
                    autoFocus
                    className="dshx:min-h-9 dshx:px-2 dshx:py-1 dshx:text-xs dshx:md:text-xs"
                    onChange={event => setDescribing({ commitId: revision.commitId, text: event.target.value })}
                    rows={2}
                    value={describeText}
                  />
                  <div className="dshx:flex dshx:justify-end dshx:gap-1">
                    <Button onClick={() => setDescribing(null)} size="xs" type="button" variant="ghost">
                      Cancel
                    </Button>
                    <Button
                      disabled={props.busy || !describeDraftChanged(describeText, revision.description)}
                      onClick={() => {
                        props.onAction({ kind: 'describe', commitId: revision.commitId, message: describeText })
                        setDescribing(null)
                      }}
                      size="xs"
                      type="button"
                    >
                      Preview describe
                    </Button>
                  </div>
                </div>
              )}
              {open && (
                <div className="dshx:pr-1 dshx:pl-4">
                  {files === undefined ? (
                    filesQuery.isFetching && <p className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground">Loading files…</p>
                  ) : files.length === 0 ? (
                    <p className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground">
                      {group.depth === 0 ? 'Working copy clean.' : 'No file changes.'}
                    </p>
                  ) : (
                    <ChangedFiles
                      actions={file => (
                        <>
                          <IconAction label="Open diff" onClick={() => props.onOpenDiff(revision, file.path)}>
                            <FileDiffIcon />
                          </IconAction>
                          {file.status !== 'D' && (
                            <IconAction
                              label="Open file"
                              onClick={() =>
                                // Handled by @dshfiles/editor when installed; see its open-file.ts contract.
                                window.dispatchEvent(
                                  new CustomEvent('dshfiles:open-file', { detail: { path: file.path, cwd: props.repositoryRoot }, cancelable: true }),
                                )
                              }
                            >
                              <FilePenLineIcon />
                            </IconAction>
                          )}
                          {editable && (
                            <IconAction
                              disabled={props.busy}
                              label="Discard changes (jj restore)"
                              onClick={() => props.onAction({ kind: 'restore', commitId: revision.commitId, paths: [file.path] })}
                            >
                              <Undo2Icon />
                            </IconAction>
                          )}
                          {editable && parent !== null && !parent.immutable && (
                            <IconAction
                              disabled={props.busy}
                              label="Move to parent"
                              onClick={() =>
                                props.onAction({ kind: 'squash', sourceId: revision.commitId, destinationId: parent.commitId, paths: [file.path] })
                              }
                            >
                              <ArrowDownIcon />
                            </IconAction>
                          )}
                          {editable && child !== null && (
                            <IconAction
                              disabled={props.busy}
                              label="Move to child"
                              onClick={() => props.onAction({ kind: 'squash', sourceId: revision.commitId, destinationId: child.commitId, paths: [file.path] })}
                            >
                              <ArrowUpIcon />
                            </IconAction>
                          )}
                        </>
                      )}
                      files={files}
                      onOpen={path => props.onOpenDiff(revision, path)}
                      showCounts={false}
                      statusAtEnd
                      view={props.fileView}
                      {...(editable
                        ? {
                            selectedPaths: selected,
                            onSelectionChange: (paths: readonly string[]) => setSelection(current => ({ ...current, [revision.commitId]: paths })),
                          }
                        : {})}
                    />
                  )}
                  {editable && selected.length > 0 && (
                    <form
                      className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:py-1 dshx:pl-1"
                      onSubmit={event => {
                        event.preventDefault()
                        if (splitMessage.trim().length === 0) return
                        props.onAction({ kind: 'split', commitId: revision.commitId, paths: [...selected], message: splitMessage })
                      }}
                    >
                      <Input
                        aria-label="Description for the split-off files"
                        className="dshx:h-6 dshx:flex-1 dshx:text-xs dshx:md:text-xs"
                        onChange={event => setSplitMessages(current => ({ ...current, [revision.commitId]: event.target.value }))}
                        placeholder="Description for selected files"
                        value={splitMessage}
                      />
                      <Button disabled={props.busy || splitMessage.trim().length === 0} size="xs" type="submit" variant="outline">
                        <ScissorsIcon />
                        Split {selected.length}
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </section>
          )
        })}
        {filesQuery.data?.truncated === true && <p className="dshx:px-3 dshx:py-1 dshx:text-xs dshx:text-warning">File lists reached the output limit.</p>}
      </div>
    </div>
  )
}
