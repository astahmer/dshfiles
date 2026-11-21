import { useSettings } from '@dshfiles/dshx/client'
import { defaultProjectTone, projectFolderName, projectToneClass } from '@dshfiles/workspace-folder-picker/project-tone'
import { workspaceFolderPickerSettings } from '@dshfiles/workspace-folder-picker/settings'
import { useMemo } from 'react'

const withoutTrailingSeparators = (path: string): string => path.replace(/[\\/]+$/u, '')

/**
 * The colour chosen for a project when it was imported, if any, keyed by absolute folder. A project without an entry
 * keeps the tint its name hashes to (and the palette setting keeps choosing it), so the list never loses a colour.
 */
export const useProjectToneClass = (): ((path: string) => string) => {
  const overrides = useProjectToneOverrides()
  return useMemo(() => (path: string) => projectToneClass(overrides(path) ?? defaultProjectTone(projectFolderName(path))), [overrides])
}

export const useProjectToneOverrides = (): ((path: string) => number | undefined) => {
  const settings = useSettings(workspaceFolderPickerSettings)
  const tones = settings.value?.projectTones
  return useMemo(() => {
    if (tones === undefined || tones.length === 0) return () => undefined
    return (path: string) => {
      const normalized = withoutTrailingSeparators(path)
      return tones.find(entry => withoutTrailingSeparators(entry.project) === normalized)?.tone
    }
  }, [tones])
}
