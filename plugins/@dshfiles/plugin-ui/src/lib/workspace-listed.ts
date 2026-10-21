/** One row of a Client Workspace list, branded with the id type of whichever package owns it. */
export interface WorkspaceListRow {
  readonly workspaceId: string
}

/** The observable Workspace list a provisioned id has to appear in before the Client may open it. */
export interface WorkspaceListStore<Row extends WorkspaceListRow> {
  readonly list: {
    readonly getSnapshot: () => { readonly items: readonly Row[] }
    readonly subscribe: (listener: () => void) => () => void
  }
}

export const workspaceListedTimeoutMs = 15_000

/**
 * The Host registers a Workspace before its list push lands, and the Client refuses to open an id it has not seen, so a
 * freshly provisioned workspace is opened only once the list carries it. Answers the listed row, so the caller keeps
 * the Host's own branded id instead of branding the provisioning answer itself.
 */
export const workspaceListed = <Row extends WorkspaceListRow>(input: {
  readonly workspaces: WorkspaceListStore<Row>
  readonly workspaceId: string
  readonly timeoutMs?: number
}): Promise<Row> =>
  new Promise<Row>((resolve, reject) => {
    const findRow = (): Row | undefined => input.workspaces.list.getSnapshot().items.find(item => item.workspaceId === input.workspaceId)
    const listed = findRow()
    if (listed !== undefined) {
      resolve(listed)
      return
    }
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Workspace ${input.workspaceId} never reached the workspace list.`))
    }, input.timeoutMs ?? workspaceListedTimeoutMs)
    const unsubscribe = input.workspaces.list.subscribe(() => {
      const row = findRow()
      if (row === undefined) return
      clearTimeout(timer)
      unsubscribe()
      resolve(row)
    })
  })
