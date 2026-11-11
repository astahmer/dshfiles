/** Most names listed per side of one notice; the rest are counted, and stay findable through `tool_search`. */
const MAX_LISTED = 20
/** Code points kept from a description's first sentence. */
const MAX_SUMMARY = 100

interface ToolSetDelta {
  readonly added: readonly (readonly [name: string, description: string])[]
  readonly removed: readonly string[]
}

/** The first sentence of a description, cut on a code point so a multi-byte character is never split. */
const summarize = (description: string): string => {
  const firstLine = description.trim().split('\n', 1)[0] ?? ''
  const sentence = (/^.*?[.!?](?=\s|$)/u.exec(firstLine)?.[0] ?? firstLine).replaceAll('</system-reminder>', '<\\/system-reminder>')
  const points = Array.from(sentence)
  return points.length <= MAX_SUMMARY ? sentence : `${points.slice(0, MAX_SUMMARY - 1).join('')}…`
}

const overflow = (count: number): string[] => (count > MAX_LISTED ? [`- … and ${count - MAX_LISTED} more`] : [])

export class ToolSetDeltaModel {
  /** Names in `next` absent from `known`, and names in `known` absent from `next`, each in name order. */
  static diff(known: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): ToolSetDelta {
    return {
      added: [...next].filter(([name]) => !known.has(name)).sort(([left], [right]) => left.localeCompare(right)),
      removed: [...known.keys()].filter(name => !next.has(name)).sort((left, right) => left.localeCompare(right)),
    }
  }

  static isEmpty(delta: ToolSetDelta): boolean {
    return delta.added.length === 0 && delta.removed.length === 0
  }

  /** One model-facing reminder naming only what changed, with how to reach an added tool in this mode. */
  static render(delta: ToolSetDelta, mode: 'cache-safe' | 'progressive'): string {
    const reach =
      mode === 'cache-safe'
        ? 'Get an added tool’s parameters with tool_search, then call it with tool_call.'
        : 'Load an added tool with tool_search before calling it unless it is already in your tool list.'
    const added =
      delta.added.length === 0
        ? []
        : [
            'Added:',
            ...delta.added.slice(0, MAX_LISTED).map(([name, description]) => `- ${name}: ${summarize(description)}`),
            ...overflow(delta.added.length),
            reach,
          ]
    const removedNames = delta.removed.slice(0, MAX_LISTED).join(', ')
    const removed =
      delta.removed.length === 0 ? [] : [`Removed: ${removedNames}${delta.removed.length > MAX_LISTED ? ` and ${delta.removed.length - MAX_LISTED} more` : ''}`]
    return ['<system-reminder>', 'The tool set changed since your last request.', ...added, ...removed, '</system-reminder>'].join('\n')
  }
}
