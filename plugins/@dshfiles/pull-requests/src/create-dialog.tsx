import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ExternalLinkIcon, GitPullRequestIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useId, useState, type ReactNode } from 'react'
import type { PullRequestCreateInput, PullRequestCreateOutput, PullRequestCreatePreview } from './create-model.js'
import type { PullRequestsKey } from './locales.js'

export type Translate = (key: PullRequestsKey, params?: Record<string, string | number>) => string

export interface CreateDialogApi {
  readonly preview: (input: { readonly sessionId: string }, signal: AbortSignal) => Promise<PullRequestCreatePreview>
  readonly create: (input: PullRequestCreateInput) => Promise<PullRequestCreateOutput>
}

export const createPreviewKey = (sessionId: string) => ['pull-requests', 'create-preview', sessionId] as const

const Summary = (props: { readonly preview: PullRequestCreatePreview; readonly t: Translate }): ReactNode => {
  const preview = props.preview
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2" data-testid="dshfiles-pull-request-create-summary">
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-xs">
        {preview.repo === null ? null : <Badge variant="secondary">{preview.repo}</Badge>}
        {preview.bookmark === null ? null : (
          <Badge variant="outline" className="dshx:max-w-full dshx:min-w-0 dshx:truncate dshx:font-mono!">
            {preview.bookmark}
          </Badge>
        )}
        {preview.base === null ? null : <span className="dshx:text-muted-foreground">→ {preview.base}</span>}
      </div>
      {preview.commits.length === 0 ? null : (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
          <span className="dshx:text-xs dshx:text-muted-foreground">{props.t('commits', { count: preview.commits.length })}</span>
          <ul className="dshx:max-h-28 dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:border-border dshx:p-2 dshx:text-xs">
            {preview.commits.map(commit => (
              <li key={commit.changeId} className="dshx:flex dshx:min-w-0 dshx:gap-2">
                <code className="dshx:shrink-0 dshx:text-muted-foreground">{commit.changeId.slice(0, 8)}</code>
                <span className="dshx:min-w-0 dshx:truncate">{commit.summary.length > 0 ? commit.summary : props.t('noDescription')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const Problems = (props: { readonly preview: PullRequestCreatePreview; readonly t: Translate }): ReactNode =>
  props.preview.problems.length === 0 ? null : (
    <Alert variant="destructive" data-testid="dshfiles-pull-request-create-problems">
      <AlertTitle>{props.t('blocked')}</AlertTitle>
      <AlertDescription>
        <ul className="dshx:flex dshx:list-disc dshx:flex-col dshx:gap-1 dshx:pl-4">
          {props.preview.problems.map(problem => (
            <li key={problem.code} data-problem={problem.code}>
              <span>{problem.message}</span> <span className="dshx:text-foreground">{problem.recovery}</span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )

const Result = (props: { readonly output: Extract<PullRequestCreateOutput, { status: 'created' }>; readonly t: Translate }): ReactNode => (
  <Alert data-testid="dshfiles-pull-request-create-result">
    <GitPullRequestIcon />
    <AlertTitle className="dshx:break-all">{props.t(props.output.opened ? 'created' : 'linked', { url: props.output.url })}</AlertTitle>
    <AlertDescription>
      <span>{props.t('watching')}</span>
      <a className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:text-primary dshx:underline" href={props.output.url} target="_blank" rel="noreferrer">
        {props.t('openOnGitHub')} <ExternalLinkIcon className="dshx:size-3" />
      </a>
    </AlertDescription>
  </Alert>
)

/** The confirm form for one previewed head commit; keyed by that commit so a refreshed preview resets the draft. */
const CreateForm = (props: {
  readonly preview: PullRequestCreatePreview
  readonly api: CreateDialogApi
  readonly t: Translate
  readonly onRefresh: () => void
  readonly onClose: () => void
  readonly refreshing: boolean
}): ReactNode => {
  const preview = props.preview
  const [title, setTitle] = useState(preview.title)
  const [body, setBody] = useState(preview.body)
  const [draft, setDraft] = useState(false)
  const ids = { title: useId(), body: useId(), draft: useId() }
  const creating = useMutation({
    mutationFn: () => {
      if (preview.bookmark === null || preview.base === null || preview.headCommitId === null) throw new Error(props.t('blocked'))
      return props.api.create({
        sessionId: preview.sessionId,
        cwd: preview.cwd,
        confirm: true,
        title: title.trim(),
        body,
        bookmark: preview.bookmark,
        base: preview.base,
        headCommitId: preview.headCommitId,
        draft,
      })
    },
  })
  const output = creating.data
  if (output?.status === 'created')
    return (
      <>
        <Result output={output} t={props.t} />
        <DialogFooter>
          <Button size="sm" onClick={props.onClose}>
            {props.t('close')}
          </Button>
        </DialogFooter>
      </>
    )

  const ready = preview.status === 'ready' && title.trim().length > 0
  const busy = creating.isPending || props.refreshing
  return (
    <form
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3"
      onSubmit={event => {
        event.preventDefault()
        if (ready && !busy) creating.mutate()
      }}
    >
      <Summary preview={preview} t={props.t} />
      <Problems preview={preview} t={props.t} />
      {preview.existingUrl === null ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('existing')}</p>}
      <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
        <Label htmlFor={ids.title}>{props.t('fieldTitle')}</Label>
        <Input id={ids.title} value={title} maxLength={256} disabled={busy} onChange={event => setTitle(event.currentTarget.value)} />
      </div>
      <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
        <Label htmlFor={ids.body}>{props.t('fieldBody')}</Label>
        <Textarea
          id={ids.body}
          className="dshx:max-h-64 dshx:min-h-32 dshx:font-mono! dshx:text-xs"
          value={body}
          disabled={busy}
          onChange={event => setBody(event.currentTarget.value)}
        />
        <span className="dshx:text-xs dshx:text-muted-foreground" data-testid="dshfiles-pull-request-create-generation">
          {preview.generation.source === 'model'
            ? props.t('generated', { route: preview.generation.note })
            : props.t('draftNote', { note: preview.generation.note })}
        </span>
      </div>
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <Checkbox id={ids.draft} checked={draft} disabled={busy} onCheckedChange={checked => setDraft(checked === true)} />
        <Label htmlFor={ids.draft} className="dshx:font-normal">
          {props.t('fieldDraft')}
        </Label>
      </div>
      {output?.status === 'failed' ? (
        <Alert variant="destructive" data-testid="dshfiles-pull-request-create-failure">
          <AlertTitle>{props.t('failed', { stage: output.stage, message: output.message })}</AlertTitle>
          <AlertDescription>
            {output.recovery}
            {output.pushed ? ` ${props.t('pushed')}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}
      {creating.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(creating.error, props.t('previewFailed', { reason: 'unknown' }))}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter className="dshx:flex-wrap dshx:gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={props.onClose}>
          {props.t('cancel')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={props.onRefresh}>
          <RefreshCwIcon /> {props.t('refresh')}
        </Button>
        <Button type="submit" size="sm" disabled={!ready || busy} data-testid="dshfiles-pull-request-create-confirm">
          {creating.isPending ? <Spinner /> : <GitPullRequestIcon />}
          {creating.isPending ? props.t('creating') : props.t(preview.existingUrl === null ? 'create' : 'linkExisting')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Preview a pull request for one thread, let the user edit the drafted title and body, then push and create on confirm. */
export const CreatePullRequestDialog = (props: {
  readonly sessionId: string
  readonly threadTitle: string
  readonly api: CreateDialogApi
  readonly t: Translate
  readonly onClose: () => void
}): ReactNode => {
  const preview = useQuery({
    queryKey: createPreviewKey(props.sessionId),
    queryFn: ({ signal }) => props.api.preview({ sessionId: props.sessionId }, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  return (
    <Dialog open onOpenChange={open => (open ? undefined : props.onClose())}>
      <DialogContent className="dshx-root dshx:grid-cols-[minmax(0,1fr)] dshx:sm:max-w-xl" data-testid="dshfiles-pull-request-create-dialog">
        <DialogHeader>
          <DialogTitle className="dshx:text-base">{props.t('title')}</DialogTitle>
          <DialogDescription className="dshx:break-words">{props.t('description', { thread: props.threadTitle })}</DialogDescription>
        </DialogHeader>
        {preview.data === undefined ? (
          preview.isError ? (
            <div className="dshx:flex dshx:flex-col dshx:gap-3">
              <Alert variant="destructive">
                <AlertDescription>{props.t('previewFailed', { reason: errorMessage(preview.error, 'unknown') })}</AlertDescription>
              </Alert>
              <DialogFooter>
                <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
                  {props.t('cancel')}
                </Button>
                <Button type="button" size="sm" onClick={() => void preview.refetch()}>
                  {props.t('retry')}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground" data-testid="dshfiles-pull-request-create-loading">
              <Spinner /> {props.t('loading')}
            </div>
          )
        ) : (
          <CreateForm
            key={`${preview.data.headCommitId ?? 'none'}:${String(preview.dataUpdatedAt)}`}
            preview={preview.data}
            api={props.api}
            t={props.t}
            refreshing={preview.isFetching}
            onRefresh={() => void preview.refetch()}
            onClose={props.onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
