import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const WORKBENCH_LOCALE_NAMESPACE = 'dshfiles.workbench'

const en = {
  title: 'Workbench',
  addPanel: 'Add panel',
  noMorePanels: 'Every panel is open',
  resetLayout: 'Reset layout',
  empty: 'No panel is open.',
  missingPanel: '“{id}” is not available. Its plugin may be disabled or removed; it comes back here once it registers again.',
  closePanel: 'Close panel',
  scratchpadTitle: 'Scratchpad',
  scratchpadPlaceholder: 'Type a draft, then move, split or float this panel: the text, caret and counters must survive.',
  mountsLabel: 'Mounts',
  rendersLabel: 'Renders',
  tickerTitle: 'Ticker',
  tickerHint: 'Counts seconds since this panel mounted. A remount restarts it at 0.',
  toggleRightPanel: 'Toggle the persistent panel in the right column',
  sidePanelGuide: 'Dock and arrange registered panels beside the thread.',
  dockHeading: 'Panels',
}

const zh = {
  title: '工作台',
  addPanel: '添加面板',
  noMorePanels: '所有面板均已打开',
  resetLayout: '重置布局',
  empty: '没有打开的面板。',
  missingPanel: '“{id}” 不可用。其插件可能已禁用或移除；重新注册后会回到这里。',
  closePanel: '关闭面板',
  scratchpadTitle: '草稿板',
  scratchpadPlaceholder: '输入草稿，然后移动、拆分或浮动此面板：文本、光标和计数器都应保留。',
  mountsLabel: '挂载',
  rendersLabel: '渲染',
  tickerTitle: '计时器',
  tickerHint: '自此面板挂载以来的秒数。重新挂载会从 0 开始。',
  toggleRightPanel: '切换右栏的常驻面板',
  sidePanelGuide: '在会话旁停靠和排列已注册的面板。',
  dockHeading: '面板',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.workbench': keyof typeof en
  }
}

export type WorkbenchTranslate = TranslateNS<typeof WORKBENCH_LOCALE_NAMESPACE>

export const workbenchLocale = defineLocale(WORKBENCH_LOCALE_NAMESPACE, { en, zh })
