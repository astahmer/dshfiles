import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsTargetRoute } from '@deepseek-ai/dsh-client-ui-settings/client'
import { EDITOR_SETTINGS_NAMESPACE } from './settings-namespace.js'

export const EDITOR_OPEN_FILE_LINKS_OWNER_ID = 'editor-open-file-links'

export const EDITOR_OPEN_FILE_LINKS_TARGET_ROUTE = {
  sectionId: 'general',
  ownerId: EDITOR_OPEN_FILE_LINKS_OWNER_ID,
  entryId: EDITOR_SETTINGS_NAMESPACE,
  fieldPath: ['openFileLinks'],
} satisfies SettingsTargetRoute

export const isEditorOpenFileLinksTarget = (target: PropsRuntime<'settings.general.item'>['target']): boolean =>
  target?.entryId === EDITOR_SETTINGS_NAMESPACE && target.fieldPath.length === 1 && target.fieldPath[0] === 'openFileLinks'
