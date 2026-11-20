/**
 * The words and small rules of the two Land pages this plugin owns, History and Source control, decided apart from
 * the panel so each has a test (A2 #36, unslop). Client-only: nothing here reaches the Host bundle.
 */
export type RepositoryView = 'graph' | 'source'

/** Navigation name = tab title = `h1`: the thread list's Land destination calls these pages History and Source control. */
const titles = { graph: 'History', source: 'Source control' } as const satisfies Record<RepositoryView, string>

const descriptions = {
  graph: 'Every revision of a project, and where each workspace stands.',
  source: 'The uncommitted changes of a project and its latest revisions, file by file.',
} as const satisfies Record<RepositoryView, string>

/** Each page says what choosing a project shows there; the project select sits right above, so there is no second button. */
const emptyTexts = {
  graph: 'Choose a project above to see its history.',
  source: 'Choose a project above to see its uncommitted changes.',
} as const satisfies Record<RepositoryView, string>

/** "History · dshfiles" names the project a tab shows; the bare page name is the default tab. */
const tabTitle = (root: string | null | undefined): string => {
  const name = root === null || root === undefined ? '' : (root.split('/').filter(Boolean).at(-1) ?? '')
  return name.length === 0 ? titles.graph : `${titles.graph} · ${name}`
}

/**
 * The project a page opens on when nothing was chosen yet: the project of the thread last on screen, else the first
 * registered project. A thread workspace is never a default: it belongs to a project and shows the same repository.
 */
const defaultProjectPath = (input: {
  readonly currentProjectPath: string | null
  readonly projects: readonly { readonly canonicalPath: string; readonly isJjWorkspace?: boolean | undefined }[]
}): string | undefined => {
  if (input.currentProjectPath !== null && input.currentProjectPath.length > 0) return input.currentProjectPath
  return input.projects.find(project => project.isJjWorkspace !== true)?.canonicalPath
}

export class HistoryPage {
  static readonly titles = titles
  static readonly descriptions = descriptions
  static readonly emptyTexts = emptyTexts
  static readonly tabTitle = tabTitle
  static readonly defaultProjectPath = defaultProjectPath
}
