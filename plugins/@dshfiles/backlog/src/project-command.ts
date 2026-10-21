export type ProjectCommand = {
  readonly query: string
  readonly start: number
  readonly end: number
}

/** The `/project` command typed in the capture box, and how picking a project removes it from the draft. */
export class BacklogProjectCommand {
  /**
   * The `/project` command being typed right before the caret. Its start is the slash, so picking a project can remove
   * the whole command from the draft without touching the text around it.
   */
  static at(text: string, caret: number): ProjectCommand | null {
    const before = text.slice(0, caret)
    const match = /(^|\s)\/project(?:\s+([^\n]*))?$/.exec(before)
    if (match === null) return null
    const query = match[2] ?? ''
    const start = before.length - '/project'.length - (query === '' ? 0 : query.length + 1)
    return { query, start, end: caret }
  }

  /** Removes a picked `/project …` command, joining the text around it with one space when both sides still have text. */
  static strip(text: string, command: ProjectCommand): string {
    const before = text.slice(0, command.start).replace(/[ \t]+$/, '')
    const after = text.slice(command.end).replace(/^[ \t]+/, '')
    if (after === '') return before
    return before === '' ? after : `${before} ${after}`
  }
}
