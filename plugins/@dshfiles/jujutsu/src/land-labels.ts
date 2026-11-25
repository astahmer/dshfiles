/** Source control and History in plain words (DESIGN.md › Language): no `@-1`, no raw workspace names, no 56y root. */
const sourceControlGroup = (depth: number): string => (depth === 0 ? 'Working copy' : depth === 1 ? 'Parent' : `${String(depth)} changes back`)

/** The newest titled thread working in a workspace folder of that name; `default` is the project's own checkout. */
const threadTitleOfWorkspace = (
  name: string,
  sessions: Iterable<{ readonly title?: string | null | undefined; readonly cwd?: string | null | undefined; readonly updatedAt: number }>,
): string | undefined => {
  if (name === 'default') return undefined
  let best: { readonly title: string; readonly updatedAt: number } | undefined
  for (const session of sessions) {
    const title = session.title?.trim()
    const folder = session.cwd?.replace(/\/+$/u, '').split('/').at(-1)
    if (title === undefined || title === '' || folder !== name) continue
    if (best === undefined || session.updatedAt > best.updatedAt) best = { title, updatedAt: session.updatedAt }
  }
  return best?.title
}

/** jj's root commit (all zeros) has no author time worth an age: it reads "56y" from the Unix epoch. */
const isRootCommit = (commitId: string): boolean => /^0+$/u.test(commitId)

export class LandLabels {
  static readonly sourceControlGroup = sourceControlGroup
  static readonly threadTitleOfWorkspace = threadTitleOfWorkspace
  static readonly isRootCommit = isRootCommit
}
