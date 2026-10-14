interface ThreadRow<Id extends string> {
  readonly id: Id
  readonly blank: boolean
  readonly retainedBy: { readonly mainView?: number | undefined }
}

/** The thread the main view shows; undefined on a panel, the New thread screen or a blank draft, where there is nothing to fork. */
export const mainViewThreadId = <Id extends string>(rows: readonly ThreadRow<Id>[]): Id | undefined =>
  rows.find(row => !row.blank && (row.retainedBy.mainView ?? 0) > 0)?.id
