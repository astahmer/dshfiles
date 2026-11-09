import { Option, Schema } from 'effect'

const recallEventSchema = Schema.Struct({
  type: Schema.Literal('user/message'),
  data: Schema.Struct({
    source: Schema.Struct({
      kind: Schema.Literal('session-reference'),
      references: Schema.Array(Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)), label: Schema.String })),
    }),
  }),
})

// `dsh-session:` + base64url(JSON.stringify(sessionId)), as @deepseek-ai/dsh-session-reference encodes it.
const SESSION_URI = /dsh-session:([A-Za-z0-9_-]+)/u
const SESSION_MENTION = /@\[([^\]\n]+)\]\(dsh-session:[A-Za-z0-9_-]+\)/gu
const PLAIN_JSON_STRING = /^"([^"\\]+)"$/u

/** One canonical session mention already written in plain text. */
export interface SessionMentionMatch {
  /** Offset of the leading `@`. */
  readonly start: number
  readonly end: number
  /** The exact `@[label](dsh-session:…)` spelling. */
  readonly mention: string
  readonly label: string
}

/** How a rendered session reference finds the session it names. */
export class SessionLinks {
  /** The session id inside a canonical `@[label](dsh-session:…)` mention, or undefined for anything else. */
  static idFromMention(text: string): string | undefined {
    const payload = SESSION_URI.exec(text)?.[1]
    if (payload === undefined) return undefined
    try {
      const base64 = payload.replaceAll('-', '+').replaceAll('_', '/')
      return PLAIN_JSON_STRING.exec(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))?.[1]
    } catch {
      return undefined
    }
  }

  /** Every canonical session mention a written text still names. */
  static matches(text: string): readonly SessionMentionMatch[] {
    return [...text.matchAll(SESSION_MENTION)].flatMap(match => {
      const label = match[1]
      if (label === undefined) return []
      const start = match.index ?? 0
      return [{ start, end: start + match[0].length, mention: match[0], label }]
    })
  }

  /**
   * The session a rendered element names: an Agent writes `@[label](dsh-session:…)`, which native markdown renders as
   * an anchor whose href carries the URI (its title may carry the whole mention instead).
   */
  static idFromAnchor(element: { getAttribute(name: string): string | null }): string | undefined {
    return SessionLinks.idFromMention(element.getAttribute('href') ?? '') ?? SessionLinks.idFromMention(element.getAttribute('title') ?? '')
  }

  /** Label → session id for every session a thread's loaded messages referenced; a later reference wins a label. */
  static referencedSessions(events: readonly unknown[]): Map<string, string> {
    const byLabel = new Map<string, string>()
    for (const event of events) {
      const parsed = Schema.decodeUnknownOption(recallEventSchema)(event)
      if (Option.isNone(parsed)) continue
      for (const reference of parsed.value.data.source.references) byLabel.set(reference.label, reference.sessionId)
    }
    return byLabel
  }

  /**
   * The label under a character offset of a "Referenced session · A, B" line: the one whose span holds the offset,
   * else the only label the line contains.
   */
  static labelAt(input: { readonly text: string; readonly offset: number | undefined; readonly labels: Iterable<string> }): string | undefined {
    const present = [...input.labels]
      .toSorted((left, right) => right.length - left.length)
      .flatMap(label => {
        const start = input.text.lastIndexOf(label)
        return start < 0 ? [] : [{ label, start, end: start + label.length }]
      })
    const offset = input.offset
    const hit = offset === undefined ? undefined : present.find(span => offset >= span.start && offset <= span.end)
    if (hit !== undefined) return hit.label
    return present.length === 1 ? present[0]?.label : undefined
  }
}
