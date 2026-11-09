import { ReferencePreviewAnchor } from '@dshfiles/input-trigger/entity-reference'
import { BrainIcon } from '@dshfiles/plugin-ui/icons'
import { useRef, type KeyboardEvent, type MouseEvent } from 'react'

import { EntityPreview } from '@dshfiles/input-trigger/entity-registry'
import { MemoryReferenceModel } from './memory-reference.js'

/** One memory citation: the same chip in an answer and a sent message, with the shared card on hover. */
export const MemoryReferenceChip = (props: {
  readonly id: string
  readonly range?: string | undefined
  /** The citation as written; the chip keeps that spelling. */
  readonly text: string
  readonly interactive?: boolean
}): JSX.Element => {
  const chip = useRef<HTMLButtonElement | null>(null)
  const content = (
    <>
      <BrainIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
      <span className="dshx:min-w-0 dshx:truncate">{props.text}</span>
    </>
  )
  const chipClassName =
    'dshx:inline-flex dshx:min-w-0 dshx:max-w-60 dshx:items-center dshx:gap-1 dshx:rounded dshx:border dshx:border-border dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:align-middle dshx:text-xs dshx:text-foreground'
  if (props.interactive === false)
    return (
      <span className={chipClassName} data-ref-chip="memory">
        {content}
      </span>
    )
  const open = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const element = chip.current
    if (element !== null) EntityPreview.request({ kind: MemoryReferenceModel.entityKind, id: props.id, range: props.range }, element)
  }
  return (
    <ReferencePreviewAnchor id={props.id} kind={MemoryReferenceModel.entityKind} range={props.range}>
      <span data-dshfiles-memory-range={props.range} data-dshfiles-memory-reference={props.id}>
        <button
          aria-label={`Preview memory ${props.id}${props.range === undefined ? '' : ` #${props.range}`}`}
          className="dshx:inline-flex dshx:min-w-0 dshx:max-w-full dshx:cursor-pointer dshx:rounded dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:text-left"
          data-ref-chip="memory"
          onClick={event => {
            if (event.detail > 1 || document.getSelection()?.isCollapsed === false) return
            open(event)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') open(event)
          }}
          ref={chip}
          type="button"
        >
          <span className={chipClassName}>{content}</span>
        </button>
      </span>
    </ReferencePreviewAnchor>
  )
}
