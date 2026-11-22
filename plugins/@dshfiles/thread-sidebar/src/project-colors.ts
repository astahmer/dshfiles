import { useSettings } from '@dshfiles/dshx/client'
import { projectColorOf, projectToneClass, type ProjectColorChoice } from '@dshfiles/workspace-folder-picker/project-tone'
import { workspaceFolderPickerSettings } from '@dshfiles/workspace-folder-picker/settings'
import { useMemo } from 'react'

/** What a chip or a project label paints: a palette class, or a custom `#rrggbb` the operator picked. */
export interface ProjectChip {
  readonly className?: string
  readonly color?: string
}

const chipOf = (choice: ProjectColorChoice): ProjectChip => (choice.kind === 'tone' ? { className: projectToneClass(choice.tone) } : { color: choice.color })

/**
 * The colour chosen for a project when it was imported, resolved to a palette class or a custom colour. A project without
 * an entry keeps the colour its folder name hashes to.
 */
export const useProjectChip = (): ((path: string) => ProjectChip) => {
  const settings = useSettings(workspaceFolderPickerSettings)
  const entries = settings.value?.projectColors
  return useMemo(() => (path: string) => chipOf(projectColorOf(path, entries)), [entries])
}
