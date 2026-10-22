import type { BacklogEvent, BacklogLink } from './item.js'

const threadActivityLink = /(?:^|\s)thread:(session-[\w-]{6,})$/u
const genericThreadPhrase = /\b(?:a|the) thread\b/iu
const legacyThreadActivity = (event: BacklogEvent): boolean =>
  (event.kind === 'moved' && /\(mentioned in a thread\)$/u.test(event.detail)) ||
  (event.kind === 'edited' && /^attention: (?:blocked|none) \(the thread\b/u.test(event.detail))

const threadIdFromEvent = (event: BacklogEvent): string | undefined => {
  if (event.threadId !== undefined) return event.threadId
  if (event.kind !== 'linked' && event.kind !== 'unlinked') return undefined
  return threadActivityLink.exec(event.detail)?.[1]
}

export class BacklogActivityReferences {
  static threadIdOf = (input: {
    readonly event: BacklogEvent
    readonly eventIndex: number
    readonly events: readonly BacklogEvent[]
    readonly links: readonly BacklogLink[]
  }): string | undefined => {
    const direct = threadIdFromEvent(input.event)
    if (direct !== undefined) return direct
    if (!legacyThreadActivity(input.event) || !genericThreadPhrase.test(input.event.detail)) return undefined

    const precedingLink = input.events.slice(0, input.eventIndex).findLast(event => event.kind === 'linked' && threadIdFromEvent(event) !== undefined)
    const precedingThreadId = precedingLink === undefined ? undefined : threadIdFromEvent(precedingLink)
    if (precedingThreadId !== undefined) return precedingThreadId

    const linkedThreadIds = new Set(input.links.flatMap(link => (link.type === 'thread' ? [link.target] : [])))
    return linkedThreadIds.size === 1 ? [...linkedThreadIds][0] : undefined
  }

  static threadLabelOf = (input: { readonly title: string | undefined; readonly sessionId: string; readonly duplicateTitle: boolean }): string => {
    const shortId = input.sessionId.replace(/^session-/, '').slice(0, 8)
    if (input.title === undefined) return `Thread ${shortId}`
    return `${input.title}${input.duplicateTitle ? ` · ${shortId}` : ''}`
  }

  static threadReferenceRange = (
    description: string,
    threadId: string,
  ): { readonly start: number; readonly end: number; readonly text: string } | undefined => {
    const explicit = `thread:${threadId}`
    const explicitStart = description.indexOf(explicit)
    if (explicitStart !== -1) return { start: explicitStart, end: explicitStart + explicit.length, text: explicit }
    const phrase = genericThreadPhrase.exec(description)
    if (phrase === null || phrase.index === undefined) return undefined
    return { start: phrase.index, end: phrase.index + phrase[0].length, text: phrase[0] }
  }
}
