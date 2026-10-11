import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it } from 'vitest'
import { EDITOR_OPEN_FILE_LINKS_OWNER_ID, EDITOR_OPEN_FILE_LINKS_TARGET_ROUTE, isEditorOpenFileLinksTarget } from './editor-settings-route.js'

type SettingsTarget = NonNullable<PropsRuntime<'settings.general.item'>['target']>

const target = (entryId: string, fieldPath: readonly string[]): SettingsTarget => ({ entryId, fieldPath })

describe('Editor native settings route', () => {
  it('routes only openFileLinks to its General row', () => {
    expect(EDITOR_OPEN_FILE_LINKS_TARGET_ROUTE).toEqual({
      sectionId: 'general',
      ownerId: EDITOR_OPEN_FILE_LINKS_OWNER_ID,
      entryId: 'dshfiles-editor',
      fieldPath: ['openFileLinks'],
    })
    expect(isEditorOpenFileLinksTarget(target('dshfiles-editor', ['openFileLinks']))).toBe(true)
    expect(isEditorOpenFileLinksTarget(target('dshfiles-editor', ['editorPlacement']))).toBe(false)
    expect(isEditorOpenFileLinksTarget(target('other-plugin', ['openFileLinks']))).toBe(false)
    expect(isEditorOpenFileLinksTarget(target('dshfiles-editor', ['openFileLinks', 'nested']))).toBe(false)
    expect(isEditorOpenFileLinksTarget(undefined)).toBe(false)
  })
})
