import { ThreadMentionDrag } from '@dshfiles/thread-sidebar/thread-mention'
import { ImageLightbox } from '@dshfiles/plugin-ui/components/image-lightbox'
import { FileIcon, PaperclipIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useCallback, useId, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'

import { readComposerFile, type ComposerFile } from './composer-files.js'
import { BacklogItems } from './item.js'
import { threadMentionText } from './thread-mention-drop.js'

export { threadMentionText } from './thread-mention-drop.js'

export const fileSizeLabel = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`

// Attachment bytes can exceed localStorage quotas; this cache keeps them across in-app composer unmounts only.
const storedDraftFiles = new Map<string, readonly ComposerFile[]>()

export const composerDraftFiles = {
  get: (draftKey: string): readonly ComposerFile[] => storedDraftFiles.get(draftKey) ?? [],
  set: (draftKey: string, files: readonly ComposerFile[]): void => {
    if (files.length === 0) storedDraftFiles.delete(draftKey)
    else storedDraftFiles.set(draftKey, files)
  },
}

/** Reading, capping and removing the files a text box holds before it saves them with the item. */
export const useComposerFiles = (props: {
  readonly draftKey?: string
  readonly onError: (message: string | null) => void
  readonly initial?: readonly ComposerFile[]
}) => {
  const { onError } = props
  const localDraftKey = useId()
  const draftKey = props.draftKey ?? localDraftKey
  const [files, setFiles] = useState<readonly ComposerFile[]>(() => {
    if (props.initial === undefined) return composerDraftFiles.get(draftKey)
    composerDraftFiles.set(draftKey, props.initial)
    return props.initial
  })
  const replaceFiles = useCallback(
    (next: readonly ComposerFile[]): void => {
      composerDraftFiles.set(draftKey, next)
      setFiles(next)
    },
    [draftKey],
  )
  const remaining = Math.max(0, BacklogItems.maxAttachments - files.length)
  const add = useCallback(
    async (dropped: readonly File[]): Promise<{ readonly added: readonly ComposerFile[]; readonly firstImageNumber: number }> => {
      if (dropped.length === 0) return { added: [], firstImageNumber: composerDraftFiles.get(draftKey).filter(file => file.kind === 'image').length }
      onError(null)
      try {
        const next: ComposerFile[] = []
        for (const file of dropped.slice(0, remaining)) next.push(await readComposerFile(file))
        const existing = composerDraftFiles.get(draftKey)
        const allFiles = [...existing, ...next].slice(0, BacklogItems.maxAttachments)
        const added = allFiles.slice(existing.length)
        const firstImageNumber = existing.filter(file => file.kind === 'image').length
        replaceFiles(allFiles)
        return { added, firstImageNumber }
      } catch (error) {
        onError(errorMessage(error, 'That file could not be read.'))
        return { added: [], firstImageNumber: composerDraftFiles.get(draftKey).filter(file => file.kind === 'image').length }
      }
    },
    [draftKey, onError, remaining, replaceFiles],
  )
  const remove = useCallback((id: string) => replaceFiles(composerDraftFiles.get(draftKey).filter(file => file.id !== id)), [draftKey, replaceFiles])
  const clear = useCallback(() => replaceFiles([]), [replaceFiles])
  const restore = useCallback(
    (next: readonly ComposerFile[]) => {
      if (composerDraftFiles.get(draftKey).length === 0) replaceFiles(next)
    },
    [draftKey, replaceFiles],
  )
  return { files, add, remove, clear, restore }
}

/** A box accepts files dropped anywhere on it, with the same highlight in every composer. */
export const useFileDrop = ({
  onFiles,
  onThreadMention,
}: {
  readonly onFiles: (files: readonly File[]) => void
  readonly onThreadMention?: (sessionId: string) => void
}) => {
  const [dragging, setDragging] = useState(false)
  return {
    dragging,
    dragProps: {
      onDragOver: (event: DragEvent) => {
        const threadMention = ThreadMentionDrag.has(event.dataTransfer)
        if (!threadMention && !event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(true)
      },
      onDragLeave: (event: DragEvent) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        setDragging(false)
      },
      onDrop: (event: DragEvent) => {
        const sessionId = ThreadMentionDrag.read(event.dataTransfer)
        if (sessionId !== null) {
          event.preventDefault()
          setDragging(false)
          onThreadMention?.(sessionId)
          return
        }
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(false)
        onFiles([...event.dataTransfer.files])
      },
    },
  }
}

/** A pasted image or file joins the draft instead of landing in the text. */
export const pasteFiles = (event: ClipboardEvent<HTMLTextAreaElement>, onFiles: (files: readonly File[]) => void): void => {
  const pasted = [...event.clipboardData.files]
  if (pasted.length === 0) return
  event.preventDefault()
  onFiles(pasted)
}

/** Pending attachments above a text box: image thumbnails that open the shared gallery, other files as rows. */
export const AttachmentTray = (props: { readonly files: readonly ComposerFile[]; readonly onRemove: (id: string) => void }): JSX.Element | null => {
  const [previewId, setPreviewId] = useState<string | null>(null)
  if (props.files.length === 0) return null
  const images = props.files.filter(file => file.kind === 'image')
  const previewIndex = images.findIndex(file => file.id === previewId)
  return (
    <>
      <div aria-label="Attachments" className="dshx:flex dshx:flex-wrap dshx:gap-2">
        {props.files.map(file =>
          file.kind === 'image' ? (
            <figure
              key={file.id}
              className="dshx:group/image dshx:relative dshx:size-16 dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted"
            >
              <button
                type="button"
                aria-label={`Open ${file.name}`}
                onClick={() => setPreviewId(file.id)}
                className="dshx:block dshx:size-full dshx:cursor-zoom-in"
              >
                <img src={file.dataUrl} alt={file.name} className="dshx:size-full dshx:object-cover" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => props.onRemove(file.id)}
                className="dshx:absolute dshx:top-1 dshx:right-1 dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-background/90 dshx:text-foreground dshx:opacity-0 dshx:shadow-sm dshx:transition-opacity dshx:group-hover/image:opacity-100"
              >
                <XIcon className="dshx:size-3" />
              </button>
            </figure>
          ) : (
            <div
              key={file.id}
              className="dshx:group/file dshx:relative dshx:flex dshx:h-16 dshx:w-52 dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/40 dshx:px-2"
            >
              <FileIcon aria-hidden className="dshx:size-5 dshx:shrink-0 dshx:text-muted-foreground" />
              <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                <span className="dshx:truncate dshx:text-[12px] dshx:text-foreground">{file.name}</span>
                <span className="dshx:text-[11px] dshx:text-muted-foreground">{fileSizeLabel(file.bytes)}</span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => props.onRemove(file.id)}
                className="dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
              >
                <XIcon className="dshx:size-3" />
              </button>
            </div>
          ),
        )}
      </div>
      {previewIndex === -1 ? null : (
        <ImageLightbox images={images.map(file => ({ src: file.dataUrl, alt: file.name }))} initialIndex={previewIndex} onClose={() => setPreviewId(null)} />
      )}
    </>
  )
}

/** The paperclip button and its hidden input, for a text box that is not the capture composer. */
export const AttachFilesButton = (props: {
  readonly onFiles: (files: readonly File[]) => void
  readonly label?: string
  readonly title?: string
  readonly className?: string
  readonly children?: ReactNode
}): JSX.Element => {
  const id = useId()
  return (
    <>
      <button
        type="button"
        aria-label={props.label ?? 'Add an image or file'}
        title={props.title}
        onMouseDown={event => event.preventDefault()}
        onClick={() => document.getElementById(id)?.click()}
        className={cn('dshx:inline-flex dshx:items-center dshx:gap-1 dshx:text-[11px] dshx:text-muted-foreground dshx:hover:text-foreground', props.className)}
      >
        {props.children ?? <PaperclipIcon aria-hidden className="dshx:size-3.5" />}
      </button>
      <input
        id={id}
        type="file"
        multiple
        hidden
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          props.onFiles([...(event.currentTarget.files ?? [])])
          event.currentTarget.value = ''
        }}
      />
    </>
  )
}
