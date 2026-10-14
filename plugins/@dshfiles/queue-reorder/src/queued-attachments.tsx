import { FileIcon, ImageIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo } from 'react'
import type { AttachmentPreview } from './message-preview.js'
import type { QueuedImageAttachment } from './queue-edit.js'

/** Reads a queued image's bytes from the session that holds it. */
export type ReadQueuedImage = (attachment: QueuedImageAttachment) => Promise<Blob>

const ImageThumbnail = (props: {
  readonly sessionId: string
  readonly preview: Extract<AttachmentPreview, { kind: 'image' }>
  readonly readImage: ReadQueuedImage
}) => {
  const image = useQuery({
    queryKey: ['queue-reorder', 'thumbnail', props.sessionId, props.preview.attachment.attachmentId],
    queryFn: () => props.readImage(props.preview.attachment),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const url = useMemo(() => (image.data === undefined ? null : URL.createObjectURL(image.data)), [image.data])
  useEffect(() => (url === null ? undefined : () => URL.revokeObjectURL(url)), [url])
  return (
    <span
      className="dshx:grid dshx:size-6 dshx:flex-none dshx:place-items-center dshx:overflow-hidden dshx:rounded-sm dshx:border dshx:bg-muted dshx:text-muted-foreground"
      title={props.preview.name}
      data-queue-attachment="image"
    >
      {url === null ? (
        <ImageIcon className="dshx:size-3.5" aria-hidden />
      ) : (
        <img className="dshx:size-full dshx:object-cover" src={url} alt={props.preview.name} />
      )}
    </span>
  )
}

/** Thumbnails for a queued message's images and chips for its other files. */
export const QueuedAttachments = (props: {
  readonly sessionId: string
  readonly previews: readonly AttachmentPreview[]
  readonly readImage: ReadQueuedImage | undefined
}): JSX.Element | null => {
  if (props.previews.length === 0) return null
  return (
    <span
      role="group"
      className="dshx:flex dshx:min-w-0 dshx:flex-none dshx:items-center dshx:gap-1"
      aria-label={`${props.previews.length} attachment${props.previews.length === 1 ? '' : 's'}`}
    >
      {props.previews.map(preview =>
        preview.kind === 'image' && props.readImage !== undefined ? (
          <ImageThumbnail key={preview.key} sessionId={props.sessionId} preview={preview} readImage={props.readImage} />
        ) : (
          <span
            key={preview.key}
            className="dshx:flex dshx:h-6 dshx:max-w-32 dshx:items-center dshx:gap-1 dshx:rounded-sm dshx:border dshx:bg-muted dshx:px-1.5 dshx:text-xs dshx:text-muted-foreground"
            title={preview.kind === 'file' ? `${preview.name} (${preview.bytes} bytes)` : preview.name}
            data-queue-attachment="file"
          >
            {preview.kind === 'file' ? (
              <FileIcon className="dshx:size-3 dshx:flex-none" aria-hidden />
            ) : (
              <ImageIcon className="dshx:size-3 dshx:flex-none" aria-hidden />
            )}
            <span className="dshx:truncate">{preview.name}</span>
          </span>
        ),
      )}
    </span>
  )
}
