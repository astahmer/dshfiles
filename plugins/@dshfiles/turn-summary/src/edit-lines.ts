/**
 * Lines one edit adds and removes, read from the edit call's own arguments. Pure, with no Host or client imports, so
 * both the turn footer (client) and the turn-marks projection (Host) count lines the same way.
 */
import { decodeJson, jsonValueSchema } from '@dshfiles/dshx/json'

/** Lines added and removed, by one edit or across a turn. */
export interface LineCounts {
  readonly added: number
  readonly removed: number
}

/** The edit-tool argument fields line counting reads; the model wrote them, so each stays unparsed until read. */
interface EditArgumentsData {
  readonly content?: unknown
  readonly edits?: unknown
  readonly old_string?: unknown
  readonly old_str?: unknown
  readonly new_string?: unknown
  readonly new_str?: unknown
}

/** One `apply_patch` edit's replaced and replacing text. */
interface PatchEditData {
  readonly old?: unknown
  readonly new?: unknown
}

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null
const readString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

export class EditLines {
  /**
   * Lines one edit adds and removes, from its arguments: the replaced and replacing text of `edit` /
   * `str_replace_editor` / each `apply_patch` edit with their shared leading and trailing lines dropped, or the whole
   * content of a `write` (counted as added; the file it replaced is not in the call).
   */
  static of(tool: string, argumentsText: string): LineCounts {
    let parsed: unknown
    try {
      parsed = decodeJson(jsonValueSchema, argumentsText)
    } catch {
      return { added: 0, removed: 0 }
    }
    const args: EditArgumentsData = isObject(parsed) ? parsed : {}
    if (tool === 'write') return { added: EditLines.lineCount(readString(args.content) ?? ''), removed: 0 }
    const pairs: (readonly [string, string])[] = []
    if (Array.isArray(args.edits)) {
      for (const candidate of args.edits) {
        const edit: PatchEditData = isObject(candidate) ? candidate : {}
        pairs.push([readString(edit.old) ?? '', readString(edit.new) ?? ''])
      }
    } else pairs.push([readString(args.old_string) ?? readString(args.old_str) ?? '', readString(args.new_string) ?? readString(args.new_str) ?? ''])
    return pairs.reduce(
      (sum, [before, after]) => {
        const lines = EditLines.diffLines(before, after)
        return { added: sum.added + lines.added, removed: sum.removed + lines.removed }
      },
      { added: 0, removed: 0 },
    )
  }

  static lineCount(text: string): number {
    if (text === '') return 0
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  }

  static diffLines(before: string, after: string): LineCounts {
    const old = before === '' ? [] : before.split('\n')
    const next = after === '' ? [] : after.split('\n')
    let start = 0
    while (start < old.length && start < next.length && old[start] === next[start]) start += 1
    let end = 0
    while (end < old.length - start && end < next.length - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end += 1
    return { added: next.length - start - end, removed: old.length - start - end }
  }
}
