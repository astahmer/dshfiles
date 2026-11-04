import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { DownloadIcon, FileUpIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { threadTransferApi } from './api.js'
import type { ThreadTransferKey } from './locales.js'
import { BundleTransfer, type TransferApi } from './transfer-client.js'

export type TransferRequest = { readonly kind: 'export'; readonly sessionId: string } | { readonly kind: 'import'; readonly workspaceId: string | undefined }

type T = Translate<ThreadTransferKey>

const HOME = 'home'
const OTHER = 'other'

const size = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${String(Math.max(1, Math.round(bytes / 1024)))} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`

interface Summary {
  readonly title: string | null
  readonly messageCount: number
  readonly eventCount: number
  readonly attachmentCount: number
  readonly attachmentBytes: number
  readonly missingAttachments: number
  readonly model: { readonly provider: string; readonly model: string } | null
  readonly folderName: string | null
}

const Stats = (props: { readonly summary: Summary; readonly t: T }): JSX.Element => (
  <p className="dshx:text-sm dshx:text-muted-foreground" data-thread-transfer="stats">
    {props.t('exportStats', {
      messages: props.summary.messageCount,
      events: props.summary.eventCount,
      attachments:
        props.summary.attachmentCount === 0
          ? props.t('attachmentsNone')
          : props.t('attachmentsSome', { count: props.summary.attachmentCount, size: size(props.summary.attachmentBytes) }),
    })}
  </p>
)

const Failure = (props: { readonly error: unknown; readonly t: T }): JSX.Element => (
  <Alert variant="destructive" data-thread-transfer="error">
    <AlertDescription>{props.t('failed', { message: errorMessage(props.error, 'Transfer failed') })}</AlertDescription>
  </Alert>
)

/** Exports as soon as it opens: the user already chose Export. */
const ExportBody = (props: { readonly api: TransferApi; readonly sessionId: string; readonly t: T; readonly close: () => void }): JSX.Element => {
  const [share, setShare] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const run = useMutation({
    mutationFn: async () => {
      controller.current?.abort()
      const next = new AbortController()
      controller.current = next
      setShare(0)
      const bundle = await BundleTransfer.download(props.api, props.sessionId, setShare, next.signal)
      BundleTransfer.save(bundle)
      return bundle
    },
  })
  // `mutate` is stable, so this runs once per opened dialog; leaving it (closing the dialog) stops the download.
  const start = run.mutate
  useEffect(() => {
    start()
    return () => controller.current?.abort()
  }, [start])
  return (
    <>
      <DialogHeader>
        <DialogTitle>{props.t('exportTitle')}</DialogTitle>
        <DialogDescription>{props.t('exportDescription')}</DialogDescription>
      </DialogHeader>
      {run.isPending ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2" data-thread-transfer="exporting">
          <span className="dshx:text-sm">{props.t('exportPreparing')}</span>
          <Progress value={Math.round(share * 100)} />
        </div>
      ) : null}
      {run.isSuccess ? (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1" data-thread-transfer="exported">
          <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{props.t('exportReady', { file: run.data.fileName })}</span>
          <Stats summary={run.data.summary} t={props.t} />
          {run.data.summary.missingAttachments > 0 ? (
            <span className="dshx:text-xs dshx:text-muted-foreground">{props.t('exportMissing', { count: run.data.summary.missingAttachments })}</span>
          ) : null}
        </div>
      ) : null}
      {run.isError ? <Failure error={run.error} t={props.t} /> : null}
      <DialogFooter>
        {run.isPending ? null : (
          <Button variant="outline" onClick={() => run.mutate()}>
            <DownloadIcon /> {props.t('exportAgain')}
          </Button>
        )}
        <Button onClick={props.close}>{props.t('close')}</Button>
      </DialogFooter>
    </>
  )
}

const ImportBody = (props: {
  readonly api: TransferApi
  readonly workspaceId: string | undefined
  readonly t: T
  readonly close: () => void
  readonly openSession: (sessionId: string) => Promise<void>
}): JSX.Element => {
  const fileInput = useRef<HTMLInputElement>(null)
  const folderId = useId()
  const [share, setShare] = useState(0)
  const [folder, setFolder] = useState('')
  const destinations = useQuery({
    queryKey: ['thread-transfer', 'destinations'],
    queryFn: ({ signal }) => props.api.destinations({}, { signal }),
  })
  const projects = destinations.data?.projects ?? []
  const preferred = props.workspaceId !== undefined && projects.some(project => project.workspaceId === props.workspaceId) ? props.workspaceId : undefined
  const [choice, setChoice] = useState<string | undefined>(undefined)
  const destination = choice ?? preferred ?? HOME

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setShare(0)
      const transferId = await BundleTransfer.upload(props.api, file, setShare, AbortSignal.timeout(10 * 60_000))
      const preview = await props.api.inspect({ source: { transferId } })
      return { transferId, fileName: file.name, ...preview }
    },
  })
  const commit = useMutation({
    mutationFn: async (transferId: string) => {
      const source = { transferId }
      const request = destination === HOME ? { source } : destination === OTHER ? { source, cwd: folder.trim() } : { source, workspaceId: destination }
      const imported = await props.api.import(request)
      await props.openSession(imported.sessionId)
      return imported
    },
    onSuccess: () => props.close(),
  })
  const preview = upload.data
  const blocked = preview === undefined || preview.problem !== null || (destination === OTHER && folder.trim() === '') || commit.isPending

  return (
    <>
      <DialogHeader>
        <DialogTitle>{props.t('importTitle')}</DialogTitle>
        <DialogDescription>{props.t('importDescription')}</DialogDescription>
      </DialogHeader>
      <input
        ref={fileInput}
        accept=".dshthread,application/gzip,application/json"
        className="dshx:hidden"
        data-thread-transfer="file-input"
        onChange={event => {
          const file = event.target.files?.[0]
          if (file !== undefined) upload.mutate(file)
          event.target.value = ''
        }}
        type="file"
      />
      <Button className="dshx:self-start" disabled={upload.isPending || commit.isPending} onClick={() => fileInput.current?.click()} variant="outline">
        <FileUpIcon /> {props.t('importPick')}
      </Button>
      {upload.isPending ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2" data-thread-transfer="uploading">
          <span className="dshx:text-sm">{props.t('importUploading')}</span>
          <Progress value={Math.round(share * 100)} />
        </div>
      ) : null}
      {upload.isError ? <Failure error={upload.error} t={props.t} /> : null}
      {preview === undefined ? null : (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:p-3" data-thread-transfer="preview">
          <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{preview.summary.title ?? props.t('untitled')}</span>
          <Stats summary={preview.summary} t={props.t} />
          {preview.summary.model === null ? null : (
            <span className="dshx:text-xs dshx:text-muted-foreground">
              {props.t('importModel', { model: `${preview.summary.model.provider}/${preview.summary.model.model}` })}
            </span>
          )}
          {preview.summary.folderName === null ? null : (
            <span className="dshx:text-xs dshx:text-muted-foreground">{props.t('importFolderHint', { folder: preview.summary.folderName })}</span>
          )}
          {preview.summary.missingAttachments > 0 ? (
            <span className="dshx:text-xs dshx:text-muted-foreground">{props.t('exportMissing', { count: preview.summary.missingAttachments })}</span>
          ) : null}
          {preview.problem === null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{preview.problem}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
      {preview === undefined || preview.problem !== null ? null : (
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <Label>{props.t('importDestination')}</Label>
          <Select value={destination} onValueChange={setChoice}>
            <SelectTrigger aria-label={props.t('importDestination')} className="dshx:w-full" data-thread-transfer="destination">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map(project => (
                <SelectItem key={project.workspaceId} value={project.workspaceId}>
                  {project.title}
                </SelectItem>
              ))}
              <SelectItem value={HOME}>{props.t('importHome')}</SelectItem>
              <SelectItem value={OTHER}>{props.t('importOtherFolder')}</SelectItem>
            </SelectContent>
          </Select>
          {destination === OTHER ? (
            <>
              <Label htmlFor={folderId}>{props.t('importFolderPath')}</Label>
              <Input className="dshx:font-mono!" id={folderId} onChange={event => setFolder(event.target.value)} placeholder="/path/to/folder" value={folder} />
            </>
          ) : null}
        </div>
      )}
      {commit.isError ? <Failure error={commit.error} t={props.t} /> : null}
      <DialogFooter>
        <Button onClick={props.close} variant="outline">
          {props.t('cancel')}
        </Button>
        <Button data-thread-transfer="import" disabled={blocked} onClick={() => preview !== undefined && commit.mutate(preview.transferId)}>
          {commit.isPending ? props.t('importing') : props.t('importSubmit')}
        </Button>
      </DialogFooter>
    </>
  )
}

/** The export and import flows, one dialog at a time; closing it stops a transfer in progress. */
export const TransferDialog = (props: {
  readonly request: TransferRequest | null
  readonly close: () => void
  readonly openSession: (sessionId: string) => Promise<void>
  readonly t: T
}): JSX.Element => {
  const api = useApi(threadTransferApi)
  const request = props.request
  return (
    <Dialog open={request !== null} onOpenChange={open => (open ? undefined : props.close())}>
      <DialogContent className="dshx-root dshx:@container dshx:flex dshx:max-w-lg dshx:flex-col dshx:gap-4" data-thread-transfer="dialog">
        {request?.kind === 'export' ? <ExportBody key={request.sessionId} api={api} close={props.close} sessionId={request.sessionId} t={props.t} /> : null}
        {request?.kind === 'import' ? (
          <ImportBody api={api} close={props.close} openSession={props.openSession} t={props.t} workspaceId={request.workspaceId} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
