interface ReviewFile {
  readonly path: string
  readonly additions: number
  readonly deletions: number
}

const category = (path: string): number => {
  const lower = path.toLowerCase()
  if (/(^|\/)(generated|__generated__|dist|vendor)\/|\.(generated|gen|min)\.[^/]+$/.test(lower)) return 4
  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|cargo\.lock|gemfile\.lock)$/.test(lower)) return 3
  if (/(^|\/)(__tests__|tests?|specs?)\/|\.(test|spec)\.[^/]+$/.test(lower)) return 2
  if (/(^|\/)(index|main|app|server|client)\.[^/]+$/.test(lower)) return 0
  return 1
}

export const orderReviewFiles = <File extends ReviewFile>(input: { readonly files: readonly File[] }): File[] =>
  [...input.files].sort(
    (left, right) =>
      category(left.path) - category(right.path) ||
      right.additions + right.deletions - (left.additions + left.deletions) ||
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  )
