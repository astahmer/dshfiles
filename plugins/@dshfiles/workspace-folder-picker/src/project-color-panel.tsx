import { useSettings } from '@dshfiles/dshx/client'
import { useEffect, useRef, useState } from 'react'
import type { ProjectSettingsPanelProps } from './project-settings-panels.js'
import { ProjectTone, type ProjectColorChoice } from './project-tone.js'
import { ProjectTonePicker } from './project-tone-picker.js'
import { workspaceFolderPickerSettings } from './settings.js'

const CUSTOM_COLOR_DEBOUNCE_MS = 150

/**
 * Settings › Projects row for a project's colour: the same swatches and custom picker the import dialogs show, so a
 * project's colour can be changed long after it was added. Writes the picker plugin's own per-project entry.
 */
export const ProjectColorPanel = (props: ProjectSettingsPanelProps): JSX.Element => {
  const settings = useSettings(workspaceFolderPickerSettings)
  const entries = settings.value?.projectColors ?? []
  const persisted = ProjectTone.colorOf(props.path, entries)
  const [draft, setDraft] = useState<ProjectColorChoice | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setDraft(null)
    clearTimeout(pendingWrite.current)
  }, [props.path])

  useEffect(() => () => clearTimeout(pendingWrite.current), [])

  const save = (choice: ProjectColorChoice): void => {
    void settings
      .set('projectColors', ProjectTone.upsertColor(entries, props.path, choice))
      .then(saved => {
        setDraft(null)
        setNotice(saved ? null : 'This colour could not be saved.')
      })
      .catch(() => setNotice('This colour could not be saved.'))
  }

  const handleChange = (choice: ProjectColorChoice): void => {
    clearTimeout(pendingWrite.current)
    if (choice.kind === 'custom') {
      setDraft(choice)
      pendingWrite.current = setTimeout(() => save(choice), CUSTOM_COLOR_DEBOUNCE_MS)
      return
    }
    setDraft(null)
    save(choice)
  }

  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <ProjectTonePicker choice={draft ?? persisted} name={props.name} onChange={handleChange} />
      {notice === null ? null : (
        <p className="dshx:m-0 dshx:text-xs dshx:text-destructive" role="alert">
          {notice}
        </p>
      )}
    </div>
  )
}
