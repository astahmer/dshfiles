import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ChatReferenceModel,
  chatReferencePreviewDismissEvent,
  chatReferencePreviewEvent,
  chatReferencePreviewRequestSchema,
  type ChatReference,
} from './chat-reference.js'
import type { ChatReferenceTitleStore } from './chat-reference-titles.js'
import { SchemaHelpers } from './schema-helpers.js'

/** What a thread's composer knows about its repository; set while the thread's header toggle is mounted. */
export interface ChatReferenceSession {
  readonly cwd: string
  /** Local bookmark names the Session repository really has; other words never become links. */
  readonly bookmarks: readonly string[]
  readonly onOpen: (reference: ChatReference, targetPath: string) => void
}

/** A pointer sweeping across a line of text should not flash a card, so hovering waits. */
const PREVIEW_OPEN_DELAY_MS = 160

const sessions = new Map<string, ChatReferenceSession>()
const vocabulary = InlineReferenceModel.vocabulary()
let titles: ChatReferenceTitleStore | undefined

/** Make one thread's inline code eligible; the returned function withdraws exactly this registration. */
const attach = (sessionId: string, session: ChatReferenceSession): (() => void) => {
  sessions.set(sessionId, session)
  vocabulary.bump()
  return () => {
    if (sessions.get(sessionId) !== session) return
    sessions.delete(sessionId)
    vocabulary.bump()
  }
}

const NO_SUBSCRIPTION = (): (() => void) => () => {}

const ChatReferenceChip = (props: {
  readonly sessionId: string
  readonly session: ChatReferenceSession
  readonly reference: ChatReference
  readonly source: string
}): JSX.Element => {
  const { sessionId, session, reference } = props
  // The title store is module state a test or the plugin can replace; read it once so this render and its effects agree.
  const store = ChatReferenceLinks.titles()
  useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIPTION, store?.getVersion ?? (() => 0))
  const entry = store?.get(sessionId, session.cwd, reference)
  useEffect(() => store?.request(sessionId, session.cwd, reference), [store, sessionId, session.cwd, reference])
  const pendingOpen = useRef(false)
  useEffect(() => {
    if (!pendingOpen.current || entry?.state !== 'settled') return
    pendingOpen.current = false
    if (entry.targetPath !== null) session.onOpen(reference, entry.targetPath)
  }, [entry, reference, session])
  const openTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(openTimer.current), [])

  const title = entry?.state === 'settled' ? entry.title : undefined
  const fallback = ChatReferenceModel.display(props.source)
  const label = title === undefined ? fallback : ChatReferenceModel.titleLabel({ title, fallback })
  const kind = reference.kind === 'revision' ? 'revision' : 'bookmark'
  const accessibleName = title === undefined ? `Jujutsu ${kind}: ${reference.value}` : `Jujutsu ${kind}: ${title} (${reference.value})`

  const preview = (element: HTMLElement): void => {
    const rect = element.getBoundingClientRect()
    const parsed = SchemaHelpers.decodeSafe(chatReferencePreviewRequestSchema, {
      sessionId,
      cwd: session.cwd,
      reference,
      anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    })
    if (parsed.success) window.dispatchEvent(new CustomEvent(chatReferencePreviewEvent, { detail: parsed.data }))
  }
  const dismiss = (): void => {
    window.clearTimeout(openTimer.current)
    openTimer.current = undefined
    window.dispatchEvent(new Event(chatReferencePreviewDismissEvent))
  }
  const navigate = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): void => {
    event.preventDefault()
    if (entry?.state === 'settled') {
      if (entry.targetPath !== null) session.onOpen(reference, entry.targetPath)
      return
    }
    pendingOpen.current = true
    store?.request(sessionId, session.cwd, reference)
  }
  return (
    <span
      aria-label={accessibleName}
      data-dshfiles-jj-reference=""
      onBlur={dismiss}
      onClick={event => {
        if (event.button !== 0 || document.getSelection()?.isCollapsed === false) return
        navigate(event)
      }}
      onFocus={event => preview(event.currentTarget)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') navigate(event)
      }}
      onPointerEnter={event => {
        const element = event.currentTarget
        window.clearTimeout(openTimer.current)
        openTimer.current = window.setTimeout(() => {
          openTimer.current = undefined
          preview(element)
        }, PREVIEW_OPEN_DELAY_MS)
      }}
      onPointerLeave={dismiss}
      role="link"
      tabIndex={0}
      title={title ?? reference.value}
    >
      <ReferenceChip appearance="session" label={label} title={title ?? reference.value} />
    </span>
  )
}

/**
 * A `jj:` token (or a revision-shaped one, or a real bookmark name) written as inline code in the thread's own
 * conversation. The whole code span becomes the chip; a thread without a mounted header toggle has no eligible tokens.
 */
const reference = InlineReferenceModel.define<{ readonly sessionId: string; readonly reference: ChatReference }>({
  id: 'jujutsu-reference',
  surfaces: ['code'],
  vocabulary,
  match: (text, context) => {
    if (context.sessionId === undefined) return []
    const session = sessions.get(context.sessionId)
    if (session === undefined) return []
    const found = ChatReferenceModel.fromCode({ value: text, bookmarks: session.bookmarks })
    return found === undefined ? [] : [{ start: 0, end: text.length, value: { sessionId: context.sessionId, reference: found } }]
  },
  render: input => {
    const session = sessions.get(input.value.sessionId)
    return session === undefined ? (
      input.text
    ) : (
      <ChatReferenceChip reference={input.value.reference} session={session} sessionId={input.value.sessionId} source={input.text} />
    )
  },
})

export class ChatReferenceLinks {
  static readonly reference = reference
  static readonly attach = attach
  /** The title batcher every chip reads; set once by the client entry. */
  static readonly setTitles = (store: ChatReferenceTitleStore): void => {
    titles = store
  }
  static readonly titles = (): ChatReferenceTitleStore | undefined => titles
}
