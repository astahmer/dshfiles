import { useSettings } from '@dshfiles/dshx/client'
import { useState } from 'react'
import type { ProjectSettingsPanelProps } from './project-settings-panels.js'
import { projectColorOf, upsertProjectColor } from './project-tone.js'
import { ProjectTonePicker } from './project-tone-picker.js'
import { workspaceFolderPickerSettings } from './settings.js'

/**
 * Settings › Projects row for a project's colour: the same swatches and custom picker the import dialogs show, so a
 * project's colour can be changed long after it was added. Writes the picker plugin's own per-project entry.
 */
export const ProjectColorPanel = (props: ProjectSettingsPanelProps): JSX.Element => {
  const settings = useSettings(workspaceFolderPickerSettings)
  const entries = settings.value?.projectColors ?? []
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <ProjectTonePicker
        choice={projectColorOf(props.path, entries)}
        name={props.name}
        onChange={choice => {
          void settings
            .set('projectColors', upsertProjectColor(entries, props.path, choice))
            .then(saved => setNotice(saved ? null : 'This colour could not be saved.'))
            .catch(() => setNotice('This colour could not be saved.'))
        }}
      />
      {notice === null ? null : (
        <p className="dshx:m-0 dshx:text-xs dshx:text-destructive" role="alert">
          {notice}
        </p>
      )}
    </div>
  )
}
