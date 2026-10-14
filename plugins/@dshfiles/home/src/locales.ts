import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const HOME_LOCALE_NAMESPACE = 'dshfiles.home'

const en = {
  resume: 'Resume',
  rebaseWorkOne: '{count} thread has work to rebase',
  rebaseWorkOther: '{count} threads have work to rebase',
  openThreadWorkspaces: 'Open thread workspaces',
  noProject: 'No folder',
} as const

const zh: Record<keyof typeof en, string> = {
  resume: '继续',
  rebaseWorkOne: '{count} 个会话有待变基的修改',
  rebaseWorkOther: '{count} 个会话有待变基的修改',
  openThreadWorkspaces: '打开会话工作区',
  noProject: '无文件夹',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.home': keyof typeof en
  }
}

export const homeLocale = defineLocale(HOME_LOCALE_NAMESPACE, { en, zh })

export type HomeTranslate = TranslateNS<typeof HOME_LOCALE_NAMESPACE>
