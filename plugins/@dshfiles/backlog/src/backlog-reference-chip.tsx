import { ReferencePreviewAnchor } from '@dshfiles/input-trigger/entity-reference'
import { ClipboardListIcon, CopyIcon } from '@dshfiles/plugin-ui/icons'
import { useRef } from 'react'

import { previewBacklogReference } from './backlog-preview-request.js'
import { BacklogReference } from './backlog-reference.js'

interface BacklogReferenceChipProps {
  /** The item's ref as written: `k3f9` or a legacy `12`. */
  readonly reference: string
  readonly itemTitle?: string | null
  readonly interactive?: boolean
}

/** One item reference: the same chip in the composer, a sent message, an answer and the panel, with the shared card on hover. */
export const BacklogReferenceChip = ({ reference: ref, itemTitle, interactive = true }: BacklogReferenceChipProps): JSX.Element => {
  const reference = useRef<HTMLButtonElement | null>(null)
  const resolvedTitle = itemTitle?.trim() ?? ''
  const label = resolvedTitle === '' ? BacklogReference.label(ref) : `${BacklogReference.label(ref)} · ${resolvedTitle}`
  const content = (
    <>
      <ClipboardListIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
      <span className="dshx:min-w-0 dshx:truncate">{label}</span>
    </>
  )
  const chipClassName =
    'dshx:inline-flex dshx:min-w-0 dshx:max-w-60 dshx:items-center dshx:gap-1 dshx:rounded dshx:border dshx:border-info/25 dshx:bg-info/10 dshx:px-1.5 dshx:py-0.5 dshx:align-middle dshx:text-xs dshx:text-info'
  if (!interactive)
    return (
      <span className={chipClassName} data-ref-chip="backlog">
        {content}
      </span>
    )
  return (
    <ReferencePreviewAnchor id={ref} kind={BacklogReference.entityKind}>
      <span className="dshx:inline-flex dshx:min-w-0 dshx:max-w-full dshx:items-center dshx:gap-1" data-dshfiles-backlog-reference={ref}>
        <button
          aria-label={`Preview backlog item ${BacklogReference.label(ref)}`}
          className="dshx:inline-flex dshx:min-w-0 dshx:max-w-full dshx:cursor-pointer dshx:rounded dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:text-left"
          data-ref-chip="backlog"
          onClick={event => {
            if (event.detail > 1 || document.getSelection()?.isCollapsed === false) return
            const element = reference.current
            if (element !== null) previewBacklogReference(ref, element)
          }}
          ref={reference}
          type="button"
        >
          <span className={chipClassName}>{content}</span>
        </button>
        <button
          aria-label={`Copy ${BacklogReference.label(ref)} reference`}
          className="dshx:inline-flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
          onClick={() => void navigator.clipboard?.writeText(BacklogReference.label(ref)).catch(() => undefined)}
          type="button"
        >
          <CopyIcon aria-hidden className="dshx:size-3" />
        </button>
      </span>
    </ReferencePreviewAnchor>
  )
}
