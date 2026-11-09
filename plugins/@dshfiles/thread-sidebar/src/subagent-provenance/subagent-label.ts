/** What a subagent row calls the child: the delegation's own short description, else its prompt's first line. */

/** Longest label a row shows before it ends in an ellipsis; the row's own CSS truncates further on narrow panes. */
export const SUBAGENT_LABEL_MAX = 60

const clip = (text: string, max: number): string => {
  const chars = Array.from(text)
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
}

const firstLine = (text: string | undefined): string =>
  (text ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line !== '')
    ?.replace(/\s+/g, ' ') ?? ''

/**
 * Pick the visible label of one delegation call.
 * @param args - decoded call arguments: `description` and `label` as the agent wrote them, then `prompt`.
 * @returns the description or label as written, else the prompt's first non-empty line, clipped; undefined when none.
 */
export const subagentLabel = (
  args: {
    readonly description?: string | undefined
    readonly label?: string | undefined
    readonly prompt?: string | undefined
  } | null,
): string | undefined => {
  if (args === null) return undefined
  for (const candidate of [args.description, args.label, args.prompt]) {
    const line = firstLine(candidate)
    if (line !== '') return clip(line, SUBAGENT_LABEL_MAX)
  }
  return undefined
}
