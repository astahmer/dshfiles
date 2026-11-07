import { ReferencePreviewAnchor } from '@dshfiles/input-trigger/entity-reference'
import { BotIcon } from '@dshfiles/plugin-ui/icons'
import { useRef, type KeyboardEvent, type MouseEvent } from 'react'

import { previewAgentReference } from './agent-reference-links.js'
import { AgentReference } from './agent-reference.js'

/** One agent reference: the same chip in the composer, a sent message and an answer, with the shared card on hover. */
export const AgentReferenceChip = (props: { readonly handle: string; readonly interactive?: boolean }): JSX.Element => {
  const chip = useRef<HTMLButtonElement | null>(null)
  const label = AgentReference.label(props.handle)
  const content = (
    <>
      <BotIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
      <span className="dshx:min-w-0 dshx:truncate">{label}</span>
    </>
  )
  const chipClassName =
    'dshx:inline-flex dshx:min-w-0 dshx:max-w-60 dshx:items-center dshx:gap-1 dshx:rounded dshx:border dshx:border-border dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:align-middle dshx:text-xs dshx:text-foreground'
  if (props.interactive === false)
    return (
      <span className={chipClassName} data-ref-chip="agent">
        {content}
      </span>
    )
  const open = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const element = chip.current
    if (element !== null) previewAgentReference(props.handle, element)
  }
  return (
    <ReferencePreviewAnchor id={props.handle} kind={AgentReference.entityKind}>
      <span className="dshx:inline-flex dshx:min-w-0 dshx:max-w-full dshx:items-center" data-dshfiles-agent-reference={props.handle}>
        <button
          aria-label={`Preview agent ${AgentReference.label(props.handle)}`}
          className="dshx:inline-flex dshx:min-w-0 dshx:max-w-full dshx:cursor-pointer dshx:rounded dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:text-left"
          data-ref-chip="agent"
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
