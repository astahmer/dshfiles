/** The fields the Agent Toolkit page reads off a selected Session row; its sessions-store selection compares exactly these. */
export interface ThreadRow {
  readonly id: string
  readonly displayTitle: string
  readonly cwd?: string | undefined
  readonly updatedAt: number
}

/** Same rows in the same order: the store notified, but the page would draw the same thing, so it need not re-render. */
export const sameThreadRows = (left: readonly ThreadRow[], right: readonly ThreadRow[]): boolean =>
  left.length === right.length &&
  left.every((row, index) => {
    const other = right[index]
    return other !== undefined && row.id === other.id && row.displayTitle === other.displayTitle && row.cwd === other.cwd && row.updatedAt === other.updatedAt
  })
