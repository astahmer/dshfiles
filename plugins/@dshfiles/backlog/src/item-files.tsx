import { useApi } from '@dshfiles/dshx/client'
import { Dialog, DialogContent, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { DownloadIcon, FileIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'

import { backlogApi } from './api.js'
import type { BacklogAttachment } from './item.js'
import { useBacklogActions } from './use-backlog-actions.js'

const sizeLabel = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`

const AttachmentImage = (props: {
  readonly itemId: number
  readonly attachment: BacklogAttachment
  readonly onOpen: (attachment: BacklogAttachment) => void
}): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useBacklogActions()
  const image = useQuery({
    queryKey: ['dshfiles-backlog-file', props.itemId, props.attachment.id],
    queryFn: ({ signal }) => api.readFile({ id: props.itemId, attachmentId: props.attachment.id }, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  })
  return (
    <figure className="dshx:group/image dshx:relative dshx:aspect-square dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted">
      <button type="button" aria-label={`Open ${props.attachment.name}`} onClick={() => props.onOpen(props.attachment)} className="dshx:block dshx:size-full">
        {image.data?.ok === true ? (
          <img src={image.data.value.dataUrl} alt={props.attachment.name} loading="lazy" className="dshx:size-full dshx:object-cover" />
        ) : (
          <span className="dshx:flex dshx:size-full dshx:items-center dshx:justify-center dshx:p-2 dshx:text-center dshx:text-[11px] dshx:text-muted-foreground">
            {image.isError || image.data?.ok === false ? 'Missing image' : props.attachment.name}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Remove ${props.attachment.name}`}
        onClick={() => actions.removeFile.mutate({ id: props.itemId, attachmentId: props.attachment.id })}
        className="dshx:absolute dshx:top-1 dshx:right-1 dshx:inline-flex dshx:size-6 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-background/90 dshx:text-foreground dshx:opacity-0 dshx:shadow-sm dshx:transition-opacity dshx:group-hover/image:opacity-100"
      >
        <XIcon className="dshx:size-3.5" />
      </button>
    </figure>
  )
}

const AttachmentFile = (props: { readonly itemId: number; readonly attachment: BacklogAttachment }): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useBacklogActions()
  const file = useQuery({
    queryKey: ['dshfiles-backlog-file', props.itemId, props.attachment.id],
    queryFn: ({ signal }) => api.readFile({ id: props.itemId, attachmentId: props.attachment.id }, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const dataUrl = file.data?.ok === true ? file.data.value.dataUrl : null
  return (
    <div className="dshx:group/file dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/30 dshx:px-2.5 dshx:py-2">
      <FileIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
        <span className="dshx:truncate dshx:text-[13px] dshx:text-foreground">{props.attachment.name}</span>
        <span className="dshx:text-[11px] dshx:text-muted-foreground">{sizeLabel(props.attachment.bytes)}</span>
      </span>
      {dataUrl === null ? null : (
        <a
          href={dataUrl}
          download={props.attachment.name}
          aria-label={`Download ${props.attachment.name}`}
          className="dshx:inline-flex dshx:size-6 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
        >
          <DownloadIcon className="dshx:size-3.5" />
        </a>
      )}
      <button
        type="button"
        aria-label={`Remove ${props.attachment.name}`}
        onClick={() => actions.removeFile.mutate({ id: props.itemId, attachmentId: props.attachment.id })}
        className="dshx:inline-flex dshx:size-6 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
      >
        <XIcon className="dshx:size-3.5" />
      </button>
    </div>
  )
}

/** Files kept with one item: image thumbnails inline, other files as download rows, the full picture in a dialog. */
export const ItemFiles = (props: { readonly itemId: number; readonly attachments: readonly BacklogAttachment[] }): JSX.Element | null => {
  const api = useApi(backlogApi)
  const [open, setOpen] = useState<BacklogAttachment | null>(null)
  const full = useQuery({
    queryKey: ['dshfiles-backlog-file', props.itemId, open?.id ?? 'none'],
    queryFn: ({ signal }) => api.readFile({ id: props.itemId, attachmentId: open?.id ?? '' }, { signal }),
    enabled: open !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
  if (props.attachments.length === 0) return null
  const images = props.attachments.filter(attachment => attachment.kind === 'image')
  const files = props.attachments.filter(attachment => attachment.kind !== 'image')
  return (
    <>
      <div aria-label="Attachments" className="dshx:flex dshx:flex-col dshx:gap-2">
        {images.length === 0 ? null : (
          <div className="dshx:grid dshx:grid-cols-3 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-2">
            {images.map(attachment => (
              <AttachmentImage key={attachment.id} itemId={props.itemId} attachment={attachment} onOpen={setOpen} />
            ))}
          </div>
        )}
        {files.map(attachment => (
          <AttachmentFile key={attachment.id} itemId={props.itemId} attachment={attachment} />
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={next => (next ? undefined : setOpen(null))}>
        <DialogContent className="dshx-root dshx:max-w-3xl dshx:p-2" showCloseButton>
          <DialogTitle className="dshx:sr-only">{open?.name ?? 'Image'}</DialogTitle>
          {full.data?.ok === true ? (
            <img src={full.data.value.dataUrl} alt={open?.name ?? 'Image'} className="dshx:max-h-[80vh] dshx:w-full dshx:object-contain" />
          ) : (
            <p className="dshx:p-6 dshx:text-sm dshx:text-muted-foreground">The image could not be loaded.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
