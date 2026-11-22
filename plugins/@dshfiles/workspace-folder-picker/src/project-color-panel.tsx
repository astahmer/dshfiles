import { useSettings } from '@dshfiles/dshx/client'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { useEffect, useRef, useState } from 'react'
import type { ProjectSettingsPanelProps } from './project-settings-panels.js'
import { ProjectName } from './project-name.js'
import { ProjectTone, type ProjectColorChoice } from './project-tone.js'
import { ProjectTonePicker } from './project-tone-picker.js'
import { workspaceFolderPickerSettings } from './settings.js'

const CUSTOM_COLOR_DEBOUNCE_MS = 150

/**
 * Settings › Projects rows for a project's chip: its display name (a long folder name makes the tab strip unreadable)
 * and its colour. Both write the picker plugin's own per-project entries, which the tab chips read.
 */
export const ProjectColorPanel = (props: ProjectSettingsPanelProps): JSX.Element => {
  const settings = useSettings(workspaceFolderPickerSettings)
  const entries = settings.value?.projectColors ?? []
  const names = settings.value?.projectNames ?? []
  const savedName = ProjectName.displayNameOf(props.path, names) ?? ''
  const [nameDraft, setNameDraft] = useState(savedName)
  const persisted = ProjectTone.colorOf(props.path, entries)
  const [draft, setDraft] = useState<ProjectColorChoice | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setDraft(null)
    setNameDraft(savedName)
    clearTimeout(pendingWrite.current)
  }, [props.path, savedName])

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

  const saveName = (): void => {
    const next = nameDraft.trim()
    if (next === savedName) return
    void settings
      .set('projectNames', ProjectName.upsert(names, props.path, next))
      .then(saved => setNotice(saved ? null : 'This name could not be saved.'))
      .catch(() => setNotice('This name could not be saved.'))
  }

  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      <label className="dshx:flex dshx:max-w-sm dshx:flex-col dshx:gap-1">
        <span className="dshx:text-sm dshx:text-muted-foreground">Display name</span>
        <Input
          aria-label={`Display name for ${props.name}`}
          className="dshx:h-8"
          onBlur={saveName}
          onChange={event => setNameDraft(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            saveName()
          }}
          placeholder={ProjectTone.projectFolderName(props.path)}
          value={nameDraft}
        />
      </label>
      <ProjectTonePicker choice={draft ?? persisted} name={props.name} onChange={handleChange} />
      {notice === null ? null : (
        <p className="dshx:m-0 dshx:text-xs dshx:text-destructive" role="alert">
          {notice}
        </p>
      )}
    </div>
  )
}
