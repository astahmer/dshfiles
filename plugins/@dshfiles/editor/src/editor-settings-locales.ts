import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const EDITOR_SETTINGS_LOCALE_NAMESPACE = 'dshfiles.editorSettings'

const en = {
  openFileLinksTitle: 'Open file links in Editor',
  openFileLinksDescription: 'Open file links from threads (tool calls and references) in the editor instead of the read-only preview.',
  saveFailed: 'Could not save this setting.',
}

const zh = {
  openFileLinksTitle: '在编辑器中打开文件链接',
  openFileLinksDescription: '在编辑器中打开对话中的文件链接（工具调用和引用），而不是只读预览。',
  saveFailed: '无法保存此设置。',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.editorSettings': keyof typeof en
  }
}

export type EditorSettingsTranslate = TranslateNS<typeof EDITOR_SETTINGS_LOCALE_NAMESPACE>

export const editorSettingsLocale = defineLocale(EDITOR_SETTINGS_LOCALE_NAMESPACE, { en, zh })
