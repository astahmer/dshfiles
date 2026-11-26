/** The parts of a thread the tab title reads; a `SessionSummary` fits. */
export interface ThreadTabTitleSource {
  readonly title?: string | undefined
  readonly displayTitle: string
  readonly blank?: boolean | undefined
  readonly projectionValues?: { readonly subagent?: { readonly label?: string | undefined } | null | undefined } | undefined
}

export class ThreadTabTitle {
  /**
   * A thread tab's title. A subagent's tab reads the description its parent gave it (the child's creation label), as its
   * header, the thread list and the phone do; its Session title is the prompt it was sent (council round 22, item 7).
   */
  static readonly of = (session: ThreadTabTitleSource | undefined, untitled: string): string => {
    const label = session?.projectionValues?.subagent?.label?.trim()
    if (label !== undefined && label !== '') return label
    return session?.title ?? (session === undefined || session.blank === true ? untitled : session.displayTitle)
  }
}
