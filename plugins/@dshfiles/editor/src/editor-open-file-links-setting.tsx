import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useSettings } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { useEffect, useId, useState } from 'react'
import type { EditorSettingsTranslate } from './editor-settings-locales.js'
import { isEditorOpenFileLinksTarget } from './editor-settings-route.js'
import { openFileLinksPreference } from './open-file-links-preference.js'
import { editorSettings } from './settings.js'

interface EditorOpenFileLinksSettingProps extends PropsRuntime<'settings.general.item'> {
  readonly t: EditorSettingsTranslate
}

export const EditorOpenFileLinksSetting = (props: EditorOpenFileLinksSettingProps): JSX.Element => {
  const settings = useSettings(editorSettings)
  const toggleId = useId()
  const titleId = `${toggleId}-title`
  const descriptionId = `${toggleId}-description`
  const errorId = `${toggleId}-error`
  const configuredOpenFileLinks = settings.value?.openFileLinks
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    if (configuredOpenFileLinks !== undefined) openFileLinksPreference.set(configuredOpenFileLinks)
  }, [configuredOpenFileLinks])

  useEffect(() => {
    if (!isEditorOpenFileLinksTarget(props.target) || settings.status !== 'ready' || !settings.writable) return
    document.getElementById(toggleId)?.focus({ preventScroll: true })
  }, [props.target, settings.status, settings.writable, toggleId])

  const update = async (checked: boolean): Promise<void> => {
    setSaveFailed(false)
    try {
      const saved = await settings.set('openFileLinks', checked)
      if (!saved) {
        setSaveFailed(true)
        return
      }
      openFileLinksPreference.set(checked)
    } catch {
      setSaveFailed(true)
    }
  }

  return (
    <div className="dshx-root dshx:flex dshx:items-center dshx:justify-between dshx:gap-4 dshx:py-3">
      <div className="dshx:min-w-0 dshx:flex-1">
        <label className="dshx:block dshx:text-sm dshx:font-medium dshx:text-foreground" htmlFor={toggleId} id={titleId}>
          {props.t('openFileLinksTitle')}
        </label>
        <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground" id={descriptionId}>
          {props.t('openFileLinksDescription')}
        </p>
        {saveFailed ? (
          <p className="dshx:mt-2 dshx:text-xs dshx:text-destructive" id={errorId} role="alert">
            {props.t('saveFailed')}
          </p>
        ) : null}
      </div>
      <Switch
        aria-describedby={saveFailed ? `${descriptionId} ${errorId}` : descriptionId}
        aria-labelledby={titleId}
        checked={configuredOpenFileLinks ?? true}
        disabled={settings.status !== 'ready' || !settings.writable || settings.mutation.pending}
        id={toggleId}
        onCheckedChange={checked => {
          void update(checked)
        }}
      />
    </div>
  )
}
