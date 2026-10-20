import type { MemoryServices } from './runtime.ts'

type SessionList = Awaited<ReturnType<MemoryServices['listSessions']>>

type SessionReadSource = {
  readonly listSessions: () => Promise<SessionList>
  readonly now?: () => number
}

/** The finder's Session list stays fresh through create/dispose events; the clock only bounds header drift. */
const SESSION_LIST_TTL_MS = 60_000

/**
 * The finder's Session list. Core lists Sessions by reading every log header (944 here), once per thread-content
 * search; the list only changes when a Session is created or disposed, so it is kept until then. Titles are kept by
 * the `sessionQuery` owner (`@dshfiles/session-search`).
 */
export class MemorySessionList {
  private list: { readonly value: Promise<SessionList>; readonly at: number } | undefined

  private readonly source: SessionReadSource

  constructor(source: SessionReadSource) {
    this.source = source
  }

  listSessions(): Promise<SessionList> {
    const now = this.source.now?.() ?? Date.now()
    if (this.list !== undefined && now - this.list.at < SESSION_LIST_TTL_MS) return this.list.value
    const value = this.source.listSessions()
    value.catch(() => {
      if (this.list?.value === value) this.list = undefined
    })
    this.list = { value, at: now }
    return value
  }

  /** A Session was created or disposed. */
  sessionsChanged(): void {
    this.list = undefined
  }
}
