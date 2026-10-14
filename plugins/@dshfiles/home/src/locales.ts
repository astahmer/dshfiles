import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const HOME_LOCALE_NAMESPACE = 'dshfiles.home'

const en = {
  resume: 'Resume',
  unlandedOne: '{count} thread has unlanded work',
  unlandedOther: '{count} threads have unlanded work',
  openThreadWorkspaces: 'Open thread workspaces',
  noProject: 'No folder',
} as const

const zh: Record<keyof typeof en, string> = {
  resume: '继续',
  unlandedOne: '{count} 个会话有未合入的修改',
  unlandedOther: '{count} 个会话有未合入的修改',
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
