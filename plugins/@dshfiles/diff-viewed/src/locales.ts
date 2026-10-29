import { defineLocale } from '@dshfiles/dshx/client'

const DIFF_VIEWED_LOCALE_NAMESPACE = 'dshfiles.diffViewed'

const en = {
  viewed: 'Viewed',
  markViewed: 'Mark {name} as viewed',
  markUnviewed: 'Mark {name} as not viewed',
  progress: '{viewed}/{total} viewed',
}

const zh = {
  viewed: '已查看',
  markViewed: '将 {name} 标记为已查看',
  markUnviewed: '将 {name} 标记为未查看',
  progress: '已查看 {viewed}/{total}',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.diffViewed': keyof typeof en
  }
}

export const diffViewedLocale = defineLocale(DIFF_VIEWED_LOCALE_NAMESPACE, { en, zh })
