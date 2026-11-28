/**
 * The hanging indent of wrapped code (council round 8 A6; DESIGN.md › Components › Code). A wrapped line continues 2ch
 * right of its own statement's indent, so a wrapped `item.unitPriceCents` sits under its statement and never left of
 * it. CSS cannot count a line's leading whitespace, so this measures it in columns and hands it to the wrap rule as
 * `--dshx-line-indent` (`<n>ch`; Geist Mono is one `ch` per column):
 *
 * - the transcript's wrapped Markdown code (`ui-styles/src/transcript.css`, `.md-code-block[data-code-wrap='true']`):
 *   the owner of the code card calls `CodeIndent.mark(code)` once its highlighted lines are in the DOM; without the
 *   variable the rule keeps the plain 2ch hang;
 * - the kit `CodeBlock` reads `CodeIndent.columns` for each line itself.
 */

const LINE_INDENT = '--dshx-line-indent'

/** Leading whitespace of `text` in columns, tabs expanded to the next multiple of `tabSize`; 0 for a blank line. */
const columns = (text: string, tabSize: number): number => {
  let column = 0
  for (const character of text) {
    if (character === ' ') column += 1
    else if (character === '\t') column += tabSize - (column % tabSize)
    else return column
  }
  // Only whitespace (or nothing): no statement to hang from.
  return 0
}

/** The tab stop the code is drawn with (`tab-size`, 8 by default in browsers). */
const tabSizeOf = (element: Element): number => {
  const value = Number.parseInt(getComputedStyle(element).tabSize, 10)
  return Number.isFinite(value) && value > 0 ? value : 8
}

/**
 * Sets `--dshx-line-indent` on every highlighted `.line` under `root` (Shiki's line spans) from its text, and clears it
 * where the line has none. Returns how many lines it visited. Idempotent: call it again after the lines change.
 */
const mark = (root: ParentNode & Element, tabSize: number = tabSizeOf(root)): number => {
  const lines = root.querySelectorAll<HTMLElement>('.line')
  for (const line of lines) {
    const indent = columns(line.textContent ?? '', tabSize)
    if (indent === 0) line.style.removeProperty(LINE_INDENT)
    else line.style.setProperty(LINE_INDENT, `${indent}ch`)
  }
  return lines.length
}

export const CodeIndent = { columns, mark, tabSizeOf, property: LINE_INDENT } as const
