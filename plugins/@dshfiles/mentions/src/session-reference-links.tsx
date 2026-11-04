import type { UserTextNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import type { KeyboardEvent, MouseEvent } from 'react'
import { SessionLinks } from './session-links.js'

/** What opening a referenced thread needs; the client entry supplies it once. */
export interface SessionReferencePorts {
  /** Open the thread; `newTab` asks @dshfiles/main-tabs for a tab of its own. False when it is not a listed thread. */
  readonly openThread: (sessionId: string, newTab: boolean) => boolean
  /** Label → session id for every session a thread's loaded messages referenced. */
  readonly referencedSessions: (threadId: string) => ReadonlyMap<string, string>
  /** The session a label names in any loaded thread, for a renderer that is not told its thread. */
  readonly sessionForLabel: (label: string) => string | undefined
}

let ports: SessionReferencePorts | undefined

const wantsNewTab = (event: MouseEvent | KeyboardEvent): boolean => event.metaKey || event.ctrlKey

/**
 * A sent message's session chip. The native renderer shows it as an inert label; this keeps that chip and adds link
 * semantics, so a click (or Enter) opens the thread and Mod-click opens it in a tab of its own. A sent chip carries only
 * `@label`; the thread it names comes from the conversation's own recall events, read at activation.
 */
export const SessionMentionChip = (props: {
  readonly node: UserTextNode<'session'>
  readonly raw: string
  readonly interactive: boolean
  /** The conversation rendering the chip; every session-scoped slot receives it. */
  readonly sessionId?: string
}): JSX.Element => {
  const chip = <ReferenceChip appearance="session" label={props.node.data.label} title={props.raw} />
  if (!props.interactive) return chip
  const open = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): void => {
    const label = props.raw.replace(/^@/u, '')
    const byLabel = props.sessionId === undefined ? undefined : ports?.referencedSessions(props.sessionId)
    const sessionId =
      SessionLinks.idFromMention(props.raw) ??
      byLabel?.get(label) ??
      byLabel?.get(props.node.data.label) ??
      ports?.sessionForLabel(label) ??
      ports?.sessionForLabel(props.node.data.label)
    if (sessionId !== undefined && ports?.openThread(sessionId, wantsNewTab(event)) === true) event.preventDefault()
  }
  return (
    <span
      data-dshfiles-session-link=""
      onClick={event => {
        if (event.button !== 0 || document.getSelection()?.isCollapsed === false) return
        open(event)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') open(event)
      }}
      role="link"
      tabIndex={0}
    >
      {chip}
    </span>
  )
}

/**
 * The "Referenced session · A, B" line under a sent message. The whole line is one link; the label under the pointer
 * (or the first one, from the keyboard) picks the thread, read from that conversation's own recall events.
 */
const ReferenceSummaryLink = (props: { readonly threadId: string; readonly text: string }): JSX.Element => {
  const labels = (): readonly string[] => [...(ports?.referencedSessions(props.threadId).keys() ?? [])]
  const openAt = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, offset: number | undefined): void => {
    const byLabel = ports?.referencedSessions(props.threadId)
    const label = SessionLinks.labelAt({ text: props.text, offset, labels: labels() })
    const sessionId = label === undefined ? undefined : byLabel?.get(label)
    if (sessionId !== undefined && ports?.openThread(sessionId, wantsNewTab(event)) === true) event.preventDefault()
  }
  return (
    <span
      data-dshfiles-session-link=""
      onClick={event => {
        if (event.button !== 0 || document.getSelection()?.isCollapsed === false) return
        const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY)
        openAt(event, caret !== null && caret !== undefined && event.currentTarget.contains(caret.offsetNode) ? caret.offset : undefined)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') openAt(event, undefined)
      }}
      role="link"
      tabIndex={0}
    >
      {props.text}
    </span>
  )
}

/** Chat's Referenced-session line becomes one link while a thread renders it. */
const referenceSummary = InlineReferenceModel.define<string>({
  id: 'referenced-sessions',
  surfaces: ['summary'],
  match: (text, context) => (context.sessionId === undefined || text === '' ? [] : [{ start: 0, end: text.length, value: context.sessionId }]),
  render: input => <ReferenceSummaryLink text={input.text} threadId={input.value} />,
})

export class SessionReferenceLinks {
  static readonly summary = referenceSummary
  static readonly connect = (next: SessionReferencePorts): void => {
    ports = next
  }
}
