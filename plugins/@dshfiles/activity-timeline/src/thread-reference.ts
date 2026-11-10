/**
 * A thread a provider wrote into an item's own words: backlog activity text carries a link such as
 * `http://127.0.0.1:3080/?thread=session-…`, and a pasted `session-…` id appears in free text too. The inbox offers to
 * open it, so "the thread failed" is one click instead of a bare URL.
 */
/** A DSH session id: `session-` plus a UUID, or the bare UUID older Host data stores. */
const SESSION_ID =
  /(session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?<![0-9a-z-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-z-]))/iu
const THREAD_PARAMETER = /[?&]thread=([^&#\s]{8,128})/u

const decoded = (value: string): string | null => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** The first thread id in `text`, or null when the text names none. */
const threadIdIn = (text: string): string | null => {
  const parameter = THREAD_PARAMETER.exec(text)?.[1]
  const fromParameter = parameter === undefined ? null : decoded(parameter)
  const match = fromParameter !== null && SESSION_ID.test(fromParameter) ? fromParameter : SESSION_ID.exec(text)?.[0]
  return match ?? null
}

export class ThreadReferences {
  static threadIdIn = threadIdIn

  /** The thread a whole item points at, its own subject first and then what its reason or detail says. */
  static threadIdOf = (item: {
    readonly subject: { readonly kind: string; readonly id: string }
    readonly reason: string
    readonly detail: string | null
  }): string | null => {
    if (item.subject.kind === 'session') return item.subject.id
    return threadIdIn(item.reason) ?? (item.detail === null ? null : threadIdIn(item.detail))
  }
}
