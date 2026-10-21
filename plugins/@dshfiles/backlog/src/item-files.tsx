import { useApi } from '@dshfiles/dshx/client'
import { ImageLightbox } from '@dshfiles/plugin-ui/components/image-lightbox'
import { DownloadIcon, FileIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useQueries, useQuery } from '@dshfiles/plugin-ui/query'
import { useCallback, useState } from 'react'

import { backlogApi } from './api.js'
import { fileSizeLabel } from './composer-attachments.js'
import type { BacklogAttachment } from './item.js'
import { useBacklogActions } from './use-backlog-actions.js'

const AttachmentImage = (props: {
  readonly itemId: number
  readonly attachment: BacklogAttachment
  readonly onOpen: (attachment: BacklogAttachment) => void
  readonly onRemove?: ((attachment: BacklogAttachment) => void) | undefined
}): JSX.Element => {
  const api = useApi(backlogApi)
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
      {props.onRemove === undefined ? null : (
        <button
          type="button"
          aria-label={`Remove ${props.attachment.name}`}
          onClick={() => props.onRemove?.(props.attachment)}
          className="dshx:absolute dshx:top-1 dshx:right-1 dshx:inline-flex dshx:size-6 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-background/90 dshx:text-foreground dshx:opacity-0 dshx:shadow-sm dshx:transition-opacity dshx:group-hover/image:opacity-100"
        >
          <XIcon className="dshx:size-3.5" />
        </button>
      )}
    </figure>
  )
}

const AttachmentFile = (props: {
  readonly itemId: number
  readonly attachment: BacklogAttachment
  readonly onRemove?: ((attachment: BacklogAttachment) => void) | undefined
}): JSX.Element => {
  const api = useApi(backlogApi)
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
        <span className="dshx:text-[11px] dshx:text-muted-foreground">{fileSizeLabel(props.attachment.bytes)}</span>
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
      {props.onRemove === undefined ? null : (
        <button
          type="button"
          aria-label={`Remove ${props.attachment.name}`}
          onClick={() => props.onRemove?.(props.attachment)}
          className="dshx:inline-flex dshx:size-6 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
        >
          <XIcon className="dshx:size-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Files kept with an item or carried by one comment: image thumbnails inline, other files as download rows, every
 * image in one gallery. Removing is the item's job, so a comment's files are shown read-only.
 */
export const AttachmentMedia = (props: {
  readonly itemId: number
  readonly attachments: readonly BacklogAttachment[]
  readonly onRemove?: ((attachment: BacklogAttachment) => void) | undefined
}): JSX.Element | null => {
  const api = useApi(backlogApi)
  const [openId, setOpenId] = useState<string | null>(null)
  const closePreview = useCallback(() => setOpenId(null), [])
  const images = props.attachments.filter(attachment => attachment.kind === 'image')
  const files = props.attachments.filter(attachment => attachment.kind !== 'image')
  const reads = useQueries({
    queries: images.map(attachment => ({
      queryKey: ['dshfiles-backlog-file', props.itemId, attachment.id],
      queryFn: ({ signal }) => api.readFile({ id: props.itemId, attachmentId: attachment.id }, { signal }),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  if (props.attachments.length === 0) return null
  const lightboxImages = images.map((attachment, index) => {
    const read = reads[index]?.data
    return read?.ok === true ? { src: read.value.dataUrl, alt: attachment.name } : { alt: attachment.name }
  })
  const openIndex = images.findIndex(attachment => attachment.id === openId)
  return (
    <>
      <div aria-label="Attachments" className="dshx:flex dshx:flex-col dshx:gap-2">
        {images.length === 0 ? null : (
          <div className="dshx:grid dshx:grid-cols-3 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-2">
            {images.map(attachment => (
              <AttachmentImage
                key={attachment.id}
                itemId={props.itemId}
                attachment={attachment}
                onOpen={opened => setOpenId(opened.id)}
                onRemove={props.onRemove}
              />
            ))}
          </div>
        )}
        {files.map(attachment => (
          <AttachmentFile key={attachment.id} itemId={props.itemId} attachment={attachment} onRemove={props.onRemove} />
        ))}
      </div>
      {openIndex === -1 ? null : <ImageLightbox images={lightboxImages} initialIndex={openIndex} onClose={closePreview} />}
    </>
  )
}

/** Files kept with one item, with the remove action the item's detail has. */
export const ItemFiles = (props: { readonly itemId: number; readonly attachments: readonly BacklogAttachment[] }): JSX.Element | null => {
  const actions = useBacklogActions()
  return (
    <AttachmentMedia
      itemId={props.itemId}
      attachments={props.attachments}
      onRemove={attachment => actions.removeFile.mutate({ id: props.itemId, attachmentId: attachment.id })}
    />
  )
}
