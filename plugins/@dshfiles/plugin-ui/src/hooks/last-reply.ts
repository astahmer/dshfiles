import { useEffect, useState } from 'react'

/**
 * The latest assistant reply of a thread, for a peek: what the agent said last, without opening the thread.
 *
 * Types are structural so the kit carries no session-controller dependency: a plugin passes its own
 * `ctx.sessions.retain`. Retaining loads the thread's history window; the hook holds it only while mounted.
 */
export interface PeekEventEntry {
  readonly event: { readonly type: string; readonly data?: unknown }
}

export interface PeekEventSource {
  getSnapshot(): { readonly entries: readonly PeekEventEntry[] }
  subscribe(listener: () => void): () => void
}

export type RetainThread = (sessionId: string, signal: AbortSignal) => { readonly ready: Promise<{ readonly eventSource: PeekEventSource }>; release(): void }

export type LastReplyState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly text: string }
  | { readonly status: 'failed'; readonly message: string }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null

const messageText = (message: unknown): string | undefined => {
  if (!isRecord(message) || !Array.isArray(message.content)) return undefined
  const text = message.content
    .flatMap(part => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
    .join('\n')
    .trim()
  return text === '' ? undefined : text
}

/** The text of the last settled assistant message in a history window; undefined when there is none. */
const lastAssistantText = (entries: readonly PeekEventEntry[]): string | undefined => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.event.type !== 'assistant/message' || !isRecord(entry.event.data)) continue
    const text = messageText(entry.event.data.message)
    if (text !== undefined) return text
  }
  return undefined
}

/**
 * The last paragraph of a reply, the part that usually says the outcome or asks the question, capped for a popover.
 * Markdown fences and headings are dropped: a peek is a glance, not the transcript.
 */
const lastParagraph = (text: string, max = 420): string => {
  const paragraphs = text
    .replace(/```[\s\S]*?```/gu, '')
    .split(/\n\s*\n/u)
    .map(paragraph => paragraph.replace(/^#+\s*/gmu, '').trim())
    .filter(paragraph => paragraph !== '')
  const last = paragraphs.at(-1) ?? ''
  return last.length > max ? `${last.slice(0, max - 1).trimEnd()}…` : last
}

export const LastReplyModel = { lastAssistantText, lastParagraph } as const

/** Retain one thread while mounted and follow its latest reply; idle without a session or a retain function. */
export const useLastReply = (retain: RetainThread | undefined, sessionId: string | undefined): LastReplyState => {
  const [state, setState] = useState<LastReplyState>({ status: 'idle' })
  useEffect(() => {
    if (retain === undefined || sessionId === undefined) {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    let unsubscribe: (() => void) | undefined
    setState({ status: 'loading' })
    let reference: ReturnType<RetainThread> | undefined
    try {
      reference = retain(sessionId, controller.signal)
    } catch (error) {
      setState({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      return
    }
    reference.ready.then(
      binding => {
        if (controller.signal.aborted) return
        const read = (): void => setState({ status: 'ready', text: lastAssistantText(binding.eventSource.getSnapshot().entries) ?? '' })
        read()
        unsubscribe = binding.eventSource.subscribe(read)
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      controller.abort()
      unsubscribe?.()
      reference?.release()
    }
  }, [retain, sessionId])
  return state
}
