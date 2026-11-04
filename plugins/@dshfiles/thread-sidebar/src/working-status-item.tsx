import type { StatusItemProps } from '@dshfiles/frame-layout/status-strip'

/** Top-level threads with a running turn; subagents roll up into their parent, as in the list. */
const workingCount = (state: {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, { readonly running: boolean; readonly blank: boolean; readonly parentId?: string | undefined } | undefined>>
}): number => {
  let count = 0
  for (const id of state.ids) {
    const session = state.byId[id]
    if (session !== undefined && session.running && !session.blank && session.parentId === undefined) count += 1
  }
  return count
}

/**
 * The status strip's "N working" item (plan §4.1 R5): global, text only, colourless (dark cockpit). It hides while
 * nothing runs, so an idle strip stays quiet.
 */
export const WorkingStatusItem = (props: StatusItemProps & { readonly label: (count: number) => string }): JSX.Element | null => {
  const count = props.useSessions(workingCount)
  if (count === 0) return null
  return (
    <span className="dshx-root" data-testid="status-item-working">
      {props.label(count)}
    </span>
  )
}

export class WorkingStatusModel {
  static readonly workingCount = workingCount
}
