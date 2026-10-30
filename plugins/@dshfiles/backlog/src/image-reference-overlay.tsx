import type { RefObject } from 'react'

import { ImageAttachmentReferenceModel } from './image-attachment-reference.js'
import type { ComposerFile } from './composer-files.js'

export const ImageReferenceOverlay = (props: {
  readonly text: string
  readonly files: readonly ComposerFile[]
  readonly className: string
  readonly overlayRef: RefObject<HTMLDivElement>
}): JSX.Element => (
  <div
    ref={props.overlayRef}
    aria-hidden="true"
    className={`dshx:pointer-events-none dshx:absolute dshx:inset-0 dshx:z-0 dshx:overflow-hidden dshx:border-transparent dshx:whitespace-pre-wrap dshx:break-words dshx:text-foreground ${props.className}`}
  >
    {ImageAttachmentReferenceModel.highlightSegments(props.text, props.files).map((segment, index) => (
      <span key={`${index}-${segment.text}`} data-dshfiles-image-reference={segment.isReference ? 'true' : undefined}>
        {segment.text}
      </span>
    ))}
  </div>
)
