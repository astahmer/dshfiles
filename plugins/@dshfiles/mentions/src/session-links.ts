import { z } from 'zod'

const recallEventSchema = z.object({
  type: z.literal('user/message'),
  data: z.object({
    source: z.object({
      kind: z.literal('session-reference'),
      references: z.array(z.object({ sessionId: z.string().min(1), label: z.string() })),
    }),
  }),
})

// `dsh-session:` + base64url(JSON.stringify(sessionId)), as @deepseek-ai/dsh-session-reference encodes it.
const SESSION_URI = /dsh-session:([A-Za-z0-9_-]+)/u
const PLAIN_JSON_STRING = /^"([^"\\]+)"$/u

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

  /** Label → session id for every session a thread's loaded messages referenced; a later reference wins a label. */
  static referencedSessions(events: readonly unknown[]): Map<string, string> {
    const byLabel = new Map<string, string>()
    for (const event of events) {
      const parsed = recallEventSchema.safeParse(event)
      if (!parsed.success) continue
      for (const reference of parsed.data.data.source.references) byLabel.set(reference.label, reference.sessionId)
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
