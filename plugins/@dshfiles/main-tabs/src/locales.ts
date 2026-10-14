import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const MAIN_TABS_LOCALE_NAMESPACE = 'dshfiles.main-tabs'

const en = {
  title: 'Main tabs',
  stripLabel: 'Open views',
  allTabs: 'All open tabs',
  close: 'Close {title}',
  closeTab: 'Close tab',
  closeOthers: 'Close other tabs',
  closeToRight: 'Close tabs to the right',
  pin: 'Pin tab',
  unpin: 'Unpin tab',
  keepOpen: 'Keep open',
  pinned: 'Pinned',
  preview: 'Preview',
  running: 'Working',
  needsYou: 'Needs your input',
  unread: 'Finished, unread',
  unavailable: 'Not available: its plugin may be disabled.',
  untitledThread: 'New thread',
  nextTab: 'Next tab',
  previousTab: 'Previous tab',
  goToTab: 'Go to tab {index}',
  goToLastTab: 'Go to the last tab',
}

const zh = {
  title: '主视图标签页',
  stripLabel: '已打开的视图',
  allTabs: '所有已打开的标签页',
  close: '关闭 {title}',
  closeTab: '关闭标签页',
  closeOthers: '关闭其他标签页',
  closeToRight: '关闭右侧标签页',
  pin: '固定标签页',
  unpin: '取消固定',
  keepOpen: '保持打开',
  pinned: '已固定',
  preview: '预览',
  running: '运行中',
  needsYou: '需要你的输入',
  unread: '已完成，未读',
  unavailable: '不可用：其插件可能已禁用。',
  untitledThread: '新会话',
  nextTab: '下一个标签页',
  previousTab: '上一个标签页',
  goToTab: '转到标签页 {index}',
  goToLastTab: '转到最后一个标签页',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.main-tabs': keyof typeof en
  }
}

export type MainTabsTranslate = TranslateNS<typeof MAIN_TABS_LOCALE_NAMESPACE>

export const mainTabsLocale = defineLocale(MAIN_TABS_LOCALE_NAMESPACE, { en, zh })
