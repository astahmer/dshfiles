import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'

/** The projects a backlog item can be filed under. */
export class BacklogProjectPaths {
  /**
   * Every project items already use plus the registered workspaces, deduped and sorted, with isolated thread workspaces
   * dropped so the picker offers `dshfiles` and not the checkout a thread runs in.
   */
  static readonly displayPath = (path: string): string => path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
  static readonly toggleSelection = (selection: readonly (string | null)[], project: string | null): readonly (string | null)[] =>
    selection.includes(project) ? selection.filter(candidate => candidate !== project) : [...selection, project]

  static candidates(sources: readonly (readonly string[])[]): readonly string[] {
    const unique = new Set(sources.flatMap(paths => paths).filter(path => path !== '' && !EntityLabels.isThreadWorkspace(path)))
    return [...unique].sort((left, right) => left.localeCompare(right))
  }
}
