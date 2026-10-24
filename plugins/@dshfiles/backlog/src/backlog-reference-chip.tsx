import { ClipboardListIcon } from '@dshfiles/plugin-ui/icons'
import { useRef } from 'react'
import { BacklogReference } from './backlog-reference.js'
import { previewBacklogReference } from './backlog-reference-links.js'

interface BacklogReferenceChipProps {
  readonly id: number
  readonly itemTitle?: string | null
  readonly interactive?: boolean
}

export const BacklogReferenceChip = ({ id, itemTitle, interactive = true }: BacklogReferenceChipProps): JSX.Element => {
  const reference = useRef<HTMLButtonElement | null>(null)
  const resolvedTitle = itemTitle?.trim() ?? ''
  const label = resolvedTitle === '' ? BacklogReference.label(id) : `${BacklogReference.label(id)} · ${resolvedTitle}`
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
    <button
      aria-label={`Backlog item ${label}`}
      data-ref-chip="backlog"
      className="dshx:inline-flex dshx:min-w-0 dshx:max-w-full dshx:cursor-pointer dshx:rounded dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:text-left"
      onClick={event => {
        if (event.detail > 1 || (event.detail !== 0 && document.getSelection()?.isCollapsed === false)) return
        const element = reference.current
        if (element !== null) previewBacklogReference(id, element)
      }}
      ref={reference}
      type="button"
    >
      <span className={chipClassName} data-ref-chip="backlog">
        {content}
      </span>
    </button>
  )
}
